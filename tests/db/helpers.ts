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
const SQL_FILES = ['tests/db/00_supabase_stub.sql', 'supabase-schema.sql', 'supabase/migrations/20261019000000_reservas.sql', 'supabase/migrations/20261020000000_airbnb_extras.sql', 'supabase/migrations/20261021000000_tour_novedades.sql', 'supabase/migrations/20261022000000_entrega_avisos.sql', 'supabase/migrations/20261023000000_mercado_pago.sql'];

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
    toggleFav: (a: Actor | string, kind: string, id: string, o?: CallOpts) => one(a, 'select public.toggle_favorite($1,$2) r', [kind, id], o).then((r: any) => r.r as boolean),
    saveSearch: (a: Actor, name: string, filters: unknown, o?: CallOpts) => one(a, 'select * from public.save_search($1,$2)', [name, JSON.stringify(filters)], o),
    deleteSearch: (a: Actor, id: string, o?: CallOpts) => one(a, 'select public.delete_saved_search($1) r', [id], o).then((r: any) => r.r as boolean),
    markRead: (a: Actor | string | null, ids: string[] | null = null, o?: CallOpts) => one(a, 'select public.mark_notifications_read($1) n', [ids], o).then((r: any) => r.n as number),
    search: (a: Actor | null, f: Record<string, unknown> = {}, o?: CallOpts) => {
      const k = ['from','to','neighborhoods','genres','min_cachet','max_cachet','mode','min_rating','text','hide_busy','sort','limit','offset'];
      const args = k.map((x) => (f[x] === undefined ? null : f[x]));
      return asUser(pool, a ? a.userId : null, async (c) => (await c.query(
        'select * from public.search_listings(p_from => $1, p_to => $2, p_neighborhoods => $3, p_genres => $4, p_min_cachet => $5, p_max_cachet => $6, p_mode => $7, p_min_rating => $8, p_text => $9, p_hide_busy => coalesce($10, false), p_sort => coalesce($11, \'date\'), p_limit => coalesce($12, 20), p_offset => coalesce($13, 0))', args)).rows, { role: a ? 'authenticated' : 'anon', ...o });
    },
    stats: (kind: string, id: string, o?: CallOpts) => asUser(pool, null, async (c) => (await c.query('select * from public.entity_stats($1,$2)', [kind, id])).rows, { role: 'anon', ...o }),
    earnings: (a: Actor, o?: CallOpts) => one(a, 'select * from public.my_earnings()', [], o),
    requestProfile: (userId: string, p: { role: string; name: string; neighborhood?: string | null; address?: string | null; bio?: string; evidence?: string | null }, o?: CallOpts) =>
      one(userId, 'select * from public.request_profile($1,$2,$3,$4,$5,$6)', [p.role, p.name, p.neighborhood ?? null, p.address ?? null, p.bio ?? '', p.evidence ?? null], o),
    reviewRequest: (id: string, approve: boolean, note = '', o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select * from public.admin_review_profile_request($1,$2,$3)', [id, approve, note])).rows[0], o),
    claimPending: (limit = 1000, o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select id from public.claim_pending_notifications($1)', [limit])).rows.map((r) => r.id as string), o),
    claimRows: (limit = 50, o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select * from public.claim_pending_notifications($1)', [limit])).rows, o),
    completeDelivery: (id: string, ok: boolean, error: string | null = null, email = false, push = false, o?: CallOpts) =>
      asSystem(pool, async (c) => (await c.query('select * from public.complete_notification_delivery($1,$2,$3,$4,$5)', [id, ok, error, email, push])).rows[0], o),
    setNotifPrefs: (a: Actor | string, p: { email?: boolean | null; push?: boolean | null; muted?: string[] | null }, o?: CallOpts) =>
      one(a, 'select * from public.set_notification_prefs($1,$2,$3)', [p.email ?? null, p.push ?? null, p.muted ?? null], o),
    regPush: (a: Actor | string, endpoint: string, p256dh = 'p'.repeat(87), auth = 'a'.repeat(22), ua: string | null = 'jsdom', o?: CallOpts) =>
      one(a, 'select public.register_push_subscription($1,$2,$3,$4) id', [endpoint, p256dh, auth, ua], o).then((r: any) => r.id as string),
    rmPush: (a: Actor | string, endpoint: string, o?: CallOpts) => one(a, 'select public.remove_push_subscription($1) r', [endpoint], o).then((r: any) => r.r as boolean),
    savePrefs: (userId: string | null, p: { audience?: string | null; tour?: number | null; seen?: number | null }, o?: CallOpts) =>
      one(userId, 'select * from public.save_user_prefs($1,$2,$3)', [p.audience ?? null, p.tour ?? null, p.seen ?? null], o),
    shows: (f: Record<string, unknown> = {}, o?: CallOpts) => asUser(pool, null, async (c) => (await c.query(
      'select * from public.upcoming_shows($1,$2,$3,$4,coalesce($5,20),coalesce($6,0))',
      [f.from ?? null, f.to ?? null, f.neighborhoods ?? null, f.genres ?? null, f.limit ?? null, f.offset ?? null])).rows, { role: 'anon', ...o }),
    beginPay: (a: Actor, id: string, o?: CallOpts) => one(a, 'select * from public.begin_payment($1)', [id], o),
    attachPref: (id: string, pref: string, point: string, o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select * from public.attach_preference($1,$2,$3)', [id, pref, point])).rows[0], o),
    confirmIntent: (id: string, payment: string, amount: number | string, currency = 'ARS', status = 'approved', o?: CallOpts) =>
      asSystem(pool, async (c) => (await c.query('select * from public.confirm_payment_intent($1,$2,$3,$4,$5)', [id, payment, amount, currency, status])).rows[0], o),
    expireIntents: (o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select public.expire_stale_intents() n')).rows[0].n as number, o),
    claimRefunds: (limit = 20, o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select * from public.claim_pending_refunds($1)', [limit])).rows, o),
    completeRefund: (id: string, ok: boolean, mpRefund: string | null = null, err: string | null = null, o?: CallOpts) =>
      asSystem(pool, async (c) => (await c.query('select * from public.complete_refund($1,$2,$3,$4)', [id, ok, mpRefund, err])).rows[0], o),
    setAlias: (a: Actor, alias: string | null, o?: CallOpts) => one(a, 'select public.set_payout_alias($1) r', [alias], o),
    markPaid: (id: string, ref: string, o?: CallOpts) => asSystem(pool, async (c) => (await c.query('select * from public.admin_mark_payout_paid($1,$2)', [id, ref])).rows[0], o),
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
  await pool.query(`truncate public.payouts, public.payment_refunds, public.payment_intents, public.push_subscriptions, public.notification_prefs, public.user_prefs, public.notifications, public.favorites, public.saved_searches, public.profile_requests, public.messages, public.booking_reviews, public.payments, public.booking_events,
    public.bookings, public.listings, public.profiles cascade;
    delete from auth.users; delete from public.venues where id like 't-%' or id like 'sim-%'; delete from public.musicians where id like 't-%' or id like 'sim-%';
    update public.app_settings set venue_fee_bps = 0, musician_fee_bps = 0, max_pending_requests = 20, request_ttl_hours = 48, fund_ttl_hours = 48, review_window_days = 14, require_verification = false, payment_mode = 'simulado', superhost_min_shows = 5, superhost_min_rating = 4.7, superhost_max_cancel_pct = 2, superhost_min_response_pct = 90`);
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

  // 11. Notificaciones: cantidad exacta por evento, solo a participantes, tipos válidos
  const KINDS = ['booking_requested','booking_instant','booking_accepted','booking_rejected','booking_listing_taken','booking_listing_cancelled','booking_funded',
    'booking_cancelled','booking_expired','review_invite','booking_disputed','dispute_resolved','review_pending','message','search_match','profile_approved','profile_rejected','payment_refund','payout_paid'];
  await expectEmpty('11a tipo de notificación desconocido', `select id, kind from notifications where kind <> all('{${KINDS.join(',')}}')`);
  await expectEmpty('11b notificación de reserva a alguien que no participa',
    `select n.id from notifications n join bookings b on b.id = n.booking_id
     where n.user_id not in (select user_id from profiles where venue_id = b.venue_id or musician_id = b.musician_id)`);
  const exp = (await q(`select coalesce(sum(case e.event
      when 'cancelada' then case when e.meta ->> 'by' in ('bar','musico') then 1 else 2 end
      when 'expirada' then 2 when 'realizada' then 2 when 'disputa_resuelta' then 2
      when 'solicitada' then 1 when 'aceptada' then 1 when 'rechazada' then 1 when 'confirmada' then 1 when 'disputa' then 1 when 'resena' then 1 else 0 end), 0)::int n
    from booking_events e`))[0].n;
  const got = (await q(`select count(*)::int n from notifications where booking_id is not null and kind not in ('message','payment_refund','payout_paid')`))[0].n;
  if (exp !== got) bad.push(`11c notificaciones de reservas: esperadas ${exp} según auditoría, hay ${got}`);
  const msgs = (await q(`select (select count(*) from messages)::int m, (select count(*) from notifications where kind = 'message')::int n`))[0];
  if (msgs.m !== msgs.n) bad.push(`11d mensajes ${msgs.m} ≠ notificaciones de mensaje ${msgs.n}`);
  // 12. Topes
  await expectEmpty('12a músico con más solicitudes pendientes que el tope',
    `select musician_id from bookings where status = 'solicitada' group by 1 having count(*) > (select max_pending_requests from app_settings)`);
  await expectEmpty('12b más de 10 búsquedas guardadas', `select user_id from saved_searches group by 1 having count(*) > 10`);
  await expectEmpty('12c más de 500 favoritos', `select user_id from favorites group by 1 having count(*) > 500`);

  // 13. Mercado Pago: una sola aprobación por reserva, dinero de reembolsos y pagos a músicos consistentes
  await expectEmpty('13a más de un pago aprobado para la misma reserva', `select booking_id from payment_intents where status = 'aprobado' group by 1 having count(*) > 1`);
  await expectEmpty('13b pago de Mercado Pago sin intención aprobada del mismo monto',
    `select p.id from payments p where p.provider = 'mercadopago' and not exists
       (select 1 from payment_intents i where i.booking_id = p.booking_id and i.status = 'aprobado' and i.mp_payment_id = p.provider_ref and i.amount_ars = p.charged_ars)`);
  await expectEmpty('13c reembolsos encolados ≠ lo reembolsado en el pago',
    `select p.id from payments p where p.provider = 'mercadopago' and p.status <> 'held'
       and p.refunded_ars <> coalesce((select sum(r.amount) from payment_refunds r where r.mp_payment_id = p.provider_ref and r.reason in ('cancelacion','disputa')), 0)`);
  await expectEmpty('13d pagos a músicos ≠ lo liquidado',
    `select p.id from payments p where p.status <> 'held' and p.payout_ars <> coalesce((select sum(o.amount_ars) from payouts o where o.booking_id = p.booking_id), 0)`);
  await expectEmpty('13e pago a músico sin liquidación', `select o.id from payouts o left join payments p on p.booking_id = o.booking_id where p.id is null or p.status = 'held'`);
  await expectEmpty('13f pago tardío o con discrepancia sin su reembolso',
    `select i.id from payment_intents i where i.status in ('reembolsar','discrepancia') and not exists
       (select 1 from payment_refunds r where r.mp_payment_id = i.mp_payment_id and r.reason in ('pago_tardio','discrepancia'))`);
  await expectEmpty('13g reembolso mayor a lo cobrado',
    `select r.id from payment_refunds r join payments p on p.provider_ref = r.mp_payment_id where r.amount > p.charged_ars`);
  return bad;
}
