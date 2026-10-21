import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, checkInvariants, BizError, H, D, BAR_KEYS, MUS_KEYS, type Actor, type Api } from './helpers.ts';

/**
 * Simulación concurrente: 10 bares y 10 músicos operando a la vez sobre un Postgres real.
 * Cada fase lanza todas sus acciones en paralelo (pool de 30 conexiones), mezclando
 * carreras (aceptar la misma fecha, doble pago, cancelar a la vez, completar x3, reseñar a la vez...),
 * saltos de reloj y entradas inválidas. Al final se verifican las invariantes del sistema.
 */
const DB = 'suenaba_sim';
let pool: pg.Pool, A: Api;

function rng(seed: number) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

before(async () => { pool = await createTestDb(DB, 30); A = api(pool); });
after(async () => { await dropTestDb(pool, DB); });

interface Fees { v: number; m: number }
async function scenario(seed: number, fees: Fees) {
  const R = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(R() * xs.length)];
  const chance = (p: number) => R() < p;

  await resetData(pool);
  await A.q('update app_settings set venue_fee_bps = $1, musician_fee_bps = $2', [fees.v, fees.m]);
  const { bars, mus } = await seedActors(pool, 10, 10, 'sim');
  // Prueba de sabotaje (solo local): MUTATE=overlap quita la protección contra shows superpuestos
  if (process.env.MUTATE === 'overlap') await A.q('alter table bookings drop constraint if exists bookings_musician_no_overlap');
  if (process.env.MUTATE === 'double') await A.q('drop index if exists bookings_one_active_per_listing');
  const barBy = new Map(bars.map((b) => [b.entityId, b])), musBy = new Map(mus.map((m) => [m.entityId, m]));

  const ok: Record<string, number> = {}, biz: Record<string, number> = {}, unexpected: string[] = [];
  const attempt = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try { const r = await fn(); ok[label] = (ok[label] ?? 0) + 1; return r; }
    catch (e: any) {
      if (e instanceof BizError) { biz[`${label}:${e.code}`] = (biz[`${label}:${e.code}`] ?? 0) + 1; return undefined; }
      unexpected.push(`${label}: [${e.code}] ${e.message}`); return undefined;
    }
  };
  const all = (xs: Promise<unknown>[]) => Promise.all(xs);

  // ---- Grilla de horarios: tarde / noche / trasnoche (solapa con noche) en 10 días
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const slot = (d: number, k: number) => {
    const [h0, len] = [[16, 3], [20, 3], [22.5, 3.5]][k];
    const s = new Date(midnight.getTime() + d * D + h0 * H); return { starts: s, ends: new Date(s.getTime() + len * H) };
  };

  const listingIds: string[] = [];
  const asBookings = async (status: string) => (await A.q(`select b.*, l.booking_mode from bookings b join listings l on l.id = b.listing_id where b.status = $1`, [status]));

  // ================= Fase 0: los músicos guardan búsquedas (alertas) y los bares/músicos marcan favoritos
  const NEIGH = ['Palermo Soho', 'San Telmo', 'Villa Crespo'];
  await A.q(`update venues set neighborhood = (array['Palermo Soho','San Telmo','Villa Crespo'])[1 + (length(id) + ascii(right(id,1))) % 3] where id like 'sim-%'`);
  await all(mus.flatMap((m) => Array.from({ length: 1 + Math.floor(R() * 3) }, () =>
    attempt('save_search', () => A.saveSearch(m, 'alerta', chance(0.5) ? { neighborhoods: [pick(NEIGH)] } : { minCachet: pick([0, 100000]), mode: pick(['instant', 'approval']) })))));

  // ================= Fase 1: los 10 bares publican fechas a la vez
  await all(bars.flatMap((bar) => Array.from({ length: 14 }, () => {
    const { starts, ends } = slot(5 + Math.floor(R() * 10), Math.floor(R() * 3));
    const mode = chance(0.3) ? 'instant' : 'approval', policy = pick(['flexible', 'moderada', 'estricta']);
    const cachet = pick([0, 50000, 120000, 250000, 400000]);
    return attempt('create_listing', async () => { const l = await A.createListing(bar, { starts, ends, cachet, mode, policy } as any); listingIds.push(l.id); });
  })));
  // Entradas inválidas mezcladas
  await all(bars.slice(0, 3).map((b) => attempt('create_listing_invalid', () => A.createListing(b, { starts: new Date(Date.now() + H), ends: new Date(Date.now() + 3 * H), cachet: 1 } as any))));

  for (let wave = 1; wave <= 2; wave++) {
    // ================= Fase 2: los 10 músicos piden fechas a la vez (mucha contención)
    const open = (await A.q(`select id from listings where status = 'abierta'`)).map((r) => r.id as string);
    await all(mus.flatMap((m) => Array.from({ length: 22 }, () => {
      const id = pick(open.length ? open : listingIds);
      const prop = chance(0.2) ? pick([10000, 90000, 300000]) : null;
      return attempt('request', () => A.request(m, id, prop, chance(0.3) ? 'Hola, somos una banda…' : ''));
    })));

    // Actividad concurrente de descubrimiento: búsquedas, favoritos, lectura de notificaciones y workers de entrega
    await all([
      ...mus.flatMap((m) => [
        attempt('search', () => A.search(m, { neighborhoods: chance(0.5) ? [pick(NEIGH)] : undefined, hide_busy: chance(0.5), sort: pick(['date', 'cachet_desc', 'rating_desc']), limit: 10, offset: chance(0.3) ? 10 : 0 })),
        attempt('fav', () => A.toggleFav(m, 'venue', pick(bars).entityId)),
        attempt('fav', () => A.toggleFav(m, 'listing', pick(listingIds))),
        attempt('mark_read', () => A.markRead(m)),
      ]),
      ...bars.flatMap((b) => [attempt('fav', () => A.toggleFav(b, 'musician', pick(mus).entityId)), attempt('mark_read', () => A.markRead(b))]),
      attempt('search_anon', () => A.search(null, { limit: 20 })),
      attempt('stats', () => A.stats('venue', pick(bars).entityId)),
      attempt('claim', () => A.claimPending(50)), attempt('claim', () => A.claimPending(50)),
    ]);

    // ================= Fase 3: los bares responden en paralelo (+ duplicados y retiros en carrera)
    const pending = await asBookings('solicitada');
    await all(pending.flatMap((b) => {
      const bar = barBy.get(b.venue_id)!, m = musBy.get(b.musician_id)!, r = R();
      const tasks: Promise<unknown>[] = [];
      if (r < 0.6) { tasks.push(attempt('respond_accept', () => A.respond(bar, b.id, true))); if (chance(0.25)) tasks.push(attempt('respond_accept', () => A.respond(bar, b.id, true))); }
      else if (r < 0.85) tasks.push(attempt('respond_reject', () => A.respond(bar, b.id, false, 'no encaja')));
      if (chance(0.1)) tasks.push(attempt('cancel_by_musician', () => A.cancel(m, b.id, 'me retiro')));
      if (chance(0.3)) tasks.push(attempt('message', () => A.message(chance(0.5) ? bar : m, b.id, 'Hola! ¿Confirmamos?')));
      return tasks;
    }));

    // ================= Fase 4: pagos (con dobles pagos en carrera) y retiros
    const accepted = await asBookings('aceptada');
    await all(accepted.flatMap((b) => {
      const bar = barBy.get(b.venue_id)!, m = musBy.get(b.musician_id)!, r = R();
      const tasks: Promise<unknown>[] = [];
      if (r < 0.85) { tasks.push(attempt('fund', () => A.fund(bar, b.id))); if (chance(0.3)) tasks.push(attempt('fund', () => A.fund(bar, b.id))); }
      if (r > 0.8 && r < 0.9) tasks.push(attempt('cancel_by_musician', () => A.cancel(m, b.id)));
      if (chance(0.3)) tasks.push(attempt('message', () => A.message(m, b.id, 'Llevamos nuestro bajo')));
      return tasks;
    }));

    // ================= Fase 4b: vencimientos 3 días más tarde (solicitudes y pagos que nadie atendió)
    const t3 = new Date(Date.now() + 3 * D);
    await all([attempt('expire_job', () => A.expireStale({ now: t3 })), attempt('expire_job', () => A.expireStale({ now: t3 }))]);
  }

  // ================= Fase 5: cancelaciones de reservas pagadas a distintas distancias del show
  const confirmed = await asBookings('confirmada');
  await all(confirmed.flatMap((b) => {
    const bar = barBy.get(b.venue_id)!, m = musBy.get(b.musician_id)!, r = R();
    const at = { now: new Date(new Date(b.starts_at).getTime() - pick([0.5, 5, 23, 25, 50, 80, 120, 200, 400]) * H) };
    const tasks: Promise<unknown>[] = [];
    if (r < 0.2) tasks.push(attempt('cancel_by_bar', () => A.cancel(bar, b.id, '', at)));
    else if (r < 0.3) tasks.push(attempt('cancel_by_musician', () => A.cancel(m, b.id, '', at)));
    if (r < 0.06) tasks.push(attempt('cancel_by_musician', () => A.cancel(m, b.id, '', at))); // ambos cancelan a la vez
    if (r > 0.9) tasks.push(attempt('complete_too_early', () => A.complete(bar, b.id)));
    return tasks;
  }));

  // ================= Fase 6: pasa el tiempo: disputas, y completar x3 en carrera + jobs del sistema
  const lastEnd = (await A.q('select max(ends_at) m from bookings'))[0].m as Date;
  const T1 = new Date(new Date(lastEnd).getTime() + 1 * H);
  const live = await asBookings('confirmada');
  const disputed = live.filter(() => chance(0.12));
  await all(disputed.map((b) => attempt('report_problem', () => A.report(chance(0.5) ? barBy.get(b.venue_id)! : musBy.get(b.musician_id)!, b.id, 'No se cumplió lo acordado', { now: T1 }))));
  await all([
    ...live.flatMap((b) => [
      attempt('complete', () => A.complete(barBy.get(b.venue_id)!, b.id, { now: T1 })),
      attempt('complete', () => A.complete(musBy.get(b.musician_id)!, b.id, { now: T1 })),
    ]),
    attempt('complete_job', () => A.completeDue({ now: T1 })),
    attempt('expire_job', () => A.expireStale({ now: T1 })),
  ]);
  const held = await A.q(`select b.id from bookings b where b.disputed_at is not null and b.status = 'confirmada'`);
  await all(held.filter((_, i) => i % 3 !== 0).map((b) => attempt('resolve_dispute', () => A.resolveDispute(b.id, pick([0, 25, 50, 100])))));

  // ================= Fase 7: reseñas cruzadas en paralelo (mismas filas de calificación en disputa)
  const T2 = new Date(T1.getTime() + 1 * H);
  const done = await asBookings('realizada');
  await all(done.flatMap((b) => {
    const bar = barBy.get(b.venue_id)!, m = musBy.get(b.musician_id)!;
    const tasks: Promise<unknown>[] = [];
    const bd = (keys: Record<string, number>) => Object.fromEntries(Object.keys(keys).map((k) => [k, 1 + Math.floor(R() * 5)]));
    if (chance(0.85)) tasks.push(attempt('review_bar', () => A.review(bar, b.id, 1 + Math.floor(R() * 5), bd(BAR_KEYS), 'Gran show', { now: T2 })));
    if (chance(0.8)) tasks.push(attempt('review_musician', () => A.review(m, b.id, 1 + Math.floor(R() * 5), bd(MUS_KEYS), 'Buen lugar', { now: T2 })));
    if (chance(0.15)) tasks.push(attempt('review_duplicate', () => A.review(bar, b.id, 5, BAR_KEYS, '', { now: T2 })));
    if (chance(0.1)) tasks.push(attempt('review_invalid', () => A.review(m, b.id, 9, MUS_KEYS, '', { now: T2 })));
    if (chance(0.2)) tasks.push(attempt('message', () => A.message(m, b.id, 'Gracias!', { now: T2 })));
    return tasks;
  }));

  // ================= Fase 8: se cierra la ventana: publicación de reseñas solitarias (dos jobs a la vez)
  const T3 = new Date(T1.getTime() + 16 * D);
  await all([attempt('publish_job', () => A.publishDue({ now: T3 })), attempt('publish_job', () => A.publishDue({ now: T3 }))]);

  await all([...bars, ...mus].map((x) => attempt('earnings', () => A.earnings(x))));
  // dos workers vacían la cola en lotes (máx. 500 por lote) sin entregar nada dos veces
  const claimed: string[] = [];
  const drain = async () => { for (;;) { const got = await A.claimPending(200); if (!got.length) return; claimed.push(...got); await all(got.map((id) => A.completeDelivery(id, true, null, true, false))); } };
  await all([drain(), drain()]);
  if (new Set(claimed).size !== claimed.length) unexpected.push('una notificación se reclamó dos veces');
  const undelivered = (await A.q('select count(*)::int n from notifications where delivered_at is null'))[0].n;
  if (undelivered) unexpected.push(`quedaron ${undelivered} notificaciones sin entregar tras vaciar la cola`);

  // ================= Verificación final
  const violations = await checkInvariants(pool, { singlePublishedAllowed: true });
  const byStatus = Object.fromEntries((await A.q(`select status, count(*)::int n from bookings group by 1 order by 1`)).map((r) => [r.status, r.n]));
  const money = (await A.q(`select count(*)::int pagos, coalesce(sum(charged_ars),0) cobrado, coalesce(sum(refunded_ars),0) reembolsado,
      coalesce(sum(payout_ars),0) pagado_musicos, coalesce(sum(platform_fee_ars),0) plataforma,
      coalesce(sum(charged_ars) filter (where status = 'held'),0) retenido from payments`))[0];
  const reviews = (await A.q(`select count(*)::int total, count(published_at)::int publicadas from booking_reviews`))[0];
  const events = (await A.q(`select count(*)::int n from booking_events`))[0].n;
  const late = (await A.q(`select coalesce(sum(late_cancellations),0)::int n from profiles`))[0].n;
  const notifCount = (await A.q('select count(*)::int n from notifications'))[0].n, alerts = (await A.q(`select count(*)::int n from notifications where kind = 'search_match'`))[0].n;
  const favs = (await A.q('select count(*)::int n from favorites'))[0].n;
  return { notifCount, alerts, favs, ok, biz, unexpected, violations, byStatus, money, reviews, events, late, listings: listingIds.length };
}

const CONFIGS: [number, Fees][] = [[1, { v: 0, m: 0 }], [2, { v: 300, m: 700 }], [3, { v: 500, m: 500 }], [4, { v: 0, m: 1000 }]];
describe('Simulación concurrente: 10 bares × 10 músicos', () => {
  for (const [seed, fees] of CONFIGS) {
    it(`semilla ${seed} · comisión bar ${fees.v / 100}% / músico ${fees.m / 100}%`, { timeout: 180_000 }, async () => {
      const r = await scenario(seed, fees);
      const totalBiz = Object.values(r.biz).reduce((a, b) => a + b, 0), totalOk = Object.values(r.ok).reduce((a, b) => a + b, 0);
      console.log(`\n[semilla ${seed}] ${totalOk} operaciones OK, ${totalBiz} rechazos de negocio esperados, ${r.listings} fechas, ${r.events} eventos de auditoría`);
      console.log('  reservas por estado:', JSON.stringify(r.byStatus));
      console.log('  dinero (ARS):', JSON.stringify(r.money), '| reseñas:', JSON.stringify(r.reviews), '| cancelaciones tardías de músicos:', r.late);
      const top = Object.entries(r.biz).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}=${v}`).join(', ');
      console.log('  rechazos más frecuentes:', top);
      console.log(`  notificaciones: ${r.notifCount} (alertas de búsqueda: ${r.alerts}) · favoritos: ${r.favs}`);

      assert.deepEqual(r.unexpected, [], 'errores inesperados (deadlocks, violaciones de constraints, etc.):\n' + r.unexpected.slice(0, 10).join('\n'));
      assert.deepEqual(r.violations, [], 'invariantes violadas:\n' + r.violations.join('\n'));
      // Se ejercitó de verdad: hubo contención y todos los estados finales relevantes
      const contention = (r.biz['respond_accept:listing_not_open'] ?? 0) + (r.biz['respond_accept:invalid_state'] ?? 0) + (r.biz['request:listing_not_open'] ?? 0);
      assert.ok(contention > 0, 'no hubo contención real entre operaciones');
      for (const st of ['realizada', 'cancelada', 'rechazada', 'expirada']) assert.ok((r.byStatus[st] ?? 0) > 0, `ninguna reserva terminó en ${st}`);
      assert.ok(r.reviews.publicadas > 0);
      assert.ok(r.alerts > 0, 'ninguna alerta de búsqueda se disparó');
      assert.ok((r.ok['search'] ?? 0) > 0 && (r.ok['fav'] ?? 0) > 0);
      const m = r.money;
      assert.equal(m.cobrado, m.reembolsado + m.pagado_musicos + m.plataforma + m.retenido, 'el dinero total no cuadra');
      if (fees.v === 0 && fees.m === 0) assert.equal(m.plataforma, 0, 'comisión 0 no debe generar ganancia');
    });
  }
});
