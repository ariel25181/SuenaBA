import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, asUser, checkInvariants, H, D, type Actor, type Api } from './helpers.ts';

const DB = 'suenaba_tour';
let pool: pg.Pool, A: Api;
let bar1: Actor, bar2: Actor, m1: Actor, m2: Actor;
const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
async function fails(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => { assert.ok(e.message === code || e.code === code, `esperaba "${code}", llegó "${e.message}" (${e.code})`); return true; });
}
async function confirmed(bar: Actor, mus: Actor, days: number, extra: Record<string, unknown> = {}) {
  const starts = day(days), ends = plus(starts, 3 * H);
  const l = await A.createListing(bar, { starts, ends, cachet: 100000, ...extra } as any);
  const b = await A.request(mus, l.id); await A.respond(bar, b.id, true); await A.fund(bar, b.id);
  return { id: l.id as string, bookingId: b.id as string, starts, ends };
}

before(async () => { pool = await createTestDb(DB); A = api(pool); });
after(async () => { await dropTestDb(pool, DB); });
beforeEach(async () => { await resetData(pool); const w = await seedActors(pool, 2, 2); [bar1, bar2] = w.bars; [m1, m2] = w.mus; });
afterEach(async () => { const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Preferencias (tipo de uso, tour y novedades)', () => {
  it('guarda, actualiza y solo cada usuario ve las suyas', async () => {
    const r1 = await A.savePrefs(m1.userId, { audience: 'musico', tour: 1, seen: 3 });
    assert.deepEqual([r1.audience, r1.tour_version, r1.whats_new_seen], ['musico', 1, 3]);
    const r2 = await A.savePrefs(m1.userId, { seen: 7 });
    assert.deepEqual([r2.audience, r2.tour_version, r2.whats_new_seen], ['musico', 1, 7]);          // conserva lo anterior
    assert.equal(await asUser(pool, m2.userId, async (c) => (await c.query('select count(*)::int n from user_prefs')).rows[0].n), 0);
    assert.equal(await asUser(pool, m1.userId, async (c) => (await c.query('select count(*)::int n from user_prefs')).rows[0].n), 1);
  });
  it('los contadores solo avanzan (un dispositivo viejo no los retrocede)', async () => {
    await A.savePrefs(bar1.userId, { audience: 'anfitrion', tour: 3, seen: 10 });
    const r = await A.savePrefs(bar1.userId, { tour: 1, seen: 2 });
    assert.deepEqual([r.tour_version, r.whats_new_seen], [3, 10]);
  });
  it('permite cambiar el tipo de uso y funciona también sin perfil (público)', async () => {
    const u = randomUUID(); await A.q('insert into auth.users (id, email) values ($1, $2)', [u, 'publico@t.com']);
    assert.equal((await A.savePrefs(u, { audience: 'publico' })).audience, 'publico');
    assert.equal((await A.savePrefs(u, { audience: 'musico' })).audience, 'musico');
  });
  it('valida entradas, sesión y bloquea escrituras directas', async () => {
    await fails(A.savePrefs(m1.userId, { audience: 'dj' }), 'invalid_prefs');
    await fails(A.savePrefs(m1.userId, { tour: -1 }), 'invalid_prefs');
    await fails(A.savePrefs(m1.userId, { seen: 2_000_000 }), 'invalid_prefs');
    await fails(A.savePrefs(null, { audience: 'musico' }), 'not_authenticated');
    for (const sql of [`insert into user_prefs (user_id) values (gen_random_uuid())`, `update user_prefs set tour_version = 99`, `delete from user_prefs`])
      await fails(asUser(pool, m1.userId, (c) => c.query(sql)), '42501');
    await assert.rejects(asUser(pool, null, (c) => c.query('select * from user_prefs'), { role: 'anon' }), (e: any) => e.code === '42501');
  });
  it('20 guardados simultáneos del mismo usuario no fallan y dejan el máximo', async () => {
    const res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => A.savePrefs(m1.userId, { audience: 'musico', tour: i % 5, seen: i })));
    assert.ok(res.every((r) => r.status === 'fulfilled'), JSON.stringify(res.filter((r) => r.status === 'rejected')));
    const r = (await A.q('select * from user_prefs where user_id = $1', [m1.userId]))[0];
    assert.deepEqual([r.tour_version, r.whats_new_seen], [4, 19]);
  });
});

describe('Cartelera pública (upcoming_shows)', () => {
  it('muestra solo shows confirmados por venir, sin datos de dinero ni de usuarios, y es pública', async () => {
    await A.q(`update musicians set genres = '{Tango}' where id = $1`, [m1.entityId]);
    const ok = await confirmed(bar1, m1, 10, { genres: ['Jazz'] });
    const pendingL = await A.createListing(bar2, { starts: day(11), ends: plus(day(11), 3 * H), cachet: 5 } as any); await A.request(m2, pendingL.id);   // solo solicitada
    const accepted = await A.createListing(bar2, { starts: day(12), ends: plus(day(12), 3 * H), cachet: 5 } as any); const ab = await A.request(m2, accepted.id); await A.respond(bar2, ab.id, true);  // sin pagar
    const cancelled = await confirmed(bar2, m2, 13); await A.cancel(bar2, cancelled.bookingId);
    const disputed = await confirmed(bar1, m2, 20); await A.report(bar1, disputed.bookingId, 'x', { now: plus(disputed.starts, H) });
    const rows = await A.shows();
    assert.deepEqual(rows.map((r) => r.booking_id), [ok.bookingId, disputed.bookingId].filter((id) => id === ok.bookingId));
    const r = rows[0];
    assert.deepEqual([r.venue_name, r.musician_name, Number(r.total_count)], ['Bar 1', 'Músico 1', 1]);
    assert.deepEqual([...r.genres].sort(), ['Jazz', 'Tango']);
    for (const k of Object.keys(r)) assert.ok(!/cachet|ars|fee|user|payment|note/i.test(k), `campo sensible expuesto: ${k}`);
  });
  it('filtros, orden, paginación y límites', async () => {
    await A.q(`update venues set neighborhood = 'San Telmo' where id = $1`, [bar2.entityId]);
    const a = await confirmed(bar1, m1, 12, { genres: ['Jazz'] }), b = await confirmed(bar2, m2, 10, { genres: ['Rock'] }), c = await confirmed(bar1, m2, 14, { genres: ['Jazz'] });
    assert.deepEqual((await A.shows()).map((r) => r.booking_id), [b.bookingId, a.bookingId, c.bookingId]);
    assert.deepEqual((await A.shows({ neighborhoods: ['San Telmo'] })).map((r) => r.booking_id), [b.bookingId]);
    assert.deepEqual((await A.shows({ genres: ['Jazz'] })).map((r) => r.booking_id), [a.bookingId, c.bookingId]);
    assert.deepEqual((await A.shows({ from: plus(a.starts, -H).toISOString(), to: plus(a.starts, H).toISOString() })).map((r) => r.booking_id), [a.bookingId]);
    const p1 = await A.shows({ limit: 2 }), p2 = await A.shows({ limit: 2, offset: 2 });
    assert.deepEqual([...p1, ...p2].map((r) => r.booking_id), [b.bookingId, a.bookingId, c.bookingId]);
    assert.deepEqual([p1[0].total_count, p2[0].total_count].map(Number), [3, 3]);
    assert.equal((await A.shows({ limit: 0 })).length, 1);
    assert.equal((await A.shows({ limit: 9999 })).length, 3);
    assert.equal((await A.shows({ offset: -4 })).length, 3);
  });
  it('un show deja de aparecer al empezar', async () => {
    const a = await confirmed(bar1, m1, 10);
    assert.equal((await A.shows()).length, 1);
    assert.equal((await A.shows({}, { now: plus(a.starts, 1) })).length, 0);
  });
});
