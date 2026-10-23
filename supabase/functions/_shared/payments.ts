import { safeEqual } from './delivery.ts';
import { MpError, createPreference, getPayment, refundPayment, verifyWebhookSignature, type MpConfig } from './mercadopago.ts';

export interface Intent { id: string; booking_id: string; status: string; amount_ars: number | string; init_point: string | null; expires_at: string }
export interface RefundRow { id: string; booking_id: string; mp_payment_id: string; amount: number | string; attempts: number }

export interface PayDeps {
  mp: MpConfig;
  appUrl: string;
  functionsUrl: string;                   // base pública de las funciones, p. ej. https://xxxx.supabase.co/functions/v1
  webhookSecret: string;
  toleranceSec?: number;
  nowMs?: () => number;
  /** Se ejecuta COMO el usuario (con su JWT): begin_payment valida que sea el bar de la reserva. */
  beginPayment(jwt: string, bookingId: string): Promise<Intent>;
  attachPreference(intentId: string, preferenceId: string, initPoint: string): Promise<Intent>;
  confirmIntent(intentId: string, paymentId: string, amount: number, currency: string, status: string): Promise<void>;
  claimRefunds(limit: number): Promise<RefundRow[]>;
  completeRefund(id: string, ok: boolean, mpRefundId: string | null, error: string | null): Promise<void>;
  expireIntents(): Promise<number>;
  log?(msg: string, extra?: unknown): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (o: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...extra } });
const STATUS_BY_CODE: Record<string, number> = { not_authenticated: 401, no_profile: 403, suspended: 403, booking_not_found: 404, invalid_state: 409, already_paid: 409, booking_expired: 409, payments_disabled: 409 };
const errCode = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** POST { booking_id } con el JWT del bar → { init_point } para pagar en Mercado Pago. */
export async function handleCreatePayment(req: Request, d: PayDeps): Promise<Response> {
  const cors = { 'access-control-allow-origin': new URL(d.appUrl).origin, 'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey', 'vary': 'origin' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST, OPTIONS' } });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!jwt) return json({ error: 'not_authenticated' }, 401, cors);
  let bookingId: unknown;
  try { bookingId = (await req.json())?.booking_id; } catch { return json({ error: 'invalid_body' }, 400, cors); }
  if (typeof bookingId !== 'string' || !UUID.test(bookingId)) return json({ error: 'invalid_booking' }, 400, cors);

  let intent: Intent;
  try { intent = await d.beginPayment(jwt, bookingId); }
  catch (e) { const c = errCode(e); return json({ error: c }, STATUS_BY_CODE[c] ?? 400, cors); }
  if (intent.status === 'aprobado') return json({ status: 'aprobado', intent_id: intent.id, init_point: null }, 200, cors);   // reserva gratuita: ya quedó confirmada
  if (intent.init_point) return json({ status: intent.status, intent_id: intent.id, init_point: intent.init_point }, 200, cors);
  try {
    const pref = await createPreference(d.mp, { intentId: intent.id, bookingId: intent.booking_id, amountArs: Number(intent.amount_ars), expiresAt: intent.expires_at, appUrl: d.appUrl, notificationUrl: `${d.functionsUrl.replace(/\/$/, '')}/mp-webhook` });
    const saved = await d.attachPreference(intent.id, pref.id, pref.init_point);
    return json({ status: saved.status, intent_id: saved.id, init_point: saved.init_point ?? pref.init_point }, 200, cors);
  } catch (e) {
    d.log?.('create-payment: Mercado Pago no disponible', errCode(e));
    return json({ error: 'mp_unavailable' }, 502, cors);   // la intención queda pendiente: el bar puede reintentar
  }
}

/** Webhook de Mercado Pago. Nunca confía en el cuerpo: valida la firma y vuelve a consultar el pago. */
export async function handleWebhook(req: Request, d: PayDeps): Promise<Response> {
  if (!d.webhookSecret || d.webhookSecret.length < 16) return json({ error: 'webhook_not_configured' }, 500);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const url = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch { /* algunos avisos llegan sin cuerpo */ }
  const dataId = url.searchParams.get('data.id') ?? (body?.data?.id != null ? String(body.data.id) : null);
  const type = url.searchParams.get('type') ?? body?.type ?? null;
  const ok = await verifyWebhookSignature(d.webhookSecret, { xSignature: req.headers.get('x-signature'), xRequestId: req.headers.get('x-request-id'), dataId, nowMs: d.nowMs?.(), toleranceSec: d.toleranceSec });
  if (!ok) { d.log?.('webhook: firma inválida'); return json({ error: 'invalid_signature' }, 401); }
  if (type !== 'payment' || !dataId || !/^[0-9]{1,30}$/.test(dataId)) return json({ ignored: 'not_a_payment' });

  let payment;
  try { payment = await getPayment(d.mp, dataId); }
  catch (e) {
    if (e instanceof MpError && e.status === 404) return json({ ignored: 'payment_not_found' });   // p. ej. el aviso de prueba del panel
    d.log?.('webhook: Mercado Pago no disponible', errCode(e));
    return json({ error: 'mp_unavailable' }, 500);                                              // 500 => Mercado Pago reintenta
  }
  if (!payment.external_reference || !UUID.test(payment.external_reference)) return json({ ignored: 'unknown_reference' });
  try {
    await d.confirmIntent(payment.external_reference, payment.id, payment.transaction_amount, payment.currency_id, payment.status);
  } catch (e) {
    const c = errCode(e);
    if (c === 'intent_not_found' || c === 'invalid_payment') return json({ ignored: c });
    d.log?.('webhook: error confirmando', c);
    return json({ error: 'internal' }, 500);
  }
  return json({ ok: true, payment_id: payment.id, status: payment.status });
}

export interface RefundStats { claimed: number; done: number; retried: number; errors: number; intentsExpired: number }
/** Devuelve el dinero (reembolsos pendientes) usando la clave de idempotencia = id del reembolso. */
export async function runRefunds(d: PayDeps, limit = 20): Promise<RefundStats> {
  const st: RefundStats = { claimed: 0, done: 0, retried: 0, errors: 0, intentsExpired: await d.expireIntents().catch(() => 0) };
  const rows = await d.claimRefunds(limit); st.claimed = rows.length;
  for (const r of rows) {
    try {
      const out = await refundPayment(d.mp, r.mp_payment_id, Number(r.amount), r.id);
      await d.completeRefund(r.id, true, out.id, null); st.done++;
    } catch (e) {
      try { await d.completeRefund(r.id, false, null, errCode(e).slice(0, 300)); st.retried++; } catch { st.errors++; }
    }
  }
  return st;
}

export async function handleRefundsRequest(req: Request, cfg: { secret: string; deps: PayDeps; limit?: number }): Promise<Response> {
  if (!cfg.secret || cfg.secret.length < 16) return json({ error: 'worker_not_configured' }, 500);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!safeEqual(req.headers.get('x-worker-secret') ?? '', cfg.secret)) return json({ error: 'forbidden' }, 403);
  return json(await runRefunds(cfg.deps, cfg.limit ?? 20));
}
