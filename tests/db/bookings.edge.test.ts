import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import {
  createTestDb, dropTestDb, resetData, seedActors, api, asUser, asSystem, checkInvariants,
  H, D, BAR_KEYS, MUS_KEYS, type Actor, type Api,
} from './helpers.ts';

const DB = 'suenaba_edge';
let pool: pg.Pool, A: Api;
let bar1: Actor, bar2: Actor, bar3: Actor, m1: Actor, m2: Actor, m3: Actor;
let singlePublished = false;

const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** Publica una fecha del bar a `days` días, 3 horas de show. */
async function listing(a: Actor, days: number, extra: Record<string, unknown> = {}) {
  const starts = day(days), ends = plus(starts, 3 * H);
  const row = await A.createListing(a, { starts, ends, cachet: 100000, ...extra } as any);
  return { row, id: row.id as string, starts, ends };
}
/** Lleva una reserva hasta 'confirmada'. */
async function toConfirmed(bar: Actor, mus: Actor, days: number, extra: Record<string, unknown> = {}) {
  const l = await listing(bar, days, { mode: 'approval', ...extra });
  const b = await A.request(mus, l.id);
  await A.respond(bar, b.id, true);
  const f = await A.fund(bar, b.id);
  return { ...l, bookingId: b.id as string, booking: f };
}
async function fails(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: any) => { assert.ok(e.message === code || e.code === code, `esperaba "${code}", llegó "${e.message}" (${e.code})`); return true; });
}
const payment = async (bookingId: string) => (await A.q('select * from payments where booking_id = $1', [bookingId]))[0];
const bstatus = async (id: string) => (await A.q('select status from bookings where id = $1', [id]))[0].status as string;
const lstatus = async (id: string) => (await A.q('select status from listings where id = $1', [id]))[0].status as string;

before(async () => { pool = await createTestDb(DB); A = api(pool); });
after(async () => { await dropTestDb(pool, DB); });
beforeEach(async () => {
  await resetData(pool); singlePublished = false;
  const w = await seedActors(pool, 3, 3);
  [bar1, bar2, bar3] = w.bars; [m1, m2, m3] = w.mus;
});
afterEach(async () => {
  const bad = await checkInvariants(pool, { singlePublishedAllowed: singlePublished });
  assert.deepEqual(bad, [], 'invariantes violadas:\n' + bad.join('\n'));
});

describe('Flujo completo (camino feliz)', () => {
  it('publicar → solicitar → aceptar → pagar → show → completar → reseñas cruzadas', async () => {
    const l = await listing(bar1, 10);
    assert.equal(l.row.status, 'abierta');
    const b = await A.request(m1, l.id, null, 'Somos un trío de jazz');
    assert.equal(b.status, 'solicitada');
    const acc = await A.respond(bar1, b.id, true);
    assert.equal(acc.status, 'aceptada');
    assert.equal(await lstatus(l.id), 'reservada');
    const f = await A.fund(bar1, b.id);
    assert.equal(f.status, 'confirmada');
    let pay = await payment(b.id);
    assert.deepEqual([pay.status, pay.charged_ars, pay.provider], ['held', 100000, 'simulado']);

    await fails(A.complete(m1, b.id), 'show_not_finished');
    const after = plus(l.ends, 1 * H);
    const done = await A.complete(m1, b.id, { now: after });
    assert.equal(done.status, 'realizada');
    pay = await payment(b.id);
    assert.deepEqual([pay.status, pay.payout_ars, pay.platform_fee_ars, pay.refunded_ars], ['released', 100000, 0, 0]);

    // reseña del bar al músico: oculta hasta que el músico también reseñe
    const r1 = await A.review(bar1, b.id, 5, BAR_KEYS, 'Excelente', { now: after });
    assert.equal(r1.published_at, null);
    assert.equal((await A.q('select count(*)::int n from booking_reviews where published_at is not null'))[0].n, 0);
    const r2 = await A.review(m1, b.id, 4, MUS_KEYS, 'Buen lugar', { now: after });
    assert.notEqual(r2.published_at, null);
    const pub = await A.q('select count(*)::int n from booking_reviews where published_at is not null');
    assert.equal(pub[0].n, 2);
    // línea base bar: 4.5 x 10 reseñas + un 4  => 4.5/11... (4.5*10+4)/11 = 4.4545 -> 4.45
    const v = (await A.q('select rating, review_count from venues where id = $1', [bar1.entityId]))[0];
    assert.deepEqual([v.rating, v.review_count], [4.45, 11]);
    const m = (await A.q('select rating, review_count from musicians where id = $1', [m1.entityId]))[0];
    assert.deepEqual([m.rating, m.review_count], [4.17, 6]); // (4*5+5)/6
  });

  it('comisión por defecto = 0 y con comisión el dinero se reparte exacto', async () => {
    const z = await toConfirmed(bar1, m1, 10);
    assert.equal((await payment(z.bookingId)).venue_fee_ars, 0);
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000'); // 5% bar, 10% músico
    const c = await toConfirmed(bar2, m2, 11);
    const pay = await payment(c.bookingId);
    assert.deepEqual([pay.venue_fee_ars, pay.charged_ars], [5000, 105000]);
    await A.complete(m2, c.bookingId, { now: plus(c.ends, H) });
    const done = await payment(c.bookingId);
    assert.deepEqual([done.payout_ars, done.platform_fee_ars, done.refunded_ars], [90000, 15000, 0]);
  });

  it('la comisión se congela al pagar: cambios posteriores no afectan reservas ya pagadas', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 500');
    const c = await toConfirmed(bar1, m1, 10);
    await A.q('update app_settings set venue_fee_bps = 3000, musician_fee_bps = 3000');
    await A.complete(bar1, c.bookingId, { now: plus(c.ends, H) });
    const p = await payment(c.bookingId);
    assert.deepEqual([p.venue_fee_bps, p.musician_fee_bps, p.payout_ars, p.platform_fee_ars], [500, 500, 95000, 10000]);
  });

  it('cachet 0 y cachet máximo con comisiones altas no rompen la contabilidad', async () => {
    await A.q('update app_settings set venue_fee_bps = 3000, musician_fee_bps = 3000');
    const z = await toConfirmed(bar1, m1, 10, { cachet: 0 });
    assert.equal((await payment(z.bookingId)).charged_ars, 0);
    await A.complete(m1, z.bookingId, { now: plus(z.ends, H) });
    const mx = await toConfirmed(bar2, m2, 11, { cachet: 100_000_000 });
    const p = await payment(mx.bookingId);
    assert.deepEqual([p.venue_fee_ars, p.charged_ars], [30_000_000, 130_000_000]);
    await A.complete(m2, mx.bookingId, { now: plus(mx.ends, H) });
    const d = await payment(mx.bookingId);
    assert.deepEqual([d.payout_ars, d.platform_fee_ars], [70_000_000, 60_000_000]);
  });
});

describe('Reserva instantánea y contraofertas', () => {
  it('instantánea: queda aceptada al instante y nadie más puede reservar esa fecha', async () => {
    const l = await listing(bar1, 10, { mode: 'instant' });
    const b = await A.request(m1, l.id);
    assert.equal(b.status, 'aceptada');
    await fails(A.request(m2, l.id), 'listing_not_open');
  });
  it('instantánea no admite contraoferta de cachet', async () => {
    const l = await listing(bar1, 10, { mode: 'instant' });
    await fails(A.request(m1, l.id, 50000), 'instant_requires_listed_cachet');
    assert.equal((await A.request(m1, l.id, 100000)).status, 'aceptada');
  });
  it('con aprobación: el cachet propuesto es el que se cobra', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id, 130000);
    await A.respond(bar1, b.id, true); await A.fund(bar1, b.id);
    assert.equal((await payment(b.id)).charged_ars, 130000);
  });
});

describe('Solicitudes en competencia', () => {
  it('al aceptar una, las demás solicitudes se rechazan automáticamente', async () => {
    const l = await listing(bar1, 10);
    const [b1, b2, b3] = [await A.request(m1, l.id), await A.request(m2, l.id), await A.request(m3, l.id)];
    await A.respond(bar1, b2.id, true);
    assert.deepEqual([await bstatus(b1.id), await bstatus(b2.id), await bstatus(b3.id)], ['rechazada', 'aceptada', 'rechazada']);
    await fails(A.respond(bar1, b1.id, true), 'invalid_state');
    await fails(A.respond(bar1, b2.id, true), 'invalid_state'); // doble aceptación
  });
  it('un músico no puede pedir la misma fecha dos veces, pero sí después de ser rechazado', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    await fails(A.request(m1, l.id), 'already_requested');
    await A.respond(bar1, b.id, false, 'no encaja');
    assert.equal((await A.request(m1, l.id)).status, 'solicitada');
  });
  it('tope de solicitudes pendientes por músico', async () => {
    await A.q('update app_settings set max_pending_requests = 2');
    const ids = [(await listing(bar1, 10)).id, (await listing(bar1, 11)).id, (await listing(bar1, 12)).id];
    await A.request(m1, ids[0]); await A.request(m1, ids[1]);
    await fails(A.request(m1, ids[2]), 'too_many_requests');
  });
  it('músico con dos solicitudes superpuestas: solo un bar puede confirmarlo', async () => {
    const la = await listing(bar1, 10), lb = await listing(bar2, 10); // mismo horario, distintos bares
    const ba = await A.request(m1, la.id), bb = await A.request(m1, lb.id);
    await A.respond(bar1, ba.id, true);
    await fails(A.respond(bar2, bb.id, true), 'musician_busy');
    assert.equal(await bstatus(bb.id), 'solicitada');
    await fails(A.request(m1, (await listing(bar3, 10)).id), 'musician_busy');
  });
  it('shows contiguos (uno termina cuando empieza el otro) sí se permiten', async () => {
    const s = day(10);
    const l1 = await A.createListing(bar1, { starts: s, ends: plus(s, 3 * H), cachet: 1 } as any);
    const l2 = await A.createListing(bar2, { starts: plus(s, 3 * H), ends: plus(s, 6 * H), cachet: 1 } as any);
    const b1 = await A.request(m1, l1.id), b2 = await A.request(m1, l2.id);
    await A.respond(bar1, b1.id, true); await A.respond(bar2, b2.id, true);
  });
});

describe('Validaciones de publicaciones', () => {
  const mk = (over: Record<string, unknown>, a = bar1) => A.createListing(a, { starts: day(10), ends: day(10 + 3 / 24), cachet: 1000, ...over } as any);
  it('rechaza fechas inválidas', async () => {
    await fails(mk({ starts: new Date(Date.now() + H), ends: new Date(Date.now() + 4 * H) }), 'starts_too_soon');
    await fails(mk({ starts: day(-1), ends: day(-0.9) }), 'starts_too_soon');
    await fails(mk({ starts: day(400), ends: day(400.1) }), 'starts_too_far');
    await fails(mk({ starts: day(10), ends: day(10) }), 'invalid_listing');
    await fails(mk({ starts: day(10), ends: day(9) }), 'invalid_listing');
    await fails(mk({ starts: day(10), ends: plus(day(10), 13 * H) }), 'invalid_listing');
  });
  it('rechaza cachet, modo y política inválidos', async () => {
    await fails(mk({ cachet: -1 }), 'invalid_listing');
    await fails(mk({ cachet: 100_000_001 }), 'invalid_listing');
    await fails(mk({ mode: 'gratis' }), 'invalid_listing');
    await fails(mk({ policy: 'inventada' }), 'invalid_listing');
    await fails(mk({ notes: 'x'.repeat(1001) }), 'invalid_listing');
  });
  it('un bar no puede superponer sus propias fechas, pero otro bar sí puede el mismo horario', async () => {
    await listing(bar1, 10);
    await fails(listing(bar1, 10), 'listing_overlap');
    await listing(bar2, 10);
  });
  it('un músico no puede publicar y un bar no puede reservar', async () => {
    await fails(listing(m1 as any, 10), 'forbidden_role');
    const l = await listing(bar1, 10);
    await fails(A.request(bar2 as any, l.id), 'forbidden_role');
  });
  it('request: fecha cancelada/inexistente, muy próxima, cachet y nota inválidos', async () => {
    const l = await listing(bar1, 10);
    await fails(A.request(m1, '00000000-0000-0000-0000-000000000000'), 'listing_not_found');
    await fails(A.request(m1, l.id, -5), 'invalid_cachet');
    await fails(A.request(m1, l.id, 100_000_001), 'invalid_cachet');
    await fails(A.request(m1, l.id, null, 'x'.repeat(1001)), 'note_too_long');
    await fails(A.request(m1, l.id, null, '', { now: plus(l.starts, -1 * H) }), 'listing_too_soon');
    await A.cancelListing(bar1, l.id);
    await fails(A.request(m1, l.id), 'listing_not_found');
  });
});

describe('Cancelar publicaciones', () => {
  it('cancelar rechaza las solicitudes pendientes; es idempotente; otro bar no puede', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    await fails(A.cancelListing(bar2, l.id), 'listing_not_found');
    assert.equal((await A.cancelListing(bar1, l.id)).status, 'cancelada');
    assert.equal(await bstatus(b.id), 'rechazada');
    assert.equal((await A.cancelListing(bar1, l.id)).status, 'cancelada');
  });
  it('no se puede cancelar una publicación con reserva (hay que cancelar la reserva)', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    await fails(A.cancelListing(bar1, c.id), 'listing_has_booking');
  });
});

describe('Seguridad y permisos', () => {
  it('sin sesión, sin perfil o suspendido no se puede operar', async () => {
    const l = await listing(bar1, 10);
    await fails(asUser(pool, null, (c) => c.query('select * from public.request_booking($1)', [l.id])), 'not_authenticated');
    const ghost = '11111111-1111-1111-1111-111111111111';
    await fails(asUser(pool, ghost, (c) => c.query('select * from public.request_booking($1)', [l.id])), 'no_profile');
    await A.q('update profiles set suspended = true where user_id = $1', [m1.userId]);
    await fails(A.request(m1, l.id), 'suspended');
  });
  it('terceros no ven ni operan reservas ajenas (RLS + chequeo de dueño)', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    for (const intruder of [bar2, m2]) {
      await fails(A.cancel(intruder, c.bookingId), 'booking_not_found');
      await fails(A.complete(intruder, c.bookingId, { now: plus(c.ends, H) }), 'booking_not_found');
      await fails(A.message(intruder, c.bookingId, 'hola'), 'booking_not_found');
      await fails(A.review(intruder, c.bookingId, 5, intruder.role === 'bar' ? BAR_KEYS : MUS_KEYS), 'booking_not_found');
      const seen = await asUser(pool, intruder.userId, async (cl) => (await cl.query('select (select count(*) from bookings)::int b, (select count(*) from payments)::int p, (select count(*) from booking_events)::int e')).rows[0]);
      assert.deepEqual(seen, { b: 0, p: 0, e: 0 });
    }
    await fails(A.respond(bar2, c.bookingId, true), 'booking_not_found');
    await fails(A.fund(bar2, c.bookingId), 'booking_not_found');
    for (const owner of [bar1, m1]) {
      const seen = await asUser(pool, owner.userId, async (cl) => (await cl.query('select count(*)::int n from bookings')).rows[0].n);
      assert.equal(seen, 1);
    }
  });
  it('los clientes no pueden escribir directo en tablas ni llamar funciones del sistema', async () => {
    const l = await listing(bar1, 10);
    const deny = (sql: string, who: string | null = m1.userId, role: 'authenticated' | 'anon' = 'authenticated') =>
      fails(asUser(pool, who, (c) => c.query(sql), { role }), '42501');
    await deny(`insert into bookings (listing_id, venue_id, musician_id, cachet_ars, starts_at, ends_at, cancellation_policy, respond_by) select id, venue_id, 'x', 1, starts_at, ends_at, 'flexible', now() from listings`);
    await deny(`update listings set cachet_ars = 1`, bar1.userId);
    await deny(`update venues set rating = 1`);
    await deny(`delete from venues`);
    await deny(`update musicians set rating = 1`);
    await deny(`insert into public.reviews (id) values ('x')`);
    await deny(`update app_settings set venue_fee_bps = 3000`, bar1.userId);
    await deny(`select allow_clock_override from app_settings`);
    await deny(`select public.expire_stale_bookings()`);
    await deny(`select public.complete_due_bookings()`);
    await deny(`select * from public.admin_resolve_dispute('${l.id}', 100)`);
    await deny(`select * from public.create_listing(now(), now(), 1)`, null, 'anon');
    await deny(`select * from public.bookings`, null, 'anon');
    assert.equal((await A.q('select cachet_ars from listings where id = $1', [l.id]))[0].cachet_ars, 100000);
  });
  it('el reloj de pruebas no se puede manipular si allow_clock_override está apagado', async () => {
    await A.q('update app_settings set allow_clock_override = false');
    try {
      const s = day(0.2); // dentro de 4.8h: válido con reloj real
      const l = await A.createListing(bar1, { starts: s, ends: plus(s, 2 * H), cachet: 1 } as any, { now: day(300) });
      assert.equal(l.status, 'abierta');
    } finally { await A.q('update app_settings set allow_clock_override = true'); }
  });
  it('las reseñas no publicadas solo las ve su autor', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    const t = plus(c.ends, H);
    await A.complete(m1, c.bookingId, { now: t });
    await A.review(bar1, c.bookingId, 5, BAR_KEYS, 'privado', { now: t });
    const count = (u: string | null, role: 'authenticated' | 'anon' = 'authenticated') =>
      asUser(pool, u, async (cl) => (await cl.query('select count(*)::int n from booking_reviews')).rows[0].n, { role });
    assert.deepEqual([await count(bar1.userId), await count(m1.userId), await count(bar2.userId), await count(null, 'anon')], [1, 0, 0, 0]);
  });
});

describe('Vencimientos', () => {
  it('solicitud sin respuesta: responder tarde la expira; el job también', async () => {
    const l = await listing(bar1, 10);
    const b1 = await A.request(m1, l.id), late = plus(new Date(), 49 * H);
    const r = await A.respond(bar1, b1.id, true, '', { now: late });
    assert.equal(r.status, 'expirada');
    assert.equal(await lstatus(l.id), 'abierta');
    const b2 = await A.request(m2, l.id);
    assert.equal(await A.expireStale({ now: late }), 1);
    assert.equal(await bstatus(b2.id), 'expirada');
    assert.equal(await A.expireStale({ now: late }), 0);
  });
  it('aceptada sin pago: vence, reabre la fecha y otro músico puede reservarla', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    await A.respond(bar1, b.id, true);
    const late = plus(new Date(), 49 * H);
    const f = await A.fund(bar1, b.id, { now: late });
    assert.equal(f.status, 'expirada');
    assert.equal(await lstatus(l.id), 'abierta');
    assert.equal((await A.request(m2, l.id)).status, 'solicitada');
    assert.equal((await A.q('select count(*)::int n from payments'))[0].n, 0);
  });
  it('el job expira aceptadas y cierra fechas pasadas sin reserva', async () => {
    const l1 = await listing(bar1, 10), l2 = await listing(bar2, 10);
    const b = await A.request(m1, l1.id); await A.respond(bar1, b.id, true);
    const n = await A.expireStale({ now: plus(l1.starts, 1 * H) });
    assert.equal(n, 1);
    assert.deepEqual([await lstatus(l1.id), await lstatus(l2.id)], ['cerrada', 'cerrada']);
  });
  it('pagar una reserva ya expirada o fuera de estado falla', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    await fails(A.fund(bar1, b.id), 'invalid_state'); // todavía solicitada
  });
});

describe('Pagos', () => {
  it('pagar dos veces es idempotente (un solo cobro)', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    await A.fund(bar1, c.bookingId); await A.fund(bar1, c.bookingId);
    assert.equal((await A.q('select count(*)::int n from payments'))[0].n, 1);
  });
});

describe('Cancelaciones y reembolsos', () => {
  it('solicitada: el músico se retira; aceptada: se cancela gratis y se reabre la fecha', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    assert.equal((await A.cancel(m1, b.id)).cancelled_by, 'musico');
    const b2 = await A.request(m2, l.id); await A.respond(bar1, b2.id, true);
    assert.equal(await lstatus(l.id), 'reservada');
    await A.cancel(bar1, b2.id);
    assert.equal(await lstatus(l.id), 'abierta');
    await fails(A.cancel(bar1, b2.id), 'invalid_state');
  });
  it('músico cancela pagada con anticipación: reembolso total, sin sanción', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
    const c = await toConfirmed(bar1, m1, 10);
    await A.cancel(m1, c.bookingId);
    const p = await payment(c.bookingId);
    assert.deepEqual([p.status, p.refunded_ars, p.payout_ars, p.platform_fee_ars], ['refunded', 105000, 0, 0]);
    assert.equal((await A.q('select late_cancellations from profiles where user_id = $1', [m1.userId]))[0].late_cancellations, 0);
    assert.equal(await lstatus(c.id), 'abierta');
  });
  it('músico cancela con menos de 24 h: reembolso total al bar + sanción al músico', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    await A.cancel(m1, c.bookingId, 'imprevisto', { now: plus(c.starts, -10 * H) });
    assert.equal((await payment(c.bookingId)).status, 'refunded');
    assert.equal((await A.q('select late_cancellations from profiles where user_id = $1', [m1.userId]))[0].late_cancellations, 1);
  });
  // [política, horas antes, % reembolso esperado]
  const cases: [string, number, number][] = [
    ['flexible', 48, 100], ['flexible', 24, 100], ['flexible', 23.99, 50], ['flexible', 1, 50],
    ['moderada', 100, 100], ['moderada', 72, 100], ['moderada', 71.99, 50], ['moderada', 24, 50], ['moderada', 23.99, 0], ['moderada', 0.5, 0],
    ['estricta', 200, 100], ['estricta', 168, 100], ['estricta', 167.99, 50], ['estricta', 72, 50], ['estricta', 71.99, 0], ['estricta', 3, 0],
  ];
  for (const [policy, hours, pct] of cases) {
    it(`bar cancela con política ${policy} a ${hours} h → reembolso ${pct}% (con comisiones)`, async () => {
      await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
      const c = await toConfirmed(bar1, m1, 10, { policy });
      await A.cancel(bar1, c.bookingId, '', { now: plus(c.starts, -hours * H) });
      const p = await payment(c.bookingId);
      const rc = Math.floor(100000 * pct / 100), rf = Math.floor(5000 * pct / 100);
      const retained = 100000 - rc, mfee = Math.floor(retained * 1000 / 10000);
      assert.equal(p.refunded_ars, rc + rf);
      assert.equal(p.payout_ars, retained - mfee);
      assert.equal(p.platform_fee_ars, 5000 - rf + mfee);
      assert.equal(p.status, pct === 0 ? 'released' : pct === 100 ? 'refunded' : 'partially_refunded');
    });
  }
  it('después de empezado el show ya no se puede cancelar; cancelar tarde cierra la fecha', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    await fails(A.cancel(bar1, c.bookingId, '', { now: plus(c.starts, 1 * H) }), 'show_already_started');
    const d = await toConfirmed(bar2, m2, 11);
    await A.cancel(bar2, d.bookingId, '', { now: plus(d.starts, -1 * H) });
    assert.equal(await lstatus(d.id), 'cerrada');
  });
  it('no se puede cancelar rechazadas, expiradas ni realizadas', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id); await A.respond(bar1, b.id, false);
    await fails(A.cancel(m1, b.id), 'invalid_state');
    const c = await toConfirmed(bar2, m2, 11);
    await A.complete(m2, c.bookingId, { now: plus(c.ends, H) });
    await fails(A.cancel(bar2, c.bookingId, '', { now: plus(c.ends, H) }), 'invalid_state');
  });
});

describe('Realización, auto-cierre y disputas', () => {
  it('completar es idempotente y también lo puede hacer el sistema', async () => {
    const c = await toConfirmed(bar1, m1, 10), d = await toConfirmed(bar2, m2, 11);
    const t = plus(c.ends, H);
    await A.complete(bar1, c.bookingId, { now: t }); await A.complete(m1, c.bookingId, { now: t });
    assert.equal(await A.completeDue({ now: plus(d.ends, H) }), 1);
    assert.equal(await A.completeDue({ now: plus(d.ends, H) }), 0);
    assert.equal(await bstatus(d.bookingId), 'realizada');
  });
  it('disputa: solo después de empezar; bloquea el pago hasta que el equipo resuelve', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    await fails(A.report(bar1, c.bookingId, 'no vino', { now: plus(c.starts, -H) }), 'invalid_state');
    await fails(A.report(bar1, c.bookingId, '   ', { now: plus(c.starts, H) }), 'invalid_reason');
    const t = plus(c.ends, H);
    const r = await A.report(bar1, c.bookingId, 'el músico no se presentó', { now: t });
    assert.equal(r.disputed_by, 'bar');
    await A.report(m1, c.bookingId, 'otra', { now: t }); // idempotente, mantiene la primera
    await fails(A.complete(m1, c.bookingId, { now: t }), 'booking_disputed');
    assert.equal(await A.completeDue({ now: t }), 0);
    assert.equal((await payment(c.bookingId)).status, 'held');
    await fails(A.cancel(bar1, c.bookingId, '', { now: t }), 'show_already_started');
  });
  it('resolución de disputa: 100% reembolsa y cancela; parcial liquida y realiza', async () => {
    await A.q('update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000');
    const c = await toConfirmed(bar1, m1, 10), d = await toConfirmed(bar2, m2, 11);
    for (const x of [c, d]) await A.report(bar1.entityId === x.row.venue_id ? bar1 : bar2, x.bookingId, 'problema', { now: plus(x.ends, H) });
    await fails(A.resolveDispute(c.bookingId, 101), 'invalid_pct');
    assert.equal((await A.resolveDispute(c.bookingId, 100)).status, 'cancelada');
    assert.equal((await payment(c.bookingId)).status, 'refunded');
    assert.equal((await A.resolveDispute(d.bookingId, 30)).status, 'realizada');
    const p = await payment(d.bookingId);
    assert.deepEqual([p.refunded_ars, p.payout_ars, p.platform_fee_ars], [31500, 63000, 10500 + 0]);
    await fails(A.resolveDispute(d.bookingId, 0), 'invalid_state');
  });
});

describe('Reseñas', () => {
  async function done() {
    const c = await toConfirmed(bar1, m1, 10); const t = plus(c.ends, H);
    await A.complete(m1, c.bookingId, { now: t }); return { ...c, t };
  }
  it('solo tras un show realizado, una por parte, con calificaciones válidas', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    await fails(A.review(bar1, c.bookingId, 5, BAR_KEYS), 'booking_not_completed');
    await A.complete(m1, c.bookingId, { now: plus(c.ends, H) });
    const o = { now: plus(c.ends, 2 * H) };
    for (const r of [0, 6, null]) await fails(A.review(bar1, c.bookingId, r, BAR_KEYS, '', o), 'invalid_rating');
    await fails(A.review(bar1, c.bookingId, 3.5 as any, BAR_KEYS, '', o), '22P02'); // no es entero
    await fails(A.review(bar1, c.bookingId, 5, MUS_KEYS, '', o), 'invalid_breakdown'); // claves del rol equivocado
    await fails(A.review(bar1, c.bookingId, 5, { punctuality: 5 }, '', o), 'invalid_breakdown');
    await fails(A.review(bar1, c.bookingId, 5, { ...BAR_KEYS, extra: 1 }, '', o), 'invalid_breakdown');
    await fails(A.review(bar1, c.bookingId, 5, { ...BAR_KEYS, liveSound: 6 }, '', o), 'invalid_breakdown');
    await fails(A.review(bar1, c.bookingId, 5, { ...BAR_KEYS, liveSound: 'alto' }, '', o), 'invalid_breakdown');
    await fails(A.review(bar1, c.bookingId, 5, [1, 2], '', o), 'invalid_breakdown');
    await fails(A.review(bar1, c.bookingId, 5, BAR_KEYS, 'x'.repeat(1001), o), 'comment_too_long');
    await A.review(bar1, c.bookingId, 5, BAR_KEYS, '<script>alert(1)</script>', o);
    await fails(A.review(bar1, c.bookingId, 1, BAR_KEYS, '', o), 'already_reviewed');
  });
  it('ventana de reseñas: cerrada a los 14 días', async () => {
    const c = await done();
    await fails(A.review(bar1, c.bookingId, 5, BAR_KEYS, '', { now: plus(c.ends, 14 * D + H) }), 'review_window_closed');
    await A.review(bar1, c.bookingId, 5, BAR_KEYS, '', { now: plus(c.ends, 13 * D) });
  });
  it('una reseña solitaria se publica sola al cerrarse la ventana (y suma a la calificación)', async () => {
    const c = await done();
    await A.review(bar1, c.bookingId, 2, BAR_KEYS, 'tarde', { now: c.t });
    assert.equal(await A.publishDue({ now: plus(c.ends, 13 * D) }), 0);
    singlePublished = true;
    assert.equal(await A.publishDue({ now: plus(c.ends, 15 * D) }), 1);
    const m = (await A.q('select rating, review_count from musicians where id = $1', [m1.entityId]))[0];
    assert.deepEqual([m.rating, m.review_count], [3.67, 6]); // (4*5+2)/6
    assert.equal(await A.publishDue({ now: plus(c.ends, 16 * D) }), 0); // idempotente
  });
});

describe('Chat de la reserva', () => {
  it('participantes se escriben; validaciones; bloqueado en rechazadas/expiradas', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    assert.equal((await A.message(m1, b.id, '  hola, ¿hay backline?  ')).body, 'hola, ¿hay backline?');
    await A.message(bar1, b.id, 'sí, batería y bajo');
    await fails(A.message(m1, b.id, '   '), 'empty_message');
    await fails(A.message(m1, b.id, 'x'.repeat(2001)), 'message_too_long');
    const seen = await asUser(pool, bar1.userId, async (c) => (await c.query('select sender_role from messages order by created_at')).rows.map((r) => r.sender_role));
    assert.deepEqual(seen, ['musico', 'bar']);
    await A.respond(bar1, b.id, false);
    await fails(A.message(m1, b.id, 'gracias'), 'invalid_state');
  });
  it('límite de mensajes por reserva', async () => {
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id);
    await A.q(`insert into messages (booking_id, sender_role, sender_user, body) select $1, 'musico', $2, 'm' from generate_series(1, 500)`, [b.id, m1.userId]);
    await fails(A.message(m1, b.id, 'uno más'), 'message_limit');
  });
});

describe('Migración', () => {
  it('es idempotente (se puede correr dos veces) y no rompe datos', async () => {
    const c = await toConfirmed(bar1, m1, 10);
    const sql = (await import('node:fs')).readFileSync(new URL('../../supabase/migrations/20261019000000_reservas.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    await pool.query('update app_settings set allow_clock_override = true');
    assert.equal(await bstatus(c.bookingId), 'confirmada');
  });
});
