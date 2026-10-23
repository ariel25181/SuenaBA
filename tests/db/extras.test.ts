import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, asUser, checkInvariants, BizError, H, D, BAR_KEYS, MUS_KEYS, type Actor, type Api } from './helpers.ts';

const DB = 'suenaba_extras';
let pool: pg.Pool, A: Api;
let bar1: Actor, bar2: Actor, bar3: Actor, m1: Actor, m2: Actor, m3: Actor;

const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
async function listing(a: Actor, days: number, extra: Record<string, unknown> = {}) {
  const starts = day(days), ends = plus(starts, 3 * H);
  const row = await A.createListing(a, { starts, ends, cachet: 100000, ...extra } as any);
  return { row, id: row.id as string, starts, ends };
}
async function confirmed(bar: Actor, mus: Actor, days: number, extra: Record<string, unknown> = {}) {
  const l = await listing(bar, days, extra);
  const b = await A.request(mus, l.id); await A.respond(bar, b.id, true); await A.fund(bar, b.id);
  return { ...l, bookingId: b.id as string };
}
async function fails(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => { assert.ok(e.message === code || e.code === code, `esperaba "${code}", llegó "${e.message}" (${e.code})`); return true; });
}
const notifs = async (a: Actor | string, extra = '') => A.q(`select kind, booking_id, listing_id, read_at from notifications where user_id = $1 ${extra} order by created_at, id`, [typeof a === 'string' ? a : a.userId]);
const kinds = async (a: Actor | string) => (await notifs(a)).map((n) => n.kind as string);

before(async () => { pool = await createTestDb(DB); A = api(pool); });
after(async () => { await dropTestDb(pool, DB); });
beforeEach(async () => { await resetData(pool); const w = await seedActors(pool, 3, 3); [bar1, bar2, bar3] = w.bars; [m1, m2, m3] = w.mus; });
afterEach(async () => { const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Favoritos', () => {
  it('agregar y quitar (listing, bar y músico); cada uno ve solo los suyos', async () => {
    const l = await listing(bar1, 10);
    assert.equal(await A.toggleFav(m1, 'listing', l.id), true);
    assert.equal(await A.toggleFav(m1, 'venue', bar1.entityId), true);
    assert.equal(await A.toggleFav(bar1, 'musician', m1.entityId), true);
    const mine = await asUser(pool, m1.userId, async (c) => (await c.query('select kind from favorites order by kind')).rows.map((r) => r.kind));
    assert.deepEqual(mine, ['listing', 'venue']);
    assert.equal(await asUser(pool, m2.userId, async (c) => (await c.query('select count(*)::int n from favorites')).rows[0].n), 0);
    assert.equal(await A.toggleFav(m1, 'listing', l.id), false);
    assert.equal((await A.q('select count(*)::int n from favorites where user_id = $1', [m1.userId]))[0].n, 1);
  });
  it('valida destino, tipo, sesión y tope', async () => {
    const l = await listing(bar1, 10); await A.cancelListing(bar1, l.id);
    await fails(A.toggleFav(m1, 'listing', l.id), 'target_not_found');
    await fails(A.toggleFav(m1, 'listing', 'no-es-uuid'), 'target_not_found');
    await fails(A.toggleFav(m1, 'venue', 'inexistente'), 'target_not_found');
    await fails(A.toggleFav(m1, 'musician', bar1.entityId), 'target_not_found');
    await fails(A.toggleFav(m1, 'cosa', bar1.entityId), 'invalid_favorite');
    await fails(A.toggleFav(randomUUID(), 'venue', bar1.entityId), 'no_profile');
    await A.q(`insert into favorites select $1, 'listing', gen_random_uuid()::text from generate_series(1, 500)`, [m1.userId]);
    await fails(A.toggleFav(m1, 'venue', bar1.entityId), 'favorites_limit');
    await assert.rejects(asUser(pool, null, (c) => c.query(`select * from favorites`), { role: 'anon' }), (e: any) => e.code === '42501');
  });
  it('20 toggles simultáneos del mismo destino no rompen nada', async () => {
    const res = await Promise.allSettled(Array.from({ length: 20 }, () => A.toggleFav(m1, 'venue', bar1.entityId)));
    assert.ok(res.every((r) => r.status === 'fulfilled'), JSON.stringify(res.filter((r) => r.status === 'rejected')));
    const n = (await A.q('select count(*)::int n from favorites'))[0].n;
    assert.ok(n === 0 || n === 1);
  });
});

describe('Notificaciones', () => {
  it('flujo normal: cada evento avisa a la contraparte correcta (nunca a uno mismo)', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    assert.deepEqual([await kinds(bar1), await kinds(m1)], [['booking_requested'], []]);
    await A.respond(bar1, b.id, true);
    assert.deepEqual(await kinds(m1), ['booking_accepted']);
    await A.fund(bar1, b.id);
    assert.deepEqual(await kinds(m1), ['booking_accepted', 'booking_funded']);
    await A.message(m1, b.id, 'Llevamos bajo propio');
    assert.deepEqual(await kinds(bar1), ['booking_requested', 'message']);
    await A.message(bar1, b.id, 'Perfecto');
    assert.deepEqual(await kinds(m1), ['booking_accepted', 'booking_funded', 'message']);
    const t = plus(l.ends, H);
    await A.complete(m1, b.id, { now: t });
    assert.equal((await kinds(bar1)).filter((k) => k === 'review_invite').length, 1);
    assert.equal((await kinds(m1)).filter((k) => k === 'review_invite').length, 1);
    await A.review(bar1, b.id, 5, BAR_KEYS, '', { now: t });
    assert.ok((await kinds(m1)).includes('review_pending'));
    assert.equal((await notifs(bar1)).every((n) => n.booking_id === b.id), true);
    assert.equal((await A.q('select count(*)::int n from notifications where user_id not in (select user_id from profiles)'))[0].n, 0);
  });
  it('reserva instantánea y solicitudes que pierden la fecha', async () => {
    const li = await listing(bar1, 10, { mode: 'instant' });
    await A.request(m1, li.id);
    assert.deepEqual([await kinds(bar1), await kinds(m1)], [['booking_instant'], ['booking_accepted']]);
    const l = await listing(bar2, 11);
    const [b1, b2, b3] = [await A.request(m1, l.id), await A.request(m2, l.id), await A.request(m3, l.id)];
    await A.respond(bar2, b2.id, true);
    assert.equal((await kinds(m3)).at(-1), 'booking_listing_taken');
    assert.equal((await kinds(m2)).at(-1), 'booking_accepted');
    await A.cancelListing(bar3, (await listing(bar3, 12)).id);
    const l4 = await listing(bar3, 13); await A.request(m3, l4.id); await A.cancelListing(bar3, l4.id);
    assert.equal((await kinds(m3)).at(-1), 'booking_listing_cancelled');
    assert.ok(b1.id && b3.id);
  });
  it('cancelaciones: avisa solo a la otra parte; vencimientos: a ambas', async () => {
    const c = await confirmed(bar1, m1, 10);
    await A.cancel(bar1, c.bookingId);
    assert.ok((await kinds(m1)).includes('booking_cancelled'));
    assert.equal((await kinds(bar1)).includes('booking_cancelled'), false);
    assert.ok((await kinds(bar1)).includes('payment_refund'));                                // el bar que cancela una reserva pagada recibe el aviso de reembolso
    const c2 = await confirmed(bar2, m2, 11); await A.cancel(m2, c2.bookingId);
    assert.ok((await kinds(bar2)).includes('booking_cancelled'));
    assert.equal((await kinds(m2)).includes('booking_cancelled'), false);
    const l = await listing(bar3, 12); await A.request(m3, l.id);
    await A.expireStale({ now: plus(new Date(), 49 * H) });
    assert.equal((await kinds(bar3)).at(-1), 'booking_expired');
    assert.equal((await kinds(m3)).at(-1), 'booking_expired');
  });
  it('disputa: avisa a la contraparte y luego a ambos al resolverse', async () => {
    const c = await confirmed(bar1, m1, 10);
    await A.report(bar1, c.bookingId, 'no vino', { now: plus(c.ends, H) });
    assert.ok((await kinds(m1)).includes('booking_disputed'));
    await A.resolveDispute(c.bookingId, 50);
    assert.ok((await kinds(bar1)).includes('dispute_resolved'));
    assert.ok((await kinds(m1)).includes('dispute_resolved'));
  });
  it('marcar como leídas: solo las propias, por ids o todas; idempotente', async () => {
    const l = await listing(bar1, 10); await A.request(m1, l.id); await A.request(m2, l.id);
    const l2 = await listing(bar1, 11); await A.request(m1, l2.id);
    const mine = (await notifs(bar1)).map((n: any) => n);
    assert.equal(mine.length, 3);
    const ids = (await A.q('select id from notifications where user_id = $1 order by created_at', [bar1.userId])).map((r) => r.id);
    assert.equal(await A.markRead(bar1, [ids[0]]), 1);
    assert.equal(await A.markRead(bar1, [ids[0]]), 0);
    assert.equal(await A.markRead(m1, ids), 0); // ajenas
    assert.equal((await A.q('select count(*)::int n from notifications where user_id = $1 and read_at is null', [bar1.userId]))[0].n, 2);
    assert.equal(await A.markRead(bar1), 2);
    assert.equal(await A.markRead(bar1), 0);
    await fails(A.markRead(null), 'not_authenticated');
    const seen = await asUser(pool, m3.userId, async (c) => (await c.query('select count(*)::int n from notifications')).rows[0].n);
    assert.equal(seen, 0);
  });
  it('cola de entrega: cada notificación se reclama una sola vez aunque dos workers corran a la vez', async () => {
    for (let i = 0; i < 6; i++) { const l = await listing(bar1, 10 + i); await A.request(m1, l.id); }
    const total = (await A.q('select count(*)::int n from notifications'))[0].n;
    const [a, b] = await Promise.all([A.claimPending(4), A.claimPending(4)]);
    const rest = await A.claimPending(1000);
    const all = [...a, ...b, ...rest];
    assert.equal(new Set(all).size, all.length, 'duplicadas');
    assert.equal(all.length, total);
    assert.equal((await A.claimPending()).length, 0);
  });
});

describe('Búsquedas guardadas y alertas', () => {
  it('guarda filtros válidos y rechaza inválidos, tope de 10, solo músicos, borrado propio', async () => {
    const ok = await A.saveSearch(m1, ' Jazz Palermo ', { neighborhoods: ['Palermo Soho'], genres: ['Jazz'], minCachet: 50000, maxCachet: 300000, mode: 'instant', from: day(1).toISOString(), to: day(30).toISOString() });
    assert.equal(ok.name, 'Jazz Palermo');
    await fails(A.saveSearch(m1, '', {}), 'invalid_name');
    await fails(A.saveSearch(m1, 'x'.repeat(61), {}), 'invalid_name');
    for (const f of [[1], { raro: 1 }, { genres: 'Jazz' }, { genres: [1] }, { minCachet: -1 }, { minCachet: 10.5 }, { maxCachet: 'mucho' }, { mode: 'gratis' }, { from: 'ayer' }])
      await fails(A.saveSearch(m1, 'x', f), 'invalid_filters');
    await fails(A.saveSearch(bar1, 'x', {}), 'forbidden_role');
    for (let i = 0; i < 9; i++) await A.saveSearch(m1, 'b' + i, {});
    await fails(A.saveSearch(m1, 'once', {}), 'too_many_searches');
    assert.equal(await A.deleteSearch(m2, ok.id), false);
    assert.equal(await A.deleteSearch(m1, ok.id), true);
    await A.saveSearch(m1, 'ahora sí', {});
  });
  it('una publicación nueva avisa solo a quienes coincide (barrio, género, cachet, modo, fechas, disponibilidad)', async () => {
    await A.q(`update venues set neighborhood = 'Palermo Soho' where id = $1`, [bar1.entityId]);
    await A.q(`update venues set neighborhood = 'San Telmo' where id = $2 or id = $1`, [bar2.entityId, bar3.entityId]);
    await A.saveSearch(m1, 'jazz en palermo', { neighborhoods: ['Palermo Soho'], genres: ['Jazz'], minCachet: 50000, maxCachet: 200000, mode: 'approval', from: day(5).toISOString(), to: day(20).toISOString() });
    await A.saveSearch(m2, 'todo', {});
    await A.saveSearch(m3, 'rock caro', { genres: ['Rock'], minCachet: 500000 });
    await listing(bar1, 10);                                    // coincide con m1 y m2
    assert.deepEqual([(await kinds(m1)), (await kinds(m2)), (await kinds(m3))], [['search_match'], ['search_match'], []]);
    await listing(bar2, 10);                                    // San Telmo: no para m1
    assert.deepEqual([(await kinds(m1)).length, (await kinds(m2)).length], [1, 2]);
    await listing(bar1, 12, { genres: ['Rock'] });              // género distinto: no para m1
    await listing(bar1, 14, { cachet: 250000 });                // sobre el máximo
    await listing(bar1, 16, { mode: 'instant' });               // modo distinto
    await listing(bar1, 40);                                    // fuera de fechas
    assert.equal((await kinds(m1)).length, 1);
    // si m1 ya tiene un show a esa hora, no le avisan de otra fecha superpuesta
    const c = await confirmed(bar3, m1, 18);
    const before = (await kinds(m1)).length;
    await listing(bar1, 18);
    assert.equal((await kinds(m1)).length, before);
    await A.q('update profiles set suspended = true where user_id = $1', [m2.userId]);
    const b2 = (await kinds(m2)).length; await listing(bar1, 25);
    assert.equal((await kinds(m2)).length, b2);
    assert.ok(c.bookingId);
  });
});

describe('Búsqueda de fechas', () => {
  beforeEach(async () => {
    await A.q(`update venues set neighborhood = 'Palermo Soho', rating = 4.9, base_rating = 4.9, name = 'Thelonious' where id = $1`, [bar1.entityId]);
    await A.q(`update venues set neighborhood = 'San Telmo', rating = 4.2, base_rating = 4.2, name = 'La Cueva_Roja' where id = $1`, [bar2.entityId]);
    await A.q(`update venues set neighborhood = 'Villa Crespo', rating = 3.5, base_rating = 3.5, name = 'Bar 100%' where id = $1`, [bar3.entityId]);
  });
  const ids = (rows: any[]) => rows.map((r) => r.listing_id);
  it('solo muestra fechas abiertas y futuras, ordenadas por fecha', async () => {
    const a = await listing(bar1, 12), b = await listing(bar2, 5), c = await listing(bar3, 8);
    const booked = await listing(bar1, 20); const bk = await A.request(m1, booked.id); await A.respond(bar1, bk.id, true);
    const cancelled = await listing(bar2, 21); await A.cancelListing(bar2, cancelled.id);
    const soon = await A.search(m2, {}, { now: plus(b.starts, -1 * H) });   // la de 5 días ya casi empieza
    assert.ok(!ids(soon).includes(b.id));
    const r = await A.search(m2);
    assert.deepEqual(ids(r), [b.id, c.id, a.id]);
    assert.ok(!ids(r).includes(booked.id) && !ids(r).includes(cancelled.id));
    assert.equal(Number(r[0].total_count), 3);
    assert.equal((await A.search(null)).length, 3); // visitantes sin sesión también
  });
  it('filtros: fechas, barrio, género, cachet, modo, calificación y texto', async () => {
    const a = await listing(bar1, 10, { genres: ['Jazz', 'Blues'], cachet: 300000, mode: 'instant' });
    const b = await listing(bar2, 11, { genres: ['Rock'], cachet: 100000 });
    const c = await listing(bar3, 12, { genres: ['Folklore'], cachet: 0, notes: 'Escenario chico, buena acústica' });
    const f = async (o: Record<string, unknown>) => ids(await A.search(m1, o)).sort();
    assert.deepEqual(await f({ neighborhoods: ['San Telmo', 'Villa Crespo'] }), [b.id, c.id].sort());
    assert.deepEqual(await f({ genres: ['Blues', 'Folklore'] }), [a.id, c.id].sort());
    assert.deepEqual(await f({ min_cachet: 100000, max_cachet: 100000 }), [b.id]);
    assert.deepEqual(await f({ min_cachet: 150000 }), [a.id]);
    assert.deepEqual(await f({ max_cachet: 0 }), [c.id]);
    assert.deepEqual(await f({ mode: 'instant' }), [a.id]);
    assert.deepEqual(await f({ min_rating: 4.5 }), [a.id]);
    assert.deepEqual(await f({ from: plus(a.starts, -H).toISOString(), to: plus(b.starts, H).toISOString() }), [a.id, b.id].sort());
    assert.deepEqual(await f({ text: 'thelo' }), [a.id]);
    assert.deepEqual(await f({ text: 'telmo' }), [b.id]);
    assert.deepEqual(await f({ text: 'ACÚSTICA' }), [c.id]);          // ignora mayúsculas
    assert.deepEqual(await f({ text: 'acustica' }), []);               // pero no acentos (búsqueda simple, sin unaccent)
    assert.deepEqual(await f({ text: 'acústica' }), [c.id]);
    assert.deepEqual(await f({ text: '  ' }), [a.id, b.id, c.id].sort());
    assert.deepEqual(await f({ neighborhoods: [], genres: [] }), [a.id, b.id, c.id].sort());
    assert.deepEqual(await f({ neighborhoods: ['Palermo Soho'], genres: ['Rock'] }), []);
  });
  it('los comodines (%, _, \\) se buscan como texto literal (no inyectan patrones)', async () => {
    await listing(bar1, 10); const t = await listing(bar2, 11); const p = await listing(bar3, 12);
    assert.deepEqual(ids(await A.search(m1, { text: '%' })), [p.id]);       // "Bar 100%"
    assert.deepEqual(ids(await A.search(m1, { text: '_' })), [t.id]);       // "La Cueva_Roja"
    assert.deepEqual(ids(await A.search(m1, { text: '\\' })), []);
    assert.deepEqual(ids(await A.search(m1, { text: "x' or 1=1 --" })), []);
  });
  it('orden por cachet y calificación, paginación y límites', async () => {
    const a = await listing(bar1, 10, { cachet: 100000 }), b = await listing(bar2, 11, { cachet: 300000 }), c = await listing(bar3, 12, { cachet: 200000 });
    assert.deepEqual(ids(await A.search(m1, { sort: 'cachet_desc' })), [b.id, c.id, a.id]);
    assert.deepEqual(ids(await A.search(m1, { sort: 'rating_desc' })), [a.id, b.id, c.id]);
    const p1 = await A.search(m1, { limit: 2 }), p2 = await A.search(m1, { limit: 2, offset: 2 });
    assert.deepEqual([...ids(p1), ...ids(p2)], [a.id, b.id, c.id]);
    assert.deepEqual([p1[0].total_count, p2[0].total_count].map(Number), [3, 3]);
    assert.equal((await A.search(m1, { limit: 0 })).length, 1);          // mínimo 1
    assert.equal((await A.search(m1, { limit: 100000 })).length, 3);     // máximo 50
    assert.equal((await A.search(m1, { offset: -5 })).length, 3);
    assert.equal((await A.search(m1, { offset: 50 })).length, 0);
  });
  it('"ocultar las que no puedo" esconde fechas que se pisan con mis shows (solo para músicos)', async () => {
    const mine = await confirmed(bar1, m1, 10);
    const clash = await listing(bar2, 10), free = await listing(bar3, 11);
    assert.deepEqual(ids(await A.search(m1, { hide_busy: true })), [free.id]);
    assert.deepEqual(ids(await A.search(m1, { hide_busy: false })).sort(), [clash.id, free.id].sort());
    assert.deepEqual(ids(await A.search(m2, { hide_busy: true })).sort(), [clash.id, free.id].sort());
    assert.ok(mine.bookingId);
  });
  it('trae la insignia de Superanfitrión del bar', async () => {
    await listing(bar1, 10);
    assert.equal((await A.search(m1))[0].venue_superhost, false);
  });
});

describe('Estadísticas e insignias', () => {
  async function done(bar: Actor, mus: Actor, d: number) { const c = await confirmed(bar, mus, d); await A.complete(mus, c.bookingId, { now: plus(c.ends, H) }); return c; }
  it('Superanfitrión: requiere shows, calificación, pocas cancelaciones y buena respuesta', async () => {
    await A.q(`update venues set rating = 4.9, base_rating = 4.9 where id = $1`, [bar1.entityId]);
    for (let i = 0; i < 4; i++) await done(bar1, [m1, m2, m3][i % 3], 10 + i);
    let s = (await A.stats('venue', bar1.entityId))[0];
    assert.deepEqual([s.completed, s.is_superhost, Number(s.response_rate)], [4, false, 100]);   // falta 1 show
    await done(bar1, m1, 20);
    s = (await A.stats('venue', bar1.entityId))[0];
    assert.deepEqual([s.completed, s.cancel_rate, s.is_superhost], [5, 0, true]);
    // una cancelación del bar tras confirmar: 1/(5+1) = 16.7% > 2%
    const x = await confirmed(bar1, m2, 30); await A.cancel(bar1, x.bookingId);
    s = (await A.stats('venue', bar1.entityId))[0];
    assert.deepEqual([s.cancelled_after_confirm, Number(s.cancel_rate), s.is_superhost], [1, 16.7, false]);
    // calificación baja
    await A.q(`update venues set rating = 4.6, base_rating = 4.6 where id = $1`, [bar1.entityId]);
    assert.equal((await A.stats('venue', bar1.entityId))[0].is_superhost, false);
  });
  it('tasa y tiempo de respuesta: las no respondidas bajan la tasa; las auto-rechazadas y retiradas no cuentan', async () => {
    const l1 = await listing(bar1, 10), l2 = await listing(bar1, 11), l3 = await listing(bar1, 12), l4 = await listing(bar1, 13);
    const a = await A.request(m1, l1.id); await A.respond(bar1, a.id, true, '', { now: plus(new Date(), 10 * H) });          // responde en ~10 h
    const b = await A.request(m1, l2.id); await A.respond(bar1, b.id, false, '', { now: plus(new Date(), 20 * H) });         // ~20 h
    const c = await A.request(m2, l3.id); await A.expireStale({ now: plus(new Date(), 49 * H) });                           // no respondió
    const d1 = await A.request(m2, l4.id), d2 = await A.request(m3, l4.id);
    await A.cancel(m3, d2.id);                                                                                               // retirada: no cuenta
    await A.respond(bar1, d1.id, true);                                                                                      // inmediata
    const s = (await A.stats('venue', bar1.entityId))[0];
    assert.equal(Number(s.response_rate), 75);                       // 3 respondidas de 4 relevantes
    assert.ok(Number(s.avg_response_hours) > 9 && Number(s.avg_response_hours) < 11.5, String(s.avg_response_hours)); // (10 + 20 + ~0)/3
    assert.ok(a.id && b.id && c.id);
  });
  it('músico: cuenta cancelaciones tardías propias; entidad inexistente o tipo inválido no devuelve nada', async () => {
    for (let i = 0; i < 5; i++) await done([bar1, bar2, bar3][i % 3], m1, 10 + i);
    await A.q(`update musicians set rating = 4.8, base_rating = 4.8 where id = $1`, [m1.entityId]);
    assert.equal((await A.stats('musician', m1.entityId))[0].is_superhost, true);
    const x = await confirmed(bar1, m1, 30); await A.cancel(m1, x.bookingId, '', { now: plus(x.starts, -5 * H) });
    const s = (await A.stats('musician', m1.entityId))[0];
    assert.deepEqual([s.cancelled_after_confirm, s.is_superhost, s.response_rate], [1, false, null]);
    assert.equal((await A.stats('venue', 'no-existe')).length, 0);
    assert.equal((await A.stats('cosa', bar1.entityId)).length, 0);
  });
  it('ignora actividad de hace más de un año', async () => {
    for (let i = 0; i < 5; i++) await done(bar1, m1, 10 + i);
    await A.q(`update bookings set starts_at = starts_at - interval '400 days', ends_at = ends_at - interval '400 days'`);
    assert.equal((await A.stats('venue', bar1.entityId))[0].completed, 0);
  });
});

describe('Verificación de perfiles', () => {
  const newUser = async () => { const id = randomUUID(); await A.q('insert into auth.users (id, email) values ($1, $2)', [id, id + '@t.com']); return id; };
  it('alta de bar: solicitud → aprobación → perfil verificado que puede publicar', async () => {
    const u = await newUser();
    const r = await A.requestProfile(u, { role: 'bar', name: 'La Esquina', neighborhood: 'Palermo Soho', address: 'Honduras 5000', bio: 'Jazz en vivo', evidence: 'https://instagram.com/laesquina' });
    assert.equal(r.status, 'pendiente');
    await fails(A.requestProfile(u, { role: 'bar', name: 'Otra', neighborhood: 'x', address: 'y' }), 'request_pending');
    const ap = await A.reviewRequest(r.id, true, 'Todo en orden');
    assert.equal(ap.status, 'aprobada');
    const prof = (await A.q('select * from profiles where user_id = $1', [u]))[0];
    assert.deepEqual([prof.role, prof.verified], ['bar', true]);
    assert.equal((await A.q('select count(*)::int n from venues where id = $1', [prof.venue_id]))[0].n, 1);
    assert.deepEqual(await kinds(u), ['profile_approved']);
    await fails(A.requestProfile(u, { role: 'musico', name: 'Yo' }), 'profile_exists');
    await fails(A.reviewRequest(r.id, true), 'invalid_state');
    const asBar: Actor = { userId: u, role: 'bar', entityId: prof.venue_id };
    assert.equal((await A.createListing(asBar, { starts: day(10), ends: plus(day(10), 3 * H), cachet: 1 } as any)).status, 'abierta');
  });
  it('alta de músico, rechazo y nueva solicitud', async () => {
    const u = await newUser();
    const r = await A.requestProfile(u, { role: 'musico', name: 'Trío Nocturno' });
    assert.equal((await A.reviewRequest(r.id, false, 'Falta información')).status, 'rechazada');
    assert.equal((await A.q('select count(*)::int n from profiles where user_id = $1', [u]))[0].n, 0);
    assert.deepEqual(await kinds(u), ['profile_rejected']);
    const r2 = await A.requestProfile(u, { role: 'musico', name: 'Trío Nocturno', evidence: 'https://youtube.com/watch?v=abc' });
    await A.reviewRequest(r2.id, true);
    assert.equal((await A.q('select role from profiles where user_id = $1', [u]))[0].role, 'musico');
  });
  it('valida datos de la solicitud y la sesión', async () => {
    const u = await newUser();
    await fails(asUser(pool, null, (c) => c.query(`select * from request_profile('bar','Nombre','x','y')`)), 'not_authenticated');
    await fails(A.requestProfile(u, { role: 'dj', name: 'Nombre' }), 'invalid_request');
    await fails(A.requestProfile(u, { role: 'musico', name: 'X' }), 'invalid_request');
    await fails(A.requestProfile(u, { role: 'bar', name: 'Bar Lindo' }), 'invalid_request');                       // falta dirección
    await fails(A.requestProfile(u, { role: 'bar', name: 'Bar Lindo', neighborhood: 'a', address: '  ' }), 'invalid_request');
    await fails(A.requestProfile(u, { role: 'musico', name: 'Banda', bio: 'x'.repeat(1001) }), 'invalid_request');
    for (const url of ['http://x.com/a', 'javascript:alert(1)', 'https://', 'https://a b.com'])
      await fails(A.requestProfile(u, { role: 'musico', name: 'Banda', evidence: url }), 'invalid_evidence');
    await assert.rejects(asUser(pool, u, (c) => c.query(`select * from admin_review_profile_request(gen_random_uuid(), true)`)), (e: any) => e.code === '42501');
  });
  it('con verificación obligatoria, los perfiles sin verificar no pueden operar', async () => {
    await A.q('update app_settings set require_verification = true');
    await fails(listing(bar1, 10), 'not_verified');
    await A.q('update profiles set verified = true where user_id = $1', [bar1.userId]);
    const l = await listing(bar1, 10);
    await fails(A.request(m1, l.id), 'not_verified');
    await A.q('update profiles set verified = true where user_id = $1', [m1.userId]);
    assert.equal((await A.request(m1, l.id)).status, 'solicitada');
  });
});

describe('Ganancias', () => {
  it('bar y músico ven retenido, liquidado y reembolsado (con comisiones)', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
    assert.deepEqual(Object.values(await A.earnings(bar1)).slice(1), [0, 0, 0, 0]);
    const c = await confirmed(bar1, m1, 10);
    let e = await A.earnings(bar1), g = await A.earnings(m1);
    assert.deepEqual([e.role, Number(e.pending_ars), Number(e.settled_ars)], ['bar', 105000, 0]);
    assert.deepEqual([g.role, Number(g.pending_ars), Number(g.settled_ars)], ['musico', 90000, 0]);
    await A.complete(m1, c.bookingId, { now: plus(c.ends, H) });
    e = await A.earnings(bar1); g = await A.earnings(m1);
    assert.deepEqual([Number(e.pending_ars), Number(e.settled_ars), e.shows_completed], [0, 105000, 1]);
    assert.deepEqual([Number(g.pending_ars), Number(g.settled_ars), g.shows_completed], [0, 90000, 1]);
    const d = await confirmed(bar1, m2, 11, { policy: 'flexible' });
    await A.cancel(bar1, d.bookingId, '', { now: plus(d.starts, -10 * H) });               // flexible, <24 h => 50%
    e = await A.earnings(bar1);
    assert.deepEqual([Number(e.refunded_ars), Number(e.settled_ars)], [52500, 105000 + 52500]);
    assert.equal(Number((await A.earnings(m2)).settled_ars), 45000);   // retiene 50.000 y descuenta 10% de comisión
  });
});

describe('Concurrencia sobre topes', () => {
  it('un músico lanzando 30 solicitudes a la vez no supera el tope de pendientes', async () => {
    const ls = await Promise.all(Array.from({ length: 30 }, (_, i) => listing([bar1, bar2, bar3][i % 3], 10 + Math.floor(i / 3) * 1 + (i % 3) * 0, { }).catch(() => null)));
    const open = ls.filter(Boolean) as { id: string }[];
    const res = await Promise.allSettled(open.map((l) => A.request(m1, l.id)));
    const unexpected = res.filter((r) => r.status === 'rejected' && !(r.reason instanceof BizError));
    assert.equal(unexpected.length, 0, JSON.stringify(unexpected.map((u: any) => u.reason?.message)));
    const pend = (await A.q(`select count(*)::int n from bookings where musician_id = $1 and status = 'solicitada'`, [m1.entityId]))[0].n;
    assert.ok(pend <= 20, `pendientes: ${pend}`);
    assert.ok(open.length >= 21, 'no se crearon suficientes fechas para probar el tope');
  });
  it('15 búsquedas guardadas y 30 favoritos simultáneos respetan sus topes', async () => {
    const r = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => A.saveSearch(m1, 's' + i, {})));
    assert.equal(r.filter((x) => x.status === 'rejected' && !(x.reason instanceof BizError)).length, 0);
    assert.ok((await A.q('select count(*)::int n from saved_searches where user_id = $1', [m1.userId]))[0].n <= 10);
    await A.q(`insert into favorites select $1, 'listing', gen_random_uuid()::text from generate_series(1, 490)`, [m2.userId]);
    const ls = await Promise.all(Array.from({ length: 30 }, (_, i) => listing(bar1, 20 + i).catch(() => null)));
    const f = await Promise.allSettled(ls.filter(Boolean).map((l: any) => A.toggleFav(m2, 'listing', l.id)));
    assert.equal(f.filter((x) => x.status === 'rejected' && !(x.reason instanceof BizError)).length, 0);
    assert.ok((await A.q('select count(*)::int n from favorites where user_id = $1', [m2.userId]))[0].n <= 500);
  });
});

describe('Concurrencia sobre restricciones de superposición', () => {
  it('un bar que publica 12 fechas superpuestas a la vez obtiene 1 éxito y el resto "listing_overlap" (sin deadlocks)', async () => {
    for (let round = 0; round < 5; round++) {
      const s = day(10 + round * 2);
      const res = await Promise.allSettled(Array.from({ length: 12 }, (_, k) => A.createListing(bar1, { starts: new Date(s.getTime() + k * 600_000), ends: new Date(s.getTime() + k * 600_000 + 3 * H), cachet: 1 } as any)));
      const unexpected = res.filter((r) => r.status === 'rejected' && !(r.reason instanceof BizError));
      assert.equal(unexpected.length, 0, JSON.stringify(unexpected.map((u: any) => u.reason?.message)));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      assert.ok(res.every((r) => r.status === 'fulfilled' || (r.reason as BizError).message === 'listing_overlap'));
    }
  });
  it('dos bares aceptando a la vez al mismo músico en horarios que se pisan: uno gana, el otro "musician_busy", sin deadlocks', async () => {
    for (let round = 0; round < 12; round++) {
      const s = day(10 + round * 2);
      const la = await A.createListing(bar1, { starts: s, ends: new Date(s.getTime() + 3 * H), cachet: 1 } as any);
      const lb = await A.createListing(bar2, { starts: new Date(s.getTime() + H), ends: new Date(s.getTime() + 4 * H), cachet: 1 } as any);
      const ba = await A.request(m1, la.id), bb = await A.request(m1, lb.id);
      const res = await Promise.allSettled([A.respond(bar1, ba.id, true), A.respond(bar2, bb.id, true)]);
      const unexpected = res.filter((r) => r.status === 'rejected' && !(r.reason instanceof BizError));
      assert.equal(unexpected.length, 0, JSON.stringify(unexpected.map((u: any) => u.reason?.message)));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1, `ronda ${round}`);
      assert.equal((await A.q(`select count(*)::int n from bookings where musician_id = $1 and status = 'aceptada' and starts_at between $2 and $3`, [m1.entityId, new Date(s.getTime() - H), new Date(s.getTime() + 5 * H)]))[0].n, 1);
    }
  });
  it('reserva instantánea del mismo músico en dos fechas que se pisan, a la vez: una sola se concreta', async () => {
    for (let round = 0; round < 8; round++) {
      const s = day(40 + round * 2);
      const la = await A.createListing(bar1, { starts: s, ends: new Date(s.getTime() + 3 * H), cachet: 1, mode: 'instant' } as any);
      const lb = await A.createListing(bar2, { starts: new Date(s.getTime() + 2 * H), ends: new Date(s.getTime() + 5 * H), cachet: 1, mode: 'instant' } as any);
      const res = await Promise.allSettled([A.request(m2, la.id), A.request(m2, lb.id)]);
      assert.equal(res.filter((r) => r.status === 'rejected' && !(r.reason instanceof BizError)).length, 0, JSON.stringify(res.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message)));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
    }
  });
});
