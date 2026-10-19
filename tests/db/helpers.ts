import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// bigint (int8) -> number (los montos en ARS entran de sobra en 2^53)
pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));
// numeric -> number
pg.types.setTypeParser(1700, (v: string) => parseFloat(v));

export const ADMIN_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:pw@localhost:5432/postgres';
const ROOT = path.resolve(import.meta.dirname, '../..');
const SQL_FILES = ['tests/db/00_supabase_stub.sql', 'supabase-schema.sql', 'supabase/migrations/20261019000000_reservas.sql'];

/** Crea una base limpia con el esquema real + migración y devuelve un Pool. */
export async function createTestDb(name: string, poolSize = 30): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = '/' + name;
  const pool = new pg.Pool({ connectionString: url.toString(), max: poolSize });
  const c = await pool.connect();
  try {
    for (const f of SQL_FILES) await c.query(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    await c.query(`update public.app_settings set allow_clock_override = true`);
  } finally { c.release(); }
  return pool;
}

export async function dropTestDb(pool: pg.Pool, name: string) {
  await pool.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
}

export class BizError extends Error {
  constructor(public code: string, public sqlstate: string) { super(code); }
}

export interface Actor { userId: string; role: 'bar' | 'musico'; entityId: string; }
export interface CallOpts { now?: Date | string; role?: 'authenticated' | 'anon' | 'service_role' | 'postgres'; }

/** Ejecuta una transacción como un usuario autenticado (como lo hace PostgREST). */
export async function asUser<T>(pool: pg.Pool, userId: string | null, fn: (c: pg.PoolClient) => Promise<T>, opts: CallOpts = {}): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const role = opts.role ?? 'authenticated';
    if (role !== 'postgres') await c.query(`set local role ${role}`);
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    if (opts.now) await c.query(`select set_config('app.now', $1, true)`, [new Date(opts.now).toISOString()]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e: any) {
    try { await c.query('rollback'); } catch { /* ignore */ }
    if (e && e.code === 'P0001') throw new BizError(e.message, e.code);
    throw e;
  } finally { c.release(); }
}

/** Llama una función del sistema (cron / service role). */
export const asSystem = <T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>, opts: CallOpts = {}) =>
  asUser(pool, null, fn, { ...opts, role: 'postgres' });

export const H = 3600_000;
export const D = 24 * H;

/** Fecha futura a partir de ahora real, en ms. */
export const inFuture = (ms: number) => new Date(Date.now() + ms);

export function api(pool: pg.Pool) {
  const one = async (a: Actor | string | null, sql: string, params: unknown[], opts?: CallOpts) =>
    asUser(pool, typeof a === 'string' || a === null ? a : a.userId, async (c) => (await c.query(sql, params)).rows[0], opts);
  return {
    createListing: (a: Actor, p: { starts: Date; ends: Date; cachet: number; mode?: string; policy?: string; genres?: string[]; notes?: string }, o?: CallOpts) =>
      one(a, 'select * from public.create_listing($1,$2,$3,$4,$5,$6,$7,$8)',
        [p.starts, p.ends, p.cachet, p.genres ?? ['Jazz'], ['Batería'], p.notes ?? '', p.mode ?? 'approval', p.policy ?? 'moderada'], o),
    cancelListing: (a: Actor, id: string, o?: CallOpts) => one(a, 'select * from public.cancel_listing($1)', [id], o),
    request: (a: Actor, listingId: string, proposed: number | null = null, note = '', o?: CallOpts) =>
      one(a, 'select * from public.request_booking($1,$2,$3)', [listingId, proposed, note], o),
    respond: (a: Actor, id: string, accept: boolean, reason = '', o?: CallOpts) => one(a, 'select * from public.respond_booking($1,$2,$3)', [id, accept, reason], o),
    fund: (a: Actor, id: string, o?: CallOpts) => one(a, 'select * from public.fund_booking($1,$2)', [id, 'mp_sim_' + id.slice(0, 8)], o),
    cancel: (a: Actor, id: string, reason = '', o?: CallOpts) => one(a, 'select * from public.cancel_booking($1,$2)', [id, reason], o),
    complete: (a: Actor, id: string, o?: CallOpts) => one(a, 'select * from public.complete_booking($1)', [id], o),
    report: (a: Actor, id: string, reason: string, o?: CallOpts) => one(a, 'select * from public.report_problem($1,$2)', [id, reason], o),
    review: (a: Actor, id: string, rating: number | null, breakdown: unknown, comment = '', o?: CallOpts) =>
      one(a, 'select * from public.submit_review($1,$2,$3,$4)', [id, rating, JSON.stringify(breakdown), comment], o),
    message: (a: Actor, id: string, body: string, o?: CallOpts) => one(a, 'select * from public.send_message($1,$2)', [id, body], o),
    expireStale: (o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select public.expire_stale_bookings() n')).rows[0].n as number, o),
    completeDue: (o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select public.complete_due_bookings() n')).rows[0].n as number, o),
    publishDue: (o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select public.publish_due_reviews() n')).rows[0].n as number, o),
    resolveDispute: (id: string, pct: number, o?: CallOpts) =>
      asSystem(pool, async (c) => (await c.query('select * from public.admin_resolve_dispute($1,$2)', [id, pct])).rows[0], o),
    q: async <R = any>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as R[],
  };
}
export type Api = ReturnType<typeof api>;

export const BAR_KEYS = { punctuality: 5, liveSound: 4, crowdDrawing: 4, professionalism: 5 }; // lo califica el bar (al músico)
export const MUS_KEYS = { soundQuality: 5, paymentReliability: 5, hospitality: 4, respect: 5 }; // lo califica el músico (al bar)

/** Crea N bares y N músicos con usuarios y perfiles. */
export async function seedActors(pool: pg.Pool, nBars: number, nMus: number, prefix = 't') {
  const bars: Actor[] = [], mus: Actor[] = [];
  for (let i = 1; i <= nBars; i++) {
    const id = `${prefix}-bar-${i}`, uid = randomUUID();
    await pool.query(`insert into public.venues (id,name,neighborhood,address,type,rating,review_count,base_rating,base_count,base_breakdown)
      values ($1,$2,'Palermo Soho','Calle ${i}','Bar de Copas',4.5,10,4.5,10,'{"soundQuality":4.5,"paymentReliability":4.5,"hospitality":4.5,"respect":4.5}')`, [id, `Bar ${i}`]);
    await pool.query(`insert into auth.users (id,email) values ($1,$2)`, [uid, `${id}@t.com`]);
    await pool.query(`insert into public.profiles (user_id,role,venue_id) values ($1,'bar',$2)`, [uid, id]);
    bars.push({ userId: uid, role: 'bar', entityId: id });
  }
  for (let i = 1; i <= nMus; i++) {
    const id = `${prefix}-mus-${i}`, uid = randomUUID();
    await pool.query(`insert into public.musicians (id,stage_name,format,rating,review_count,base_rating,base_count,base_breakdown)
      values ($1,$2,'Trío',4.0,5,4.0,5,'{"punctuality":4,"liveSound":4,"crowdDrawing":4,"professionalism":4}')`, [id, `Músico ${i}`]);
    await pool.query(`insert into auth.users (id,email) values ($1,$2)`, [uid, `${id}@t.com`]);
    await pool.query(`insert into public.profiles (user_id,role,musician_id) values ($1,'musico',$2)`, [uid, id]);
    mus.push({ userId: uid, role: 'musico', entityId: id });
  }
  return { bars, mus };
}

export async function resetData(pool: pg.Pool) {
  await pool.query(`truncate public.messages, public.booking_reviews, public.payments, public.booking_events,
    public.bookings, public.listings, public.profiles cascade;
    delete from auth.users; delete from public.venues where id like 't-%' or id like 'sim-%'; delete from public.musicians where id like 't-%' or id like 'sim-%';
    update public.app_settings set venue_fee_bps = 0, musician_fee_bps = 0, max_pending_requests = 20, request_ttl_hours = 48, fund_ttl_hours = 48, review_window_days = 14`);
}

const ALLOWED: Record<string, string[]> = {
  solicitada: ['aceptada', 'rechazada', 'cancelada', 'expirada'],
  aceptada: ['confirmada', 'cancelada', 'expirada'],
  confirmada: ['realizada', 'cancelada'],
  realizada: [], rechazada: [], cancelada: [], expirada: [],
};

/** Verifica todas las invariantes del sistema. Devuelve la lista de violaciones. */
export async function checkInvariants(pool: pg.Pool, opts: { singlePublishedAllowed?: boolean } = {}): Promise<string[]> {
  const bad: string[] = [];
  const q = async (sql: string) => (await pool.query(sql)).rows;
  const expectEmpty = async (name: string, sql: string) => { const r = await q(sql); if (r.length) bad.push(`${name}: ${JSON.stringify(r.slice(0, 3))} (${r.length})`); };

  await expectEmpty('1 más de una reserva activa por publicación',
    `select listing_id from bookings where status in ('aceptada','confirmada','realizada') group by 1 having count(*) > 1`);
  await expectEmpty('2 músico con shows superpuestos',
    `select a.id from bookings a join bookings b on a.musician_id = b.musician_id and a.id < b.id
     where a.status in ('aceptada','confirmada','realizada') and b.status in ('aceptada','confirmada','realizada')
       and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)`);
  await expectEmpty('3a publicación reservada sin reserva activa',
    `select l.id from listings l where l.status = 'reservada' and not exists
       (select 1 from bookings b where b.listing_id = l.id and b.status in ('aceptada','confirmada','realizada'))`);
  await expectEmpty('3b reserva activa en publicación no reservada',
    `select b.id from bookings b join listings l on l.id = b.listing_id
     where b.status in ('aceptada','confirmada','realizada') and l.status <> 'reservada'`);
  await expectEmpty('3c publicación cancelada con solicitudes vivas',
    `select b.id from bookings b join listings l on l.id = b.listing_id where l.status = 'cancelada' and b.status in ('solicitada','aceptada')`);
  await expectEmpty('4a pago retenido <=> reserva confirmada',
    `select b.id from bookings b left join payments p on p.booking_id = b.id
     where (b.status = 'confirmada') <> (p.status = 'held') and (b.status = 'confirmada' or p.status = 'held')`);
  await expectEmpty('4b pago en reserva sin dinero (solicitada/aceptada/rechazada/expirada)',
    `select b.id from bookings b join payments p on p.booking_id = b.id where b.status in ('solicitada','aceptada','rechazada','expirada')`);
  await expectEmpty('4c reserva confirmada/realizada sin pago',
    `select b.id from bookings b left join payments p on p.booking_id = b.id where b.status in ('confirmada','realizada') and p.id is null`);
  await expectEmpty('4d realizada con pago sin liquidar', `select b.id from bookings b join payments p on p.booking_id = b.id where b.status = 'realizada' and p.status = 'held'`);
  await expectEmpty('5a el dinero no cuadra (cobrado ≠ reembolso + pago + plataforma)',
    `select id from payments where status <> 'held' and charged_ars <> refunded_ars + payout_ars + platform_fee_ars`);
  await expectEmpty('5b montos negativos o comisión mal calculada',
    `select id from payments where refunded_ars < 0 or payout_ars < 0 or platform_fee_ars < 0 or charged_ars <> cachet_ars + venue_fee_ars
       or venue_fee_ars <> (cachet_ars * venue_fee_bps) / 10000 or payout_ars > cachet_ars`);
  await expectEmpty('5c pago distinto del cachet de la reserva', `select p.id from payments p join bookings b on b.id = p.booking_id where p.cachet_ars <> b.cachet_ars`);
  await expectEmpty('6a reseña de reserva no realizada', `select r.id from booking_reviews r join bookings b on b.id = r.booking_id where b.status <> 'realizada'`);
  if (!opts.singlePublishedAllowed) {
    await expectEmpty('6b reseña publicada sin que ambos hayan reseñado',
      `select r.booking_id from booking_reviews r where r.published_at is not null group by 1 having count(*) < 2`);
  }
  await expectEmpty('6c reseñas de una pareja con estado de publicación distinto',
    `select booking_id from booking_reviews group by 1 having count(*) = 2 and count(published_at) = 1`);

  // 7. Calificaciones = línea base + reseñas publicadas (recalculado de forma independiente)
  const agg = await q(`
    select 'venue' kind, v.id, v.rating, v.review_count, v.rating_breakdown, v.base_rating, v.base_count, v.base_breakdown,
           coalesce((select jsonb_agg(jsonb_build_object('r', r.rating, 'b', r.breakdown)) from booking_reviews r where r.target_id = v.id and r.author_role = 'musico' and r.published_at is not null), '[]') revs
      from venues v where v.id like 't-%' or v.id like 'sim-%'
    union all
    select 'musician', m.id, m.rating, m.review_count, m.rating_breakdown, m.base_rating, m.base_count, m.base_breakdown,
           coalesce((select jsonb_agg(jsonb_build_object('r', r.rating, 'b', r.breakdown)) from booking_reviews r where r.target_id = m.id and r.author_role = 'bar' and r.published_at is not null), '[]')
      from musicians m where m.id like 't-%' or m.id like 'sim-%'`);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (const row of agg) {
    const revs: { r: number; b: Record<string, number> }[] = row.revs;
    const n = revs.length;
    const expRating = r2((row.base_rating * row.base_count + revs.reduce((s, x) => s + x.r, 0)) / (row.base_count + n));
    if (Math.abs(expRating - row.rating) > 0.011 || row.review_count !== row.base_count + n)
      bad.push(`7 ${row.kind} ${row.id}: rating ${row.rating}/${row.review_count} esperado ${expRating}/${row.base_count + n}`);
    if (n > 0) for (const k of Object.keys(row.rating_breakdown)) {
      const exp = r2(((row.base_breakdown?.[k] ?? row.base_rating) * row.base_count + revs.reduce((s, x) => s + Number(x.b[k]), 0)) / (row.base_count + n));
      if (Math.abs(exp - Number(row.rating_breakdown[k])) > 0.011) bad.push(`7 ${row.kind} ${row.id}: breakdown.${k} ${row.rating_breakdown[k]} esperado ${exp}`);
    }
  }

  // 8. Auditoría: cada reserva sigue transiciones válidas y termina en su estado actual
  const bookings = await q(`select id, status from bookings`);
  const events = await q(`select booking_id, event, from_status, to_status from booking_events order by id`);
  const byB = new Map<string, any[]>();
  for (const e of events) (byB.get(e.booking_id) ?? byB.set(e.booking_id, []).get(e.booking_id)!).push(e);
  for (const b of bookings) {
    const ev = (byB.get(b.id) ?? []).filter((e) => e.event !== 'resena' && e.event !== 'disputa');
    if (!ev.length || ev[0].event !== 'solicitada') { bad.push(`8 ${b.id}: no empieza con 'solicitada'`); continue; }
    let cur = 'solicitada';
    for (const e of ev.slice(1)) {
      if (e.from_status !== cur || !ALLOWED[cur]?.includes(e.to_status)) { bad.push(`8 ${b.id}: transición inválida ${cur} -> ${e.to_status} (from=${e.from_status})`); break; }
      cur = e.to_status;
    }
    if (cur !== b.status) bad.push(`8 ${b.id}: auditoría termina en ${cur} pero el estado es ${b.status}`);
  }

  await expectEmpty('9 strikes de cancelación tardía no coinciden con la auditoría',
    `select p.user_id from profiles p where p.role = 'musico' and p.late_cancellations <>
       (select count(*) from booking_events e join bookings b on b.id = e.booking_id
         where b.musician_id = p.musician_id and e.event = 'cancelada' and e.meta ->> 'by' = 'musico' and (e.meta ->> 'late')::boolean)`);
  return bad;
}
