import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, asUser, checkInvariants, BizError, H, D, type Actor, type Api } from './helpers.ts';

const DB = 'suenaba_delivery';
let pool: pg.Pool, A: Api;
let bar1: Actor, m1: Actor, m2: Actor;
const day = (n: number) => new Date(Date.now() + n * D);
const mins = (n: number) => new Date(Date.now() + n * 60_000);
async function fails(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => { assert.ok(e.message === code || e.code === code, `esperaba "${code}", llegó "${e.message}" (${e.code})`); return true; });
}
/** Crea n avisos para el bar (una solicitud de reserva genera uno). */
async function mkNotifs(n: number) {
  for (let i = 0; i < n; i++) { const s = day(10 + i); const l = await A.createListing(bar1, { starts: s, ends: new Date(s.getTime() + 3 * H), cachet: 1 } as any); await A.request(i % 2 ? m2 : m1, l.id); }
}
const row = async (id: string) => (await A.q('select * from notifications where id = $1', [id]))[0];
const EP = (i: number | string) => `https://push.example.com/send/${i}`;

before(async () => { pool = await createTestDb(DB); A = api(pool); });
after(async () => { await dropTestDb(pool, DB); });
beforeEach(async () => { await resetData(pool); const w = await seedActors(pool, 1, 2); [bar1] = w.bars; [m1, m2] = w.mus; });
afterEach(async () => { const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Preferencias de avisos y dispositivos push', () => {
  it('preferencias: valores por defecto, actualización parcial, validación y privacidad', async () => {
    const a = await A.setNotifPrefs(m1, { email: false });
    assert.deepEqual([a.email_enabled, a.push_enabled, a.muted_kinds], [false, true, []]);
    const b = await A.setNotifPrefs(m1, { muted: ['message', 'search_match'] });
    assert.deepEqual([b.email_enabled, b.muted_kinds], [false, ['message', 'search_match']]);
    assert.equal((await A.setNotifPrefs(m1, { push: false })).push_enabled, false);
    await fails(A.setNotifPrefs(m1, { muted: ['MENSAJE!'] }), 'invalid_prefs');
    await fails(A.setNotifPrefs(m1, { muted: Array.from({ length: 31 }, (_, i) => 'k' + 'a'.repeat(i % 5)) }), 'invalid_prefs');
    await fails(A.setNotifPrefs(null as any, { email: true }), 'not_authenticated');
    assert.equal(await asUser(pool, m2.userId, async (c) => (await c.query('select count(*)::int n from notification_prefs')).rows[0].n), 0);
    await assert.rejects(asUser(pool, m1.userId, (c) => c.query(`update notification_prefs set email_enabled = true`)), (e: any) => e.code === '42501');
  });
  it('suscripciones: alta, validación, reasignación entre cuentas, tope de 10 y baja solo propia', async () => {
    const id = await A.regPush(m1, EP(1)); assert.ok(id);
    assert.equal(await A.regPush(m1, EP(1), 'q'.repeat(87)), id);                                  // mismo endpoint: actualiza
    assert.equal((await A.q('select p256dh from push_subscriptions'))[0].p256dh, 'q'.repeat(87));
    for (const bad of ['http://x.com/a', 'javascript:alert(1)', 'https://', 'https://a b.c', 'https://x.com/' + 'a'.repeat(1000)]) await fails(A.regPush(m1, bad), 'invalid_subscription');
    await fails(A.regPush(m1, EP(2), 'corta'), 'invalid_subscription');
    await fails(A.regPush(m1, EP(2), 'p'.repeat(87), 'x'), 'invalid_subscription');
    await fails(A.regPush(null as any, EP(2)), 'not_authenticated');
    await A.regPush(m2, EP(1));                                                                     // otra cuenta en el mismo navegador
    assert.equal((await A.q('select user_id from push_subscriptions where endpoint = $1', [EP(1)]))[0].user_id, m2.userId);
    for (let i = 10; i < 22; i++) await A.regPush(m1, EP(i));
    const mine = (await A.q('select endpoint from push_subscriptions where user_id = $1 order by created_at', [m1.userId])).map((r) => r.endpoint);
    assert.equal(mine.length, 10); assert.equal(mine.at(-1), EP(21)); assert.ok(!mine.includes(EP(10)));
    assert.equal(await A.rmPush(m2, EP(21)), false);                                                // no es suyo
    assert.equal(await A.rmPush(m1, EP(21)), true);
    assert.equal(await A.rmPush(m1, EP(21)), false);
  });
  it('las claves de los dispositivos nunca se exponen a los clientes', async () => {
    await A.regPush(m1, EP(1));
    assert.equal(await asUser(pool, m1.userId, async (c) => (await c.query('select count(*)::int n from push_subscriptions')).rows[0].n), 1);
    for (const col of ['p256dh', 'auth', 'endpoint'])
      await assert.rejects(asUser(pool, m1.userId, (c) => c.query(`select ${col} from push_subscriptions`)), (e: any) => e.code === '42501');
    assert.equal(await asUser(pool, m2.userId, async (c) => (await c.query('select count(*)::int n from push_subscriptions')).rows[0].n), 0);
  });
  it('15 altas simultáneas respetan el tope de 10 dispositivos', async () => {
    const r = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => A.regPush(m1, EP('c' + i))));
    assert.equal(r.filter((x) => x.status === 'rejected' && !(x.reason instanceof BizError)).length, 0);
    assert.ok((await A.q('select count(*)::int n from push_subscriptions where user_id = $1', [m1.userId]))[0].n <= 10);
  });
});

describe('Cola de entrega con reintentos', () => {
  it('reclama una sola vez, en orden, respetando el límite; lo reclamado no se reentrega antes de 10 minutos', async () => {
    await mkNotifs(5);
    const a = await A.claimRows(3);
    assert.equal(a.length, 3); assert.deepEqual(a.map((r) => r.delivery_attempts), [1, 1, 1]);
    const oldest3 = (await A.q('select id from notifications order by created_at, id limit 3')).map((r) => r.id).sort();
    assert.deepEqual(a.map((r) => r.id).sort(), oldest3, 'debe reclamar las más viejas primero');
    assert.equal((await A.claimRows(50)).length, 2);                                               // las otras 2
    assert.equal((await A.claimRows(50)).length, 0);
    assert.equal((await A.claimRows(50, { now: mins(9) })).length, 0);                             // todavía "en proceso"
    const stale = await A.claimRows(50, { now: mins(11) });                                        // un worker murió: se reclaman
    assert.equal(stale.length, 5); assert.deepEqual([...new Set(stale.map((r) => r.delivery_attempts))], [2]);
    assert.equal((await A.claimRows(0)).length, 0);                                                // límite mínimo 1, pero no hay nada
  });
  it('entregada: se marca y no vuelve a la cola; completar dos veces es inofensivo', async () => {
    await mkNotifs(1); const [n] = await A.claimRows(1);
    const d = await A.completeDelivery(n.id, true, null, true, true);
    assert.deepEqual([d.delivered_at !== null, d.email_sent_at !== null, d.push_sent_at !== null, d.claimed_at, d.delivery_error], [true, true, true, null, null]);
    assert.equal((await A.claimRows(50, { now: mins(1000) })).length, 0);
    const again = await A.completeDelivery(n.id, false, 'tarde');
    assert.equal(again.delivered_at !== null && again.failed_at === null, true);
    await fails(A.completeDelivery('00000000-0000-0000-0000-000000000000', true), 'notification_not_found');
  });
  it('fallos: espera creciente (2, 4, 8, 16 min) y a la 5ª falla queda como fallida para siempre', async () => {
    await mkNotifs(1);
    let t = 0;
    for (const [attempt, wait] of [[1, 2], [2, 4], [3, 8], [4, 16]] as const) {
      const [n] = await A.claimRows(1, { now: mins(t) });
      assert.equal(n.delivery_attempts, attempt);
      const f = await A.completeDelivery(n.id, false, 'smtp caído', false, false, { now: mins(t) });
      assert.equal(f.delivered_at, null); assert.equal(f.failed_at, null);
      assert.ok(Math.abs((+new Date(f.next_attempt_at) - +mins(t)) / 60_000 - wait) < 0.05, `intento ${attempt}: espera ${wait} min`);
      assert.equal((await A.claimRows(1, { now: mins(t + wait - 0.5) })).length, 0, 'todavía no toca');
      t += wait;
    }
    const [last] = await A.claimRows(1, { now: mins(t) });
    assert.equal(last.delivery_attempts, 5);
    const f = await A.completeDelivery(last.id, false, 'definitivo', false, false, { now: mins(t) });
    assert.notEqual(f.failed_at, null); assert.equal(f.delivery_error, 'definitivo');
    assert.equal((await A.claimRows(50, { now: mins(t + 10_000) })).length, 0);
  });
  it('si un canal salió bien y otro falló, queda registrado para no repetirlo en el reintento', async () => {
    await mkNotifs(1); const [n] = await A.claimRows(1);
    await A.completeDelivery(n.id, false, 'email 500', false, true);                              // push ok, email falló
    const r = await row(n.id);
    assert.deepEqual([r.push_sent_at !== null, r.email_sent_at, r.delivered_at], [true, null, null]);
    const [again] = await A.claimRows(1, { now: mins(5) });
    assert.deepEqual([again.push_sent_at !== null, again.email_sent_at, again.delivery_attempts], [true, null, 2]);
  });
  it('tres workers en paralelo se reparten los avisos sin repetir ninguno', async () => {
    await mkNotifs(12);
    const res = await Promise.all([A.claimPending(5), A.claimPending(5), A.claimPending(5), A.claimPending(5)]);
    const all = res.flat(); assert.equal(all.length, 12); assert.equal(new Set(all).size, 12);
  });
});

describe('Datos para el worker y permisos', () => {
  it('get_delivery_target devuelve email, preferencias y dispositivos (con valores por defecto)', async () => {
    const t = async (id: string) => (await asUser(pool, null, (c) => c.query('select * from public.get_delivery_target($1)', [id]), { role: 'postgres' })).rows;
    let [r] = await t(m1.userId);
    assert.deepEqual([r.email, r.email_enabled, r.push_enabled, r.muted_kinds, r.subscriptions], [`${m1.entityId}@t.com`, true, true, [], []]);
    await A.setNotifPrefs(m1, { email: false, muted: ['message'] }); await A.regPush(m1, EP(1), 'p'.repeat(87), 'a'.repeat(22)); await A.regPush(m1, EP(2));
    [r] = await t(m1.userId);
    assert.deepEqual([r.email_enabled, r.muted_kinds, r.subscriptions.map((s: any) => s.endpoint)], [false, ['message'], [EP(1), EP(2)]]);
    assert.deepEqual(Object.keys(r.subscriptions[0]).sort(), ['auth', 'endpoint', 'p256dh']);
    assert.equal((await t('00000000-0000-0000-0000-000000000000')).length, 0);
  });
  it('dispositivos caídos se eliminan y los exitosos se registran', async () => {
    await A.regPush(m1, EP(1));
    await asUser(pool, null, (c) => c.query(`select public.mark_push_success($1)`, [EP(1)]), { role: 'postgres' });
    assert.notEqual((await A.q('select last_success_at from push_subscriptions'))[0].last_success_at, null);
    const dropped = await asUser(pool, null, async (c) => (await c.query(`select public.drop_push_endpoint($1) d`, [EP(1)])).rows[0].d, { role: 'postgres' });
    assert.equal(dropped, true); assert.equal((await A.q('select count(*)::int n from push_subscriptions'))[0].n, 0);
  });
  it('las funciones del worker no son accesibles para usuarios ni visitantes', async () => {
    await mkNotifs(1);
    const n = (await A.q('select id from notifications'))[0].id;
    for (const sql of [`select * from claim_pending_notifications(5)`, `select * from complete_notification_delivery('${n}', true)`, `select * from get_delivery_target('${m1.userId}')`,
      `select drop_push_endpoint('${EP(1)}')`, `select mark_push_success('${EP(1)}')`]) {
      await assert.rejects(asUser(pool, m1.userId, (c) => c.query(sql)), (e: any) => e.code === '42501', sql);
      await assert.rejects(asUser(pool, null, (c) => c.query(sql), { role: 'anon' }), (e: any) => e.code === '42501', sql);
    }
  });
});
