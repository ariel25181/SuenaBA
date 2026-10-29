import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, asUser, checkInvariants, BizError, H, D, type Actor, type Api } from './helpers.ts';

const DB = 'suenaba_mp';
let pool: pg.Pool, A: Api;
let bar1: Actor, bar2: Actor, m1: Actor, m2: Actor;
const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const mins = (n: number) => new Date(Date.now() + n * 60_000);
let pay = 1000;
const payId = () => String(++pay);

async function fails(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => { assert.ok(e.message === code || e.code === code, `esperaba "${code}", llegó "${e.message}" (${e.code})`); return true; });
}
/** Reserva aceptada (falta pagar). */
async function accepted(bar: Actor, mus: Actor, days: number, extra: Record<string, unknown> = {}) {
  const starts = day(days), ends = plus(starts, 3 * H);
  const l = await A.createListing(bar, { starts, ends, cachet: 100000, ...extra } as any);
  const b = await A.request(mus, l.id); await A.respond(bar, b.id, true);
  return { listingId: l.id as string, bookingId: b.id as string, starts, ends };
}
/** Reserva con pago aprobado por Mercado Pago. */
async function paid(bar: Actor, mus: Actor, days: number, extra: Record<string, unknown> = {}) {
  const r = await accepted(bar, mus, days, extra);
  const i = await A.beginPay(bar, r.bookingId); const mp = payId();
  await A.confirmIntent(i.id, mp, i.amount_ars);
  return { ...r, intentId: i.id as string, mp, amount: Number(i.amount_ars) };
}
const intent = async (id: string) => (await A.q('select * from payment_intents where id = $1', [id]))[0];
const payment = async (bookingId: string) => (await A.q('select * from payments where booking_id = $1', [bookingId]))[0];
const bstatus = async (id: string) => (await A.q('select status from bookings where id = $1', [id]))[0].status as string;
const refunds = async (bookingId?: string) => (await A.q(`select * from payment_refunds ${bookingId ? 'where booking_id = $1' : ''} order by created_at, id`, bookingId ? [bookingId] : []));
const kinds = async (a: Actor) => (await A.q('select kind from notifications where user_id = $1 order by created_at', [a.userId])).map((r) => r.kind as string);

before(async () => { pool = await createTestDb(DB); A = api(pool); });
after(async () => { await dropTestDb(pool, DB); });
beforeEach(async () => { await resetData(pool); const w = await seedActors(pool, 2, 2); [bar1, bar2] = w.bars; [m1, m2] = w.mus; await A.q(`update app_settings set payment_mode = 'mercadopago'`); });
afterEach(async () => { const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Iniciar un pago', () => {
  it('crea la intención con el monto congelado, la reutiliza y la reemplaza si cambia el monto', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
    const r = await accepted(bar1, m1, 10);
    const i = await A.beginPay(bar1, r.bookingId);
    assert.deepEqual([i.status, Number(i.cachet_ars), Number(i.venue_fee_ars), Number(i.amount_ars), i.venue_fee_bps, i.musician_fee_bps, i.external_reference], ['pendiente', 100000, 5000, 105000, 500, 1000, i.id]);
    assert.ok(new Date(i.expires_at) > new Date() && new Date(i.expires_at) <= new Date(Date.now() + 24 * H + 5000));
    assert.equal((await A.beginPay(bar1, r.bookingId)).id, i.id);                                   // el bar reabre el link: misma intención
    await A.attachPref(i.id, 'pref-1', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1');
    assert.equal((await A.attachPref(i.id, 'pref-2', 'https://otra.example/x')).preference_id, 'pref-1');   // no se pisa
    assert.equal((await A.beginPay(bar1, r.bookingId)).init_point, 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1');
    await A.q('update app_settings set venue_fee_bps = 1000');                                         // cambió la comisión: no se reutiliza un monto viejo
    const j = await A.beginPay(bar1, r.bookingId);
    assert.notEqual(j.id, i.id); assert.equal(Number(j.amount_ars), 110000);
    assert.equal((await intent(i.id)).status, 'cancelado');
    assert.equal((await A.q(`select count(*)::int n from payment_intents where status = 'pendiente'`))[0].n, 1);
  });
  it('una intención vencida se reemplaza por una nueva', async () => {
    const r = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, r.bookingId);
    await A.q(`update payment_intents set expires_at = now() - interval '1 minute'`);
    const j = await A.beginPay(bar1, r.bookingId);
    assert.notEqual(j.id, i.id); assert.equal((await intent(i.id)).status, 'vencido');
  });
  it('valida modo, dueño, estado y vencimiento', async () => {
    const r = await accepted(bar1, m1, 10);
    await fails(A.beginPay(bar2, r.bookingId), 'booking_not_found');
    await fails(A.beginPay(m1, r.bookingId), 'booking_not_found');
    await fails(A.beginPay(bar1, '00000000-0000-0000-0000-000000000000'), 'booking_not_found');
    await fails(A.beginPay(bar1, r.bookingId, { now: plus(new Date(), 49 * H) }), 'booking_expired');
    await fails(A.beginPay(bar1, r.bookingId, { now: plus(r.starts, H) }), 'booking_expired');
    const l = await A.createListing(bar2, { starts: day(12), ends: plus(day(12), 3 * H), cachet: 1 } as any); const sol = await A.request(m2, l.id);
    await fails(A.beginPay(bar2, sol.id), 'invalid_state');                                              // solicitada: todavía no aceptó
    await A.q(`update app_settings set payment_mode = 'simulado'`);
    await fails(A.beginPay(bar1, r.bookingId), 'payments_disabled');
  });
  it('no se puede pagar dos veces ni pagar una reserva cancelada', async () => {
    const p = await paid(bar1, m1, 10);
    await fails(A.beginPay(bar1, p.bookingId), 'already_paid');
    const c = await accepted(bar2, m2, 11); await A.cancel(bar2, c.bookingId);
    await fails(A.beginPay(bar2, c.bookingId), 'invalid_state');
  });
  it('una reserva gratuita se confirma sin pasar por Mercado Pago', async () => {
    const r = await accepted(bar1, m1, 10, { cachet: 0 });
    const i = await A.beginPay(bar1, r.bookingId);
    assert.deepEqual([i.status, Number(i.amount_ars), i.mp_status], ['aprobado', 0, 'free']);
    assert.equal(await bstatus(r.bookingId), 'confirmada'); assert.equal((await payment(r.bookingId)).provider, 'gratis');
  });
  it('el pago simulado queda bloqueado cuando el modo es Mercado Pago (y sigue funcionando en modo simulado)', async () => {
    const r = await accepted(bar1, m1, 10);
    await fails(A.fund(bar1, r.bookingId), 'payment_required');
    await A.q(`update app_settings set payment_mode = 'simulado'`);
    assert.equal((await A.fund(bar1, r.bookingId)).status, 'confirmada'); assert.equal((await payment(r.bookingId)).provider, 'simulado');
  });
});

describe('Confirmar un pago (webhook)', () => {
  it('pago aprobado: confirma la reserva con la comisión congelada y avisa al músico', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
    const r = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, r.bookingId);
    await A.q('update app_settings set venue_fee_bps = 3000, musician_fee_bps = 3000');                  // cambia después: no debe afectar
    const done = await A.confirmIntent(i.id, '5550001', 105000);
    assert.deepEqual([done.status, done.mp_payment_id, done.mp_status], ['aprobado', '5550001', 'approved']);
    assert.equal(await bstatus(r.bookingId), 'confirmada');
    const p = await payment(r.bookingId);
    assert.deepEqual([p.provider, p.provider_ref, Number(p.charged_ars), Number(p.venue_fee_ars), p.venue_fee_bps, p.musician_fee_bps, p.status], ['mercadopago', '5550001', 105000, 5000, 500, 1000, 'held']);
    assert.ok((await kinds(m1)).includes('booking_funded'));
  });
  it('el mismo aviso repetido no cobra dos veces; un segundo pago distinto se devuelve (doble cobro)', async () => {
    const r = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, r.bookingId);
    for (let k = 0; k < 3; k++) await A.confirmIntent(i.id, '7001', 100000);
    assert.equal((await A.q('select count(*)::int n from payments'))[0].n, 1);
    await A.confirmIntent(i.id, '7002', 100000);
    const rf = await refunds(r.bookingId);
    assert.deepEqual([rf.length, rf[0].reason, rf[0].mp_payment_id, Number(rf[0].amount)], [1, 'doble_cobro', '7002', 100000]);
    await A.confirmIntent(i.id, '7002', 100000, 'ARS', 'approved');                                       // repetido: no duplica el reembolso
    assert.equal((await refunds(r.bookingId)).length, 1);
    await A.confirmIntent(i.id, '7003', 100000, 'ARS', 'rejected');                                       // un pago rechazado no genera reembolso
    assert.equal((await refunds(r.bookingId)).length, 1);
  });
  it('estados no aprobados (pendiente, rechazado) no confirman; un pago aprobado posterior sí', async () => {
    const r = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, r.bookingId);
    for (const st of ['pending', 'in_process', 'rejected', 'cancelled']) {
      const x = await A.confirmIntent(i.id, payId(), 100000, 'ARS', st);
      assert.deepEqual([x.status, x.mp_status, x.mp_payment_id], ['pendiente', st, null]);
    }
    assert.equal(await bstatus(r.bookingId), 'aceptada');
    assert.equal((await A.confirmIntent(i.id, payId(), 100000)).status, 'aprobado'); assert.equal(await bstatus(r.bookingId), 'confirmada');
  });
  it('monto o moneda distintos: no se confirma y se devuelve lo cobrado', async () => {
    const a = await accepted(bar1, m1, 10); const ia = await A.beginPay(bar1, a.bookingId);
    const x = await A.confirmIntent(ia.id, '8001', '99999.50');
    assert.equal(x.status, 'discrepancia'); assert.equal(await bstatus(a.bookingId), 'aceptada');
    assert.deepEqual([(await refunds(a.bookingId))[0].reason, Number((await refunds(a.bookingId))[0].amount)], ['discrepancia', 99999.5]);
    const b = await accepted(bar2, m2, 11); const ib = await A.beginPay(bar2, b.bookingId);
    assert.equal((await A.confirmIntent(ib.id, '8002', 100000, 'USD')).status, 'discrepancia');
    assert.equal(await bstatus(b.bookingId), 'aceptada');
    // la reserva sigue disponible: puede pagar bien con una intención nueva
    await A.q(`update payment_intents set status = 'cancelado' where id = $1`, [ib.id]);
    const ib2 = await A.beginPay(bar2, b.bookingId); await A.confirmIntent(ib2.id, '8003', 100000);
    assert.equal(await bstatus(b.bookingId), 'confirmada');
  });
  it('pago tardío (reserva cancelada, vencida o ya empezada): no confirma y devuelve el dinero', async () => {
    const a = await accepted(bar1, m1, 10); const ia = await A.beginPay(bar1, a.bookingId); await A.cancel(bar1, a.bookingId);
    assert.equal((await A.confirmIntent(ia.id, '9001', 100000)).status, 'reembolsar'); assert.equal(await bstatus(a.bookingId), 'cancelada');
    assert.deepEqual([(await refunds(a.bookingId))[0].reason, Number((await refunds(a.bookingId))[0].amount)], ['pago_tardio', 100000]);
    assert.ok((await kinds(bar1)).includes('payment_refund'));
    const b = await accepted(bar2, m2, 11); const ib = await A.beginPay(bar2, b.bookingId);
    await A.expireStale({ now: plus(new Date(), 49 * H) });                                              // venció la reserva
    assert.equal(await bstatus(b.bookingId), 'expirada');
    assert.equal((await A.confirmIntent(ib.id, '9002', 100000)).status, 'reembolsar');
    const c = await accepted(bar1, m2, 14); const ic = await A.beginPay(bar1, c.bookingId);
    assert.equal((await A.confirmIntent(ic.id, '9003', 100000, 'ARS', 'approved', { now: plus(c.starts, H) })).status, 'reembolsar');   // el show ya empezó
    assert.equal(await bstatus(c.bookingId), 'aceptada');
  });
  it('rechaza datos inválidos y las funciones del sistema no son accesibles para usuarios', async () => {
    const r = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, r.bookingId);
    await fails(A.confirmIntent(i.id, 'abc', 100000), 'invalid_payment');
    await fails(A.confirmIntent(i.id, '', 100000), 'invalid_payment');
    await fails(A.confirmIntent('00000000-0000-0000-0000-000000000000', '1', 1), 'intent_not_found');
    await fails(A.attachPref(i.id, 'p', 'http://inseguro.test/x'), 'invalid_preference');
    await fails(A.attachPref(i.id, 'p', 'javascript:alert(1)'), 'invalid_preference');
    for (const sql of [`select * from confirm_payment_intent('${i.id}','1',1,'ARS','approved')`, `select * from attach_preference('${i.id}','p','https://x.test/')`, `select * from claim_pending_refunds(5)`,
      `select * from complete_refund(gen_random_uuid(), true)`, `select expire_stale_intents()`, `select * from admin_mark_payout_paid(gen_random_uuid(), 'ref-123')`, `select _enqueue_refund('${r.bookingId}','1',1,'disputa')`]) {
      await assert.rejects(asUser(pool, bar1.userId, (c) => c.query(sql)), (e: any) => e.code === '42501', sql);
      await assert.rejects(asUser(pool, null, (c) => c.query(sql), { role: 'anon' }), (e: any) => e.code === '42501', sql);
    }
  });
  it('10 avisos simultáneos del mismo pago confirman la reserva una sola vez', async () => {
    const r = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, r.bookingId);
    const res = await Promise.allSettled(Array.from({ length: 10 }, () => A.confirmIntent(i.id, '4242', 100000)));
    assert.ok(res.every((x) => x.status === 'fulfilled'), JSON.stringify(res.filter((x) => x.status === 'rejected')));
    assert.equal((await A.q('select count(*)::int n from payments'))[0].n, 1);
    assert.equal((await A.q(`select count(*)::int n from booking_events where event = 'confirmada'`))[0].n, 1);
    assert.equal((await refunds()).length, 0);
  });
  it('carrera pago vs cancelación (20 reservas): siempre queda consistente y el dinero nunca se pierde', async () => {
    const items: { r: any; i: any }[] = [];
    for (let k = 0; k < 20; k++) { const bar = k % 2 ? bar1 : bar2, mus = k % 3 ? m1 : m2; const r = await accepted(bar, mus, 10 + k, { cachet: 50000 }).catch(() => null); if (r) items.push({ r, i: await A.beginPay(bar, r.bookingId).catch(() => null) }); }
    const ok = items.filter((x) => x.i);
    assert.ok(ok.length >= 10, 'no se armaron suficientes reservas para la carrera');
    await Promise.allSettled(ok.flatMap(({ r, i }, k) => [
      A.confirmIntent(i.id, String(6000 + k), 50000),
      A.cancel(i.venue_id ? bar1 : (r.bookingId ? (k % 2 ? bar1 : bar2) : bar1), r.bookingId),
    ]));
    const bad = await checkInvariants(pool, { singlePublishedAllowed: true });
    assert.deepEqual(bad, [], bad.join('\n'));
    for (const { r, i } of ok) {                                                                         // cada pago aprobado terminó confirmado-y-luego-cancelado o devuelto
      const it = await intent(i.id), st = await bstatus(r.bookingId);
      assert.ok((it.status === 'aprobado' && ['confirmada', 'cancelada'].includes(st)) || (it.status === 'reembolsar' && st === 'cancelada'), `${it.status}/${st}`);
    }
  });
});

describe('Reembolsos reales y cola', () => {
  it('cancelar una reserva pagada encola el reembolso exacto según la política', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
    const a = await paid(bar1, m1, 10, { policy: 'flexible' });
    await A.cancel(bar1, a.bookingId, '', { now: plus(a.starts, -10 * H) });                              // flexible < 24 h => 50%
    let rf = await refunds(a.bookingId);
    assert.deepEqual([rf.length, rf[0].reason, rf[0].mp_payment_id, Number(rf[0].amount)], [1, 'cancelacion', a.mp, 52500]);
    const b = await paid(bar2, m2, 11);
    await A.cancel(m2, b.bookingId);                                                                     // el músico cancela: reembolso total
    rf = await refunds(b.bookingId); assert.equal(Number(rf[0].amount), 105000);
    const c = await paid(bar1, m2, 12, { policy: 'estricta' });
    await A.cancel(bar1, c.bookingId, '', { now: plus(c.starts, -5 * H) });                               // 0%: nada para devolver
    assert.equal((await refunds(c.bookingId)).length, 0);
  });
  it('una disputa resuelta con reembolso parcial o total lo encola; las reservas sin Mercado Pago no', async () => {
    const a = await paid(bar1, m1, 10), b = await paid(bar2, m2, 11);
    for (const x of [a, b]) await A.report(x === a ? bar1 : bar2, x.bookingId, 'problema', { now: plus(x.ends, H) });
    await A.resolveDispute(a.bookingId, 30); await A.resolveDispute(b.bookingId, 100);
    assert.deepEqual([(await refunds(a.bookingId))[0].reason, Number((await refunds(a.bookingId))[0].amount)], ['disputa', 30000]);
    assert.equal(Number((await refunds(b.bookingId))[0].amount), 100000);
    await A.q(`update app_settings set payment_mode = 'simulado'`);
    const s = await accepted(bar1, m1, 20); await A.fund(bar1, s.bookingId); await A.cancel(m1, s.bookingId);
    assert.equal((await refunds(s.bookingId)).length, 0);
  });
  it('la cola reintenta con espera creciente, se recupera de workers caídos y termina en "fallido"', async () => {
    const a = await paid(bar1, m1, 10); await A.cancel(m1, a.bookingId);
    let t = 0;
    for (const [attempt, wait] of [[1, 2], [2, 4], [3, 8], [4, 16], [5, 32]] as const) {
      const [r] = await A.claimRefunds(5, { now: mins(t) }); assert.equal(r.attempts, attempt);
      const f = await A.completeRefund(r.id, false, null, 'mp 500', { now: mins(t) });
      assert.equal(f.status, 'pendiente'); assert.ok(Math.abs((+new Date(f.next_attempt_at) - +mins(t)) / 60_000 - wait) < 0.05);
      assert.equal((await A.claimRefunds(5, { now: mins(t + wait - 0.5) })).length, 0); t += wait;
    }
    const [last] = await A.claimRefunds(5, { now: mins(t) }); assert.equal(last.attempts, 6);
    assert.equal((await A.completeRefund(last.id, false, null, 'definitivo', { now: mins(t) })).status, 'fallido');
    assert.equal((await A.claimRefunds(5, { now: mins(t + 10_000) })).length, 0);
    const b = await paid(bar2, m2, 11); await A.cancel(m2, b.bookingId);
    assert.equal((await A.claimRefunds(5)).length, 1); assert.equal((await A.claimRefunds(5, { now: mins(5) })).length, 0);       // en proceso
    assert.equal((await A.claimRefunds(5, { now: mins(11) })).length, 1);                                                       // worker caído: se reclama
  });
  it('un reembolso hecho cierra el pago tardío y es idempotente', async () => {
    const a = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, a.bookingId); await A.cancel(bar1, a.bookingId);
    await A.confirmIntent(i.id, '9100', 100000);
    const [r] = await A.claimRefunds(5);
    const done = await A.completeRefund(r.id, true, 'refund-77');
    assert.deepEqual([done.status, done.mp_refund_id], ['hecho', 'refund-77']); assert.equal((await intent(i.id)).status, 'reembolsado');
    assert.equal((await A.completeRefund(r.id, false, null, 'x')).status, 'hecho');
    await fails(A.completeRefund('00000000-0000-0000-0000-000000000000', true), 'refund_not_found');
  });
  it('varios workers a la vez reclaman reembolsos distintos', async () => {
    for (let k = 0; k < 6; k++) { const x = await paid(k % 2 ? bar1 : bar2, k % 2 ? m1 : m2, 10 + k); await A.cancel(k % 2 ? m1 : m2, x.bookingId); }
    const res = await Promise.all([1, 2, 3].map(() => A.claimRefunds(3)));
    const ids = res.flat().map((r) => r.id); assert.equal(ids.length, 6); assert.equal(new Set(ids).size, 6);
  });
});

describe('Pagos a músicos', () => {
  it('al realizarse el show se crea el pago pendiente con el alias; el alias se valida y se actualiza', async () => {
    await A.q('update app_settings set musician_fee_bps = 1000');
    await A.setAlias(m1, 'ariel.musica');
    const a = await paid(bar1, m1, 10); await A.complete(m1, a.bookingId, { now: plus(a.ends, H) });
    const po = (await A.q('select * from payouts'))[0];
    assert.deepEqual([po.booking_id, Number(po.amount_ars), po.alias_snapshot, po.status], [a.bookingId, 90000, 'ariel.musica', 'pendiente']);
    await A.setAlias(m1, '0000003100012345678901');                                                      // CVU de 22 dígitos
    assert.equal((await A.q('select alias_snapshot from payouts'))[0].alias_snapshot, '0000003100012345678901');
    for (const bad of ['x', 'con espacios', 'a'.repeat(21), '123', 'ñandú.alias', '0000003100012345678']) await fails(A.setAlias(m1, bad), 'invalid_alias');
    await fails(A.setAlias(bar1, 'bar.alias.ok'), 'forbidden_role');
    await A.setAlias(m1, null); assert.equal((await A.q('select payout_alias from profiles where user_id = $1', [m1.userId]))[0].payout_alias, null);
  });
  it('el equipo marca el pago como transferido: exige alias y referencia, es idempotente y avisa al músico', async () => {
    const a = await paid(bar1, m1, 10); await A.complete(m1, a.bookingId, { now: plus(a.ends, H) });
    const id = (await A.q('select id from payouts'))[0].id;
    await fails(A.markPaid(id, 'transf-001'), 'alias_missing');
    await A.setAlias(m1, 'ariel.musica');
    await fails(A.markPaid(id, ' '), 'invalid_reference');
    await fails(A.markPaid('00000000-0000-0000-0000-000000000000', 'transf-001'), 'payout_not_found');
    const p1 = await A.markPaid(id, 'transf-001'), p2 = await A.markPaid(id, 'otra-ref');
    assert.deepEqual([p1.status, p1.reference, p2.reference], ['pagado', 'transf-001', 'transf-001']);
    assert.ok((await kinds(m1)).includes('payout_paid'));
  });
  it('cada músico ve solo sus pagos y no puede modificarlos; las cancelaciones totales no generan pago', async () => {
    const a = await paid(bar1, m1, 10); await A.complete(m1, a.bookingId, { now: plus(a.ends, H) });
    const b = await paid(bar2, m2, 11); await A.cancel(m2, b.bookingId);
    assert.equal((await A.q('select count(*)::int n from payouts'))[0].n, 1);
    const see = (u: Actor) => asUser(pool, u.userId, async (c) => (await c.query('select count(*)::int n from payouts')).rows[0].n);
    assert.deepEqual([await see(m1), await see(m2), await see(bar1)], [1, 0, 0]);
    await assert.rejects(asUser(pool, m1.userId, (c) => c.query(`update payouts set status = 'pagado'`)), (e: any) => e.code === '42501');
    await assert.rejects(asUser(pool, m1.userId, (c) => c.query(`select alias_snapshot from payouts`)), (e: any) => e.code === '42501');   // el alias no se expone por la API
  });
});

describe('Vencimientos y visibilidad', () => {
  it('las intenciones sin pagar vencen', async () => {
    const a = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, a.bookingId);
    assert.equal(await A.expireIntents(), 0);
    assert.equal(await A.expireIntents({ now: plus(new Date(), 25 * H) }), 1);
    assert.equal((await intent(i.id)).status, 'vencido');
  });
  it('solo el bar de la reserva ve su intención (sin el id del pago de Mercado Pago) y los reembolsos', async () => {
    const a = await accepted(bar1, m1, 10); const i = await A.beginPay(bar1, a.bookingId);
    await A.attachPref(i.id, 'pref-1', 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1');
    const count = (u: Actor) => asUser(pool, u.userId, async (c) => (await c.query('select count(*)::int n from payment_intents')).rows[0].n);
    assert.deepEqual([await count(bar1), await count(bar2), await count(m1), await count(m2)], [1, 0, 0, 0]);
    const row = await asUser(pool, bar1.userId, async (c) => (await c.query('select id, status, amount_ars, init_point from payment_intents')).rows[0]);
    assert.equal(row.init_point, 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1');
    for (const col of ['mp_payment_id', 'external_reference', 'preference_id'])
      await assert.rejects(asUser(pool, bar1.userId, (c) => c.query(`select ${col} from payment_intents`)), (e: any) => e.code === '42501', col);
    await assert.rejects(asUser(pool, bar1.userId, (c) => c.query(`update payment_intents set status = 'aprobado'`)), (e: any) => e.code === '42501');
    await assert.rejects(asUser(pool, null, (c) => c.query(`select * from payment_intents`), { role: 'anon' }), (e: any) => e.code === '42501');
  });
});
