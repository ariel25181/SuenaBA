import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, asUser, asSystem, checkInvariants, H, D, type Actor, type Api } from '../db/helpers.ts';
import { startFake, type Fake } from './fakes.ts';
import { mp, mpHandler, setPayment, resetMp } from './fakeMp.ts';
import { handleCreatePayment, handleWebhook, handleRefundsRequest, runRefunds, type PayDeps } from '../../supabase/functions/_shared/payments.ts';
import { supabasePayDeps } from '../../supabase/functions/_shared/paymentsSupabase.ts';
import { verifyWebhookSignature, createPreference, getPayment, refundPayment, MpError } from '../../supabase/functions/_shared/mercadopago.ts';

const DB = 'suenaba_mp_pipeline';
let pool: pg.Pool, A: Api, mpServer: Fake;
let bar1: Actor, bar2: Actor, m1: Actor, m2: Actor;
const SECRET = 'webhook-secret-de-prueba-1234567890';
const APP = 'https://suenaba.test';
const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const clock = { now: undefined as Date | undefined };
const mins = (n: number) => new Date(Date.now() + n * 60_000);

const rpcAs = (userId: string | null, role: 'authenticated' | 'postgres' = 'postgres') => ({
  async rpc(fn: string, args: Record<string, unknown> = {}) {
    const keys = Object.keys(args);
    try {
      const rows = await asUser(pool, userId, async (c) => (await c.query(`select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map((k) => args[k]))).rows, { role, now: clock.now });
      if (rows.length === 1 && Object.keys(rows[0]).length === 1 && fn in rows[0]) return { data: rows[0][fn], error: null };
      return { data: rows, error: null };
    } catch (e: any) { return { data: null, error: { message: e.message } }; }
  },
});
function makeDeps(over: Partial<PayDeps> = {}): PayDeps {
  return {
    mp: { accessToken: 'APP_USR-test-token', baseUrl: mpServer.url }, appUrl: APP, functionsUrl: 'https://proj.supabase.co/functions/v1', webhookSecret: SECRET, nowMs: () => Date.now(),
    ...supabasePayDeps(rpcAs(null), (jwt) => rpcAs(jwt, 'authenticated')), ...over,
  };
}
const createReq = (bar: Actor | string | null, body: unknown, method = 'POST') => new Request('https://f.test/create-payment', { method, headers: { ...(bar ? { authorization: `Bearer ${typeof bar === 'string' ? bar : bar.userId}` } : {}), 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });

// ---- firma independiente (node:crypto), para no probar el verificador con su propia implementación
const sign = (dataId: string, requestId = 'req-1', ts = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `ts=${ts},v1=${crypto.createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')}`;
const hook = (dataId: string, o: { type?: string; sig?: string | null; requestId?: string | null; method?: string; qs?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = {};
  const sig = o.sig === undefined ? sign(dataId) : o.sig; if (sig) headers['x-signature'] = sig;
  const rid = o.requestId === undefined ? 'req-1' : o.requestId; if (rid) headers['x-request-id'] = rid;
  return new Request(`https://f.test/mp-webhook?${o.qs ?? `data.id=${dataId}&type=${o.type ?? 'payment'}`}`, { method: o.method ?? 'POST', headers, body: o.method === 'GET' ? undefined : JSON.stringify(o.body ?? { action: 'payment.created', data: { id: dataId } }) });
};
async function accepted(bar: Actor, mus: Actor, days: number, extra: Record<string, unknown> = {}) {
  const starts = day(days), ends = plus(starts, 3 * H);
  const l = await A.createListing(bar, { starts, ends, cachet: 100000, ...extra } as any);
  const b = await A.request(mus, l.id); await A.respond(bar, b.id, true);
  return { bookingId: b.id as string, starts, ends };
}
const intentOf = async (bookingId: string) => (await A.q('select * from payment_intents where booking_id = $1 order by created_at desc', [bookingId]))[0];
const bstatus = async (id: string) => (await A.q('select status from bookings where id = $1', [id]))[0].status as string;

before(async () => { pool = await createTestDb(DB, 20); A = api(pool); });
after(async () => { await mpServer?.close(); await dropTestDb(pool, DB); });
beforeEach(async () => {
  await resetData(pool); const w = await seedActors(pool, 2, 2); [bar1, bar2] = w.bars; [m1, m2] = w.mus; clock.now = undefined;
  await A.q(`update app_settings set payment_mode = 'mercadopago'`);
  resetMp();
  mpServer = await startFake((req, body) => mpHandler(req, body));
});
afterEach(async () => { await mpServer.close(); const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Firma del webhook', () => {
  const v = (o: Partial<Parameters<typeof verifyWebhookSignature>[1]> = {}) => verifyWebhookSignature(SECRET, { xSignature: sign('123456'), xRequestId: 'req-1', dataId: '123456', ...o });
  it('acepta una firma correcta (con id en mayúsculas normalizado) y rechaza cualquier alteración', async () => {
    assert.equal(await v(), true);
    assert.equal(await v({ dataId: 'ABC123', xSignature: sign('abc123') }), true);                        // MP firma el id en minúsculas
    for (const bad of [{ dataId: '123457' }, { xRequestId: 'req-2' }, { xSignature: sign('123456', 'req-1', undefined, 'otro-secreto-muy-largo-123') }, { xSignature: null }, { xRequestId: null }, { dataId: null },
      { xSignature: 'v1=abc' }, { xSignature: `ts=${Math.floor(Date.now() / 1000)}` }, { xSignature: 'ts=abc,v1=def' }, { xSignature: sign('123456').replace(/.$/, (c) => (c === '0' ? '1' : '0')) }])
      assert.equal(await v(bad as any), false, JSON.stringify(bad));
    assert.equal(await verifyWebhookSignature('', { xSignature: sign('1'), xRequestId: 'req-1', dataId: '1' }), false);
  });
  it('rechaza avisos viejos o del futuro (anti-replay) y respeta la tolerancia', async () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.equal(await v({ xSignature: sign('123456', 'req-1', old) }), false);
    assert.equal(await v({ xSignature: sign('123456', 'req-1', old), nowMs: old * 1000 + 1000 }), true);
    assert.equal(await v({ xSignature: sign('123456', 'req-1', Math.floor(Date.now() / 1000) + 3600) }), false);
    assert.equal(await v({ xSignature: sign('123456', 'req-1', old), toleranceSec: 7200 }), true);
  });
});

describe('Cliente de Mercado Pago', () => {
  const cfg = () => ({ accessToken: 'APP_USR-test-token', baseUrl: mpServer.url });
  it('createPreference envía monto, referencia, vencimiento, retornos e idempotencia', async () => {
    const exp = new Date(Date.now() + 3 * H).toISOString();
    const r = await createPreference(cfg(), { intentId: 'i-1', bookingId: 'b-1', amountArs: 105000, expiresAt: exp, appUrl: `${APP}/`, notificationUrl: 'https://proj.supabase.co/functions/v1/mp-webhook' });
    assert.match(r.init_point, /pref_id=pref-1$/);
    const h = mpServer.hits[0], b = JSON.parse(h.body);
    assert.deepEqual([h.headers['x-idempotency-key'], b.external_reference, b.items[0].unit_price, b.items[0].currency_id, b.items[0].quantity, b.binary_mode, b.expires, b.expiration_date_to, b.auto_return],
      ['i-1', 'i-1', 105000, 'ARS', 1, true, true, exp, 'approved']);
    assert.equal(b.notification_url, 'https://proj.supabase.co/functions/v1/mp-webhook');
    assert.deepEqual(b.back_urls, { success: `${APP}/?pago=ok&reserva=b-1`, failure: `${APP}/?pago=error&reserva=b-1`, pending: `${APP}/?pago=pendiente&reserva=b-1` });
    const sb = await createPreference({ ...cfg(), sandbox: true }, { intentId: 'i-2', bookingId: 'b-2', amountArs: 1, expiresAt: exp, appUrl: APP, notificationUrl: 'https://x.test/h' });
    assert.match(sb.init_point, /sandbox\.mercadopago/);
  });
  it('errores de Mercado Pago se traducen a MpError con el estado', async () => {
    await assert.rejects(getPayment({ accessToken: 'mal', baseUrl: mpServer.url }, '1'), (e: any) => e instanceof MpError && e.status === 401);
    await assert.rejects(getPayment(cfg(), '999'), (e: any) => e instanceof MpError && e.status === 404);
    mp.prefFail = 1; await assert.rejects(createPreference(cfg(), { intentId: 'i', bookingId: 'b', amountArs: 1, expiresAt: new Date().toISOString(), appUrl: APP, notificationUrl: 'https://x.test' }), (e: any) => e.status === 500);
    mp.refundFail = 1; await assert.rejects(refundPayment(cfg(), '5', 10, 'k'), (e: any) => e.status === 500);
    assert.equal((await refundPayment(cfg(), '5', 10, 'k')).id, (await refundPayment(cfg(), '5', 10, 'k')).id);   // misma clave => mismo reembolso
  });
});

describe('create-payment (el bar paga)', () => {
  it('crea la preferencia, guarda el link y lo reutiliza sin volver a llamar a Mercado Pago', async () => {
    await A.q('update app_settings set venue_fee_bps = 500');
    const r = await accepted(bar1, m1, 10);
    const res = await handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }), makeDeps());
    assert.equal(res.status, 200); const j = await res.json();
    assert.match(j.init_point, /^https:\/\/www\.mercadopago\.com\.ar\/checkout\/v1\/redirect\?pref_id=pref-1$/);
    assert.equal(JSON.parse(mpServer.hits[0].body).items[0].unit_price, 105000);                                  // cachet + comisión del bar
    assert.equal(JSON.parse(mpServer.hits[0].body).external_reference, (await intentOf(r.bookingId)).id);
    assert.equal((await intentOf(r.bookingId)).init_point, j.init_point);
    const again = await (await handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }), makeDeps())).json();
    assert.equal(again.init_point, j.init_point); assert.equal(mp.prefs, 1);
    assert.equal((await handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }, 'OPTIONS'), makeDeps())).status, 204);
  });
  it('valida método, sesión, cuerpo, dueño y estado con códigos HTTP claros', async () => {
    const r = await accepted(bar1, m1, 10);
    const st = async (req: Request) => (await handleCreatePayment(req, makeDeps())).status;
    assert.equal(await st(createReq(bar1, {}, 'GET')), 405);
    assert.equal(await st(createReq(null, { booking_id: r.bookingId })), 401);
    assert.equal(await st(createReq('00000000-0000-0000-0000-0000000000aa', { booking_id: r.bookingId })), 403);       // usuario sin perfil: no_profile
    assert.equal(await st(new Request('https://f.test', { method: 'POST', headers: { authorization: `Bearer ${bar1.userId}` }, body: 'no es json' })), 400);
    assert.equal(await st(createReq(bar1, { booking_id: 'no-es-uuid' })), 400);
    assert.equal(await st(createReq(bar1, {})), 400);
    assert.equal(await st(createReq(bar2, { booking_id: r.bookingId })), 404);                                  // otro bar
    assert.equal(await st(createReq(m1, { booking_id: r.bookingId })), 404);                                    // un músico no paga
    assert.equal(await st(createReq(bar1, { booking_id: '00000000-0000-0000-0000-000000000000' })), 404);
    const sol = await A.createListing(bar2, { starts: day(12), ends: plus(day(12), 3 * H), cachet: 1 } as any); const sb = await A.request(m2, sol.id);
    assert.equal(await st(createReq(bar2, { booking_id: sb.id })), 409);                                         // todavía no aceptó
    assert.equal(mp.prefs, 0, 'no debe llamar a Mercado Pago en los errores');
    await A.q(`update app_settings set payment_mode = 'simulado'`);
    assert.equal(await st(createReq(bar1, { booking_id: r.bookingId })), 409);                                    // payments_disabled
  });
  it('si Mercado Pago falla devuelve 502 y el bar puede reintentar sin duplicar el cobro', async () => {
    const r = await accepted(bar1, m1, 10);
    mp.prefFail = 1;
    const bad = await handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }), makeDeps());
    assert.equal(bad.status, 502); assert.equal((await bad.json()).error, 'mp_unavailable');
    const i1 = await intentOf(r.bookingId); assert.deepEqual([i1.status, i1.init_point], ['pendiente', null]);
    const ok = await handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }), makeDeps());
    assert.equal(ok.status, 200); assert.equal((await intentOf(r.bookingId)).id, i1.id);
    assert.equal((await A.q('select count(*)::int n from payment_intents'))[0].n, 1);
  });
  it('una reserva gratuita se confirma sin llamar a Mercado Pago', async () => {
    const r = await accepted(bar1, m1, 10, { cachet: 0 });
    const j = await (await handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }), makeDeps())).json();
    assert.deepEqual([j.status, j.init_point, mp.prefs, await bstatus(r.bookingId)], ['aprobado', null, 0, 'confirmada']);
  });
  it('dos clics simultáneos del bar no crean dos preferencias distintas para la misma intención', async () => {
    const r = await accepted(bar1, m1, 10);
    const res = await Promise.all([1, 2, 3].map(() => handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }), makeDeps())));
    assert.ok(res.every((x) => x.status === 200));
    assert.equal((await A.q(`select count(*)::int n from payment_intents where status = 'pendiente'`))[0].n, 1);
    const links = new Set((await Promise.all(res.map((x) => x.json()))).map((j) => j.init_point));
    assert.equal(links.size, 1, 'todos deben recibir el mismo link');
  });
});

describe('mp-webhook', () => {
  async function pending(bar = bar1, mus = m1, days = 10) {
    const r = await accepted(bar, mus, days); await handleCreatePayment(createReq(bar, { booking_id: r.bookingId }), makeDeps());
    const i = await intentOf(r.bookingId); return { ...r, intent: i };
  }
  it('un pago aprobado confirma la reserva; el mismo aviso repetido no cobra dos veces', async () => {
    const p = await pending(); setPayment('777001', { ref: p.intent.id });
    const r1 = await handleWebhook(hook('777001'), makeDeps()); assert.equal(r1.status, 200);
    assert.equal(await bstatus(p.bookingId), 'confirmada');
    assert.deepEqual([(await intentOf(p.bookingId)).status, (await A.q('select provider, provider_ref from payments'))[0].provider, (await A.q('select provider_ref from payments'))[0].provider_ref], ['aprobado', 'mercadopago', '777001']);
    for (let k = 0; k < 3; k++) assert.equal((await handleWebhook(hook('777001'), makeDeps())).status, 200);
    assert.equal((await A.q('select count(*)::int n from payments'))[0].n, 1);
  });
  it('rechaza firmas inválidas, ausentes, vencidas o de otro id, y no procesa nada', async () => {
    const p = await pending(); setPayment('777002', { ref: p.intent.id });
    const h = async (req: Request) => (await handleWebhook(req, makeDeps())).status;
    assert.equal(await h(hook('777002', { sig: null })), 401);
    assert.equal(await h(hook('777002', { requestId: null })), 401);
    assert.equal(await h(hook('777002', { sig: sign('777002', 'req-1', undefined, 'otro-secreto-muy-largo-1234') })), 401);
    assert.equal(await h(hook('777002', { sig: sign('999999') })), 401);                                          // firma de otro pago
    assert.equal(await h(hook('777002', { sig: sign('777002', 'req-1', Math.floor(Date.now() / 1000) - 7200) })), 401);   // repetición vieja
    assert.equal(await h(hook('777002', { method: 'GET' })), 405);
    assert.equal((await handleWebhook(hook('777002'), makeDeps({ webhookSecret: '' }))).status, 500);               // mal configurado: nunca acepta
    assert.equal(await bstatus(p.bookingId), 'aceptada'); assert.equal(mpServer.hits.length, 1, 'no debe consultar pagos con firma inválida (solo la preferencia)');
  });
  it('no confía en el cuerpo: lo que vale es lo que Mercado Pago responde al consultar el pago', async () => {
    const p = await pending(); setPayment('777003', { ref: p.intent.id, status: 'rejected' });
    const r = await handleWebhook(hook('777003', { body: { action: 'payment.updated', data: { id: '777003' }, status: 'approved', transaction_amount: 100000 } }), makeDeps());
    assert.equal(r.status, 200); assert.equal(await bstatus(p.bookingId), 'aceptada');                           // el cuerpo mentía
    setPayment('777003', { ref: p.intent.id, status: 'pending' }); await handleWebhook(hook('777003'), makeDeps()); assert.equal(await bstatus(p.bookingId), 'aceptada');
    setPayment('777003', { ref: p.intent.id, status: 'approved' }); await handleWebhook(hook('777003'), makeDeps()); assert.equal(await bstatus(p.bookingId), 'confirmada');
  });
  it('ignora (200) lo que no es un pago, pagos desconocidos y referencias ajenas; falla (500) si Mercado Pago no responde', async () => {
    const p = await pending();
    assert.deepEqual(await (await handleWebhook(hook('55', { type: 'merchant_order' }), makeDeps())).json(), { ignored: 'not_a_payment' });
    assert.deepEqual(await (await handleWebhook(hook('abc'), makeDeps())).json(), { ignored: 'not_a_payment' });
    assert.deepEqual(await (await handleWebhook(hook('123456'), makeDeps())).json(), { ignored: 'payment_not_found' });   // aviso de prueba del panel
    setPayment('777004', { ref: 'garbage' }); assert.deepEqual(await (await handleWebhook(hook('777004'), makeDeps())).json(), { ignored: 'unknown_reference' });
    setPayment('777005', { ref: null }); assert.deepEqual(await (await handleWebhook(hook('777005'), makeDeps())).json(), { ignored: 'unknown_reference' });
    setPayment('777006', { ref: '00000000-0000-0000-0000-000000000000' }); assert.deepEqual(await (await handleWebhook(hook('777006'), makeDeps())).json(), { ignored: 'intent_not_found' });
    mp.lookupStatus = 503; assert.equal((await handleWebhook(hook('777004'), makeDeps())).status, 500);          // Mercado Pago reintenta
    mp.lookupStatus = 0; setPayment('777007', { ref: p.intent.id });
    assert.equal((await handleWebhook(hook('777007'), makeDeps())).status, 200); assert.equal(await bstatus(p.bookingId), 'confirmada');
  });
  it('monto o moneda distintos: no confirma y deja el reembolso encolado', async () => {
    const p = await pending(); setPayment('777008', { ref: p.intent.id, amount: 1 });
    await handleWebhook(hook('777008'), makeDeps());
    assert.deepEqual([(await intentOf(p.bookingId)).status, await bstatus(p.bookingId)], ['discrepancia', 'aceptada']);
    const rf = (await A.q('select * from payment_refunds'))[0]; assert.deepEqual([rf.reason, rf.mp_payment_id, Number(rf.amount)], ['discrepancia', '777008', 1]);
  });
  it('20 avisos simultáneos (mismo pago, mezclados con duplicados y orden distinto) confirman una sola vez', async () => {
    const items = [];
    for (let k = 0; k < 6; k++) { const p = await pending(k % 2 ? bar1 : bar2, k % 2 ? m1 : m2, 10 + k); setPayment(String(880000 + k), { ref: p.intent.id }); items.push(p); }
    await Promise.all(Array.from({ length: 20 }, (_, n) => handleWebhook(hook(String(880000 + (n % 6))), makeDeps())));
    for (const p of items) assert.equal(await bstatus(p.bookingId), 'confirmada');
    assert.equal((await A.q('select count(*)::int n from payments'))[0].n, 6);
  });
  it('pago que llega después de cancelar la reserva: se devuelve y no se confirma', async () => {
    const p = await pending(); await A.cancel(bar1, p.bookingId); setPayment('777009', { ref: p.intent.id });
    await handleWebhook(hook('777009'), makeDeps());
    assert.deepEqual([(await intentOf(p.bookingId)).status, await bstatus(p.bookingId)], ['reembolsar', 'cancelada']);
    const done = await runRefunds(makeDeps()); assert.deepEqual([done.claimed, done.done], [1, 1]);
    assert.equal((await intentOf(p.bookingId)).status, 'reembolsado');
    assert.deepEqual([mp.refundCalls[0].payment, mp.refundCalls[0].body.amount], ['777009', 100000]);
  });
});

describe('process-refunds', () => {
  async function paidAndCancelled(bar: Actor, mus: Actor, days: number, canceller: Actor, extra: Record<string, unknown> = {}, now?: Date) {
    const r = await accepted(bar, mus, days, extra); await handleCreatePayment(createReq(bar, { booking_id: r.bookingId }), makeDeps());
    const i = await intentOf(r.bookingId); const id = String(900000 + Math.floor(Math.random() * 99999)); setPayment(id, { ref: i.id, amount: Number(i.amount_ars) });
    await handleWebhook(hook(id), makeDeps()); await A.cancel(canceller, r.bookingId, '', now ? { now } : undefined); return { ...r, pid: id, amount: Number(i.amount_ars) };
  }
  it('devuelve exactamente lo que corresponde según la política y marca el reembolso como hecho', async () => {
    await A.q('update app_settings set venue_fee_bps = 500');
    const a = await paidAndCancelled(bar1, m1, 10, bar1, { policy: 'flexible' }, plus(day(10), -10 * H));            // flexible < 24 h: 50% de 105.000
    const b = await paidAndCancelled(bar2, m2, 11, m2);                                                           // el músico cancela: 100%
    clock.now = day(40);                                                                                            // los reembolsos se encolaron con el reloj simulado del test
    const st = await runRefunds(makeDeps()); assert.deepEqual([st.claimed, st.done, st.retried], [2, 2, 0]);
    const byPay = Object.fromEntries(mp.refundCalls.map((c) => [c.payment, c]));
    assert.equal(byPay[a.pid].body.amount, 52500); assert.equal(byPay[b.pid].body.amount, 105000);
    assert.deepEqual((await A.q('select status from payment_refunds order by amount')).map((r) => r.status), ['hecho', 'hecho']);
    assert.equal((await runRefunds(makeDeps())).claimed, 0);
  });
  it('si Mercado Pago falla reintenta con espera y a la 6ª queda como fallido; la clave de idempotencia es siempre la misma', async () => {
    const a = await paidAndCancelled(bar1, m1, 10, m1); mp.refundFail = 99;
    let t = 0;
    for (const wait of [0, 2, 4, 8, 16, 32]) { t += wait; clock.now = mins(t + 0.1); await runRefunds(makeDeps()); }
    const rf = (await A.q('select * from payment_refunds'))[0];
    assert.deepEqual([rf.status, rf.attempts], ['fallido', 6]); assert.match(rf.error, /mercadopago 500/);
    assert.equal(new Set(mp.refundCalls.map((c) => c.key)).size, 1); assert.equal(mp.refundCalls.length, 6);
    assert.ok(a.pid);
  });
  it('un fallo transitorio se recupera solo y no devuelve el dinero dos veces', async () => {
    const a = await paidAndCancelled(bar1, m1, 10, m1); mp.refundFail = 2;
    for (const t of [0, 3, 8]) { clock.now = mins(t + 0.1); await runRefunds(makeDeps()); }
    assert.equal((await A.q('select status from payment_refunds'))[0].status, 'hecho');
    assert.equal(mp.refundsByKey.size, 1);
    assert.ok(a.pid);
  });
  it('3 workers a la vez no repiten reembolsos (cada uno se pide a Mercado Pago una sola vez)', async () => {
    for (let k = 0; k < 6; k++) await paidAndCancelled(k % 2 ? bar1 : bar2, k % 2 ? m1 : m2, 10 + k, k % 2 ? m1 : m2);
    const res = await Promise.all([1, 2, 3].map(() => runRefunds(makeDeps(), 4)));
    assert.equal(res.reduce((a, s) => a + s.done, 0), 6);
    assert.equal(new Set(mp.refundCalls.map((c) => c.key)).size, 6); assert.equal(mp.refundCalls.length, 6);
  });
  it('el endpoint exige el secreto y solo acepta POST', async () => {
    await paidAndCancelled(bar1, m1, 10, m1);
    const call = (secret: string | null, method = 'POST', cfgSecret = 'secreto-compartido-123') =>
      handleRefundsRequest(new Request('https://f.test/process-refunds', { method, headers: secret ? { 'x-worker-secret': secret } : {} }), { secret: cfgSecret, deps: makeDeps() });
    assert.equal((await call(null)).status, 403); assert.equal((await call('mal-secreto-1234567')).status, 403); assert.equal((await call('secreto-compartido-123', 'GET')).status, 405);
    assert.equal((await call('x', 'POST', 'corto')).status, 500); assert.equal(mp.refundCalls.length, 0);
    const ok = await call('secreto-compartido-123'); assert.equal(ok.status, 200); assert.equal((await ok.json()).done, 1);
  });
  it('vence las intenciones de pago sin usar', async () => {
    const r = await accepted(bar1, m1, 10); await handleCreatePayment(createReq(bar1, { booking_id: r.bookingId }), makeDeps());
    clock.now = plus(new Date(), 25 * H); const st = await runRefunds(makeDeps());
    assert.equal(st.intentsExpired, 1); assert.equal((await intentOf(r.bookingId)).status, 'vencido');
  });
});

describe('Recorrido completo', () => {
  it('pagar → show → liberar al músico; y la variante con cancelación y reembolso: el dinero cuadra', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
    await asSystem(pool, (c) => c.query(`update profiles set payout_alias = 'ariel.musica' where user_id = $1`, [m1.userId]));
    const a = await accepted(bar1, m1, 10); const ja = await (await handleCreatePayment(createReq(bar1, { booking_id: a.bookingId }), makeDeps())).json();
    const ia = await intentOf(a.bookingId); setPayment('600001', { ref: ia.id, amount: 105000 }); await handleWebhook(hook('600001'), makeDeps());
    await A.complete(m1, a.bookingId, { now: plus(a.ends, H) });
    const po = (await A.q('select * from payouts'))[0]; assert.deepEqual([Number(po.amount_ars), po.alias_snapshot], [90000, 'ariel.musica']);
    const b = await accepted(bar2, m2, 11); await handleCreatePayment(createReq(bar2, { booking_id: b.bookingId }), makeDeps());
    const ib = await intentOf(b.bookingId); setPayment('600002', { ref: ib.id, amount: 105000 }); await handleWebhook(hook('600002'), makeDeps());
    await A.cancel(bar2, b.bookingId, '', { now: plus(b.starts, -100 * H) });                                       // moderada, >72 h: reembolso total
    clock.now = day(40); await runRefunds(makeDeps());
    assert.deepEqual(mp.refundCalls.map((c) => [c.payment, c.body.amount]), [['600002', 105000]]);
    const t = (await A.q(`select coalesce(sum(charged_ars),0)::bigint c, coalesce(sum(refunded_ars),0)::bigint r, coalesce(sum(payout_ars),0)::bigint p, coalesce(sum(platform_fee_ars),0)::bigint f from payments`))[0];
    assert.equal(Number(t.c), Number(t.r) + Number(t.p) + Number(t.f));
    assert.deepEqual([Number(t.c), Number(t.r), Number(t.p), Number(t.f)], [210000, 105000, 90000, 15000]);
    assert.ok(ja.init_point);
  });
});
