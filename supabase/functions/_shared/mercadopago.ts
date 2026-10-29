/** Cliente mínimo de Mercado Pago (Checkout Pro). Sin dependencias de runtime; `fetch` se puede inyectar para probar. */
export interface MpConfig {
  accessToken: string;
  baseUrl?: string;              // https://api.mercadopago.com
  fetch?: typeof fetch;
  sandbox?: boolean;             // true: usa el link de pruebas (sandbox_init_point)
}
export interface MpPayment { id: string; status: string; transaction_amount: number; currency_id: string; external_reference: string | null }
export interface PreferenceInput { intentId: string; bookingId: string; amountArs: number; expiresAt: string; appUrl: string; notificationUrl: string; title?: string }

export class MpError extends Error { constructor(public status: number, message: string) { super(message); } }

const base = (c: MpConfig) => c.baseUrl ?? 'https://api.mercadopago.com';
async function call(c: MpConfig, method: string, path: string, body?: unknown, idem?: string): Promise<any> {
  const res = await (c.fetch ?? fetch)(`${base(c)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.accessToken}`, 'Content-Type': 'application/json', ...(idem ? { 'X-Idempotency-Key': idem } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new MpError(res.status, `mercadopago ${res.status}: ${text.slice(0, 200)}`);
  try { return text ? JSON.parse(text) : {}; } catch { throw new MpError(502, 'mercadopago: respuesta inválida'); }
}

export async function createPreference(c: MpConfig, p: PreferenceInput): Promise<{ id: string; init_point: string }> {
  const back = (r: string) => `${p.appUrl.replace(/\/$/, '')}/?pago=${r}&reserva=${p.bookingId}`;
  const r = await call(c, 'POST', '/checkout/preferences', {
    items: [{ id: p.bookingId, title: p.title ?? 'Show en vivo (SuenaBA)', quantity: 1, unit_price: p.amountArs, currency_id: 'ARS' }],
    external_reference: p.intentId,
    notification_url: p.notificationUrl,
    back_urls: { success: back('ok'), failure: back('error'), pending: back('pendiente') },
    auto_return: 'approved',
    binary_mode: true,                         // el pago se aprueba o se rechaza (sin estados intermedios)
    expires: true, expiration_date_to: new Date(p.expiresAt).toISOString(),
    statement_descriptor: 'SUENABA',
  }, p.intentId);
  const url = c.sandbox ? r.sandbox_init_point : r.init_point;
  if (!r.id || typeof url !== 'string') throw new MpError(502, 'mercadopago: preferencia sin link de pago');
  return { id: String(r.id), init_point: url };
}

export async function getPayment(c: MpConfig, id: string): Promise<MpPayment> {
  const r = await call(c, 'GET', `/v1/payments/${encodeURIComponent(id)}`);
  return { id: String(r.id), status: String(r.status), transaction_amount: Number(r.transaction_amount), currency_id: String(r.currency_id), external_reference: r.external_reference ?? null };
}

export async function refundPayment(c: MpConfig, paymentId: string, amount: number, idempotencyKey: string): Promise<{ id: string }> {
  const r = await call(c, 'POST', `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, { amount }, idempotencyKey);
  return { id: String(r.id) };
}

// ---- Firma del webhook (https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks)
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
const timingSafe = (a: string, b: string) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

/** Valida x-signature (ts=...,v1=...) sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Rechaza avisos viejos (anti-replay). */
export async function verifyWebhookSignature(secret: string, p: { xSignature: string | null; xRequestId: string | null; dataId: string | null; nowMs?: number; toleranceSec?: number }): Promise<boolean> {
  if (!secret || !p.xSignature || !p.xRequestId || !p.dataId) return false;
  const parts = Object.fromEntries(p.xSignature.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; }));
  const ts = parts.ts, v1 = parts.v1;
  if (!ts || !v1 || !/^\d{9,13}$/.test(ts)) return false;
  const tsMs = ts.length > 10 ? Number(ts) : Number(ts) * 1000;
  if (Math.abs((p.nowMs ?? Date.now()) - tsMs) > (p.toleranceSec ?? 600) * 1000) return false;
  const id = /^[a-z0-9]+$/i.test(p.dataId) ? p.dataId.toLowerCase() : p.dataId;
  const expected = await hmacSha256Hex(secret, `id:${id};request-id:${p.xRequestId};ts:${ts};`);
  return timingSafe(expected, v1.toLowerCase());
}
