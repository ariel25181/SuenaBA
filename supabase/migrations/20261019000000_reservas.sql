-- ==============================================================================
-- SuenaBA - Reservas estilo Airbnb (bares = anfitriones, músicos = huéspedes)
-- Ejecutar DESPUÉS de supabase-schema.sql.
--
-- Flujo:  solicitada -> aceptada -> confirmada (pago retenido) -> realizada
--         + rechazada / cancelada / expirada
-- Toda escritura pasa por funciones RPC (security definer). Los clientes solo
-- pueden LEER (con RLS por participante). Pagos: simulados (provider='simulado');
-- falta integrar Mercado Pago real.
-- ==============================================================================

create extension if not exists btree_gist;

-- ------------------------------------------------------------------------------
-- 0. Endurecimiento: quitar políticas abiertas de escritura del esquema inicial
-- ------------------------------------------------------------------------------
drop policy if exists "Allow insert on open_calls" on public.open_calls;
drop policy if exists "Allow update on open_calls" on public.open_calls;
drop policy if exists "Allow insert on musician_availabilities" on public.musician_availabilities;
drop policy if exists "Allow update on musician_availabilities" on public.musician_availabilities;
drop policy if exists "Allow insert on live_shows" on public.live_shows;
drop policy if exists "Allow update on live_shows" on public.live_shows;
drop policy if exists "Allow insert on reviews" on public.reviews;
drop policy if exists "Allow update on venues" on public.venues;
drop policy if exists "Allow update on musicians" on public.musicians;

-- Línea base de calificaciones (para que las reseñas nuevas se sumen a los datos iniciales)
alter table public.venues    add column if not exists base_rating numeric, add column if not exists base_count integer, add column if not exists base_breakdown jsonb;
alter table public.musicians add column if not exists base_rating numeric, add column if not exists base_count integer, add column if not exists base_breakdown jsonb;
alter table public.venues    alter column base_rating set default 5.0, alter column base_count set default 0;
alter table public.musicians alter column base_rating set default 5.0, alter column base_count set default 0;
update public.venues    set base_rating = rating, base_count = review_count, base_breakdown = rating_breakdown where base_rating is null;
update public.musicians set base_rating = rating, base_count = review_count, base_breakdown = rating_breakdown where base_rating is null;

-- ------------------------------------------------------------------------------
-- 1. Configuración global (comisiones en puntos básicos: 100 bps = 1%). Default 0.
-- ------------------------------------------------------------------------------
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  venue_fee_bps integer not null default 0 check (venue_fee_bps between 0 and 3000),
  musician_fee_bps integer not null default 0 check (musician_fee_bps between 0 and 3000),
  allow_clock_override boolean not null default false,   -- solo para tests
  request_ttl_hours integer not null default 48,
  fund_ttl_hours integer not null default 48,
  review_window_days integer not null default 14,
  max_pending_requests integer not null default 20,
  payment_mode text not null default 'simulado' check (payment_mode in ('simulado','mercadopago')),   -- cómo se cobra
  require_verification boolean not null default false,        -- exigir perfil verificado para publicar/reservar
  superhost_min_shows integer not null default 5,
  superhost_min_rating numeric not null default 4.7,
  superhost_max_cancel_pct numeric not null default 2,
  superhost_min_response_pct numeric not null default 90
);
insert into public.app_settings default values on conflict do nothing;

-- ------------------------------------------------------------------------------
-- 2. Perfiles: vincula un usuario de auth con un bar o un músico.
--    Se crean desde el backend (service role) tras verificar al usuario.
-- ------------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('bar','musico')),
  venue_id text unique references public.venues(id),
  musician_id text unique references public.musicians(id),
  suspended boolean not null default false,
  verified boolean not null default false,
  late_cancellations integer not null default 0,
  created_at timestamptz not null default now(),
  check ((role = 'bar' and venue_id is not null and musician_id is null)
      or (role = 'musico' and musician_id is not null and venue_id is null))
);

-- ------------------------------------------------------------------------------
-- 3. Publicaciones (fechas que ofrece un bar)
-- ------------------------------------------------------------------------------
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  venue_id text not null references public.venues(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cachet_ars bigint not null check (cachet_ars between 0 and 100000000),
  genres text[] not null default '{}',
  backline text[] not null default '{}',
  notes text not null default '' check (char_length(notes) <= 1000),
  booking_mode text not null default 'approval' check (booking_mode in ('instant','approval')),
  cancellation_policy text not null default 'moderada' check (cancellation_policy in ('flexible','moderada','estricta')),
  status text not null default 'abierta' check (status in ('abierta','reservada','cerrada','cancelada')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours'),
  constraint listings_no_overlap exclude using gist
    (venue_id with =, tstzrange(starts_at, ends_at) with &&) where (status <> 'cancelada')
);
create index if not exists listings_open_idx on public.listings (status, starts_at);

-- ------------------------------------------------------------------------------
-- 4. Reservas
-- ------------------------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id),
  venue_id text not null references public.venues(id),
  musician_id text not null references public.musicians(id),
  status text not null default 'solicitada'
    check (status in ('solicitada','aceptada','confirmada','realizada','rechazada','cancelada','expirada')),
  cachet_ars bigint not null check (cachet_ars between 0 and 100000000),
  note text not null default '' check (char_length(note) <= 1000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cancellation_policy text not null,
  respond_by timestamptz not null,
  fund_by timestamptz,
  responded_at timestamptz,
  cancelled_by text check (cancelled_by in ('bar','musico','sistema')),
  cancel_reason text,
  disputed_at timestamptz,
  disputed_by text check (disputed_by in ('bar','musico')),
  dispute_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Una sola reserva activa por publicación
create unique index if not exists bookings_one_active_per_listing
  on public.bookings (listing_id) where status in ('aceptada','confirmada','realizada');
-- Un músico no repite solicitud pendiente para la misma fecha
create unique index if not exists bookings_one_pending_per_musician_listing
  on public.bookings (listing_id, musician_id) where status = 'solicitada';
-- Un músico no puede tener dos shows superpuestos
alter table public.bookings drop constraint if exists bookings_musician_no_overlap;
alter table public.bookings add constraint bookings_musician_no_overlap exclude using gist
  (musician_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('aceptada','confirmada','realizada'));
create index if not exists bookings_venue_idx on public.bookings (venue_id, status);
create index if not exists bookings_musician_idx on public.bookings (musician_id, status);

-- ------------------------------------------------------------------------------
-- 5. Pagos (retención simulada), reseñas, chat y auditoría
-- ------------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id),
  cachet_ars bigint not null,
  venue_fee_bps integer not null,
  musician_fee_bps integer not null,
  venue_fee_ars bigint not null,
  charged_ars bigint not null,
  status text not null default 'held' check (status in ('held','released','refunded','partially_refunded')),
  refunded_ars bigint not null default 0,
  payout_ars bigint not null default 0,
  platform_fee_ars bigint not null default 0,
  provider text not null default 'simulado',
  provider_ref text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (status = 'held' or charged_ars = refunded_ars + payout_ars + platform_fee_ars)
);

create table if not exists public.booking_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  author_role text not null check (author_role in ('bar','musico')),
  author_id text not null,
  target_id text not null,
  rating smallint not null check (rating between 1 and 5),
  breakdown jsonb not null,
  comment text not null default '' check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (booking_id, author_role)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  sender_role text not null check (sender_role in ('bar','musico')),
  sender_user uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_booking_idx on public.messages (booking_id, created_at);

create table if not exists public.booking_events (
  id bigserial primary key,
  booking_id uuid not null references public.bookings(id),
  actor text not null,
  event text not null,
  from_status text,
  to_status text,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default clock_timestamp()
);
create index if not exists booking_events_booking_idx on public.booking_events (booking_id, id);

-- ------------------------------------------------------------------------------
-- 6. RLS: solo lectura para clientes; participantes ven lo suyo
-- ------------------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.booking_reviews enable row level security;
alter table public.messages enable row level security;
alter table public.booking_events enable row level security;

revoke all on public.app_settings, public.profiles, public.listings, public.bookings, public.payments,
  public.booking_reviews, public.messages, public.booking_events from anon, authenticated;
revoke all on public.venues, public.musicians, public.open_calls, public.musician_availabilities,
  public.live_shows, public.reviews from anon, authenticated;
grant select on public.venues, public.musicians, public.open_calls, public.musician_availabilities,
  public.live_shows, public.reviews to anon, authenticated;
grant select (venue_fee_bps, musician_fee_bps, payment_mode) on public.app_settings to anon, authenticated;
grant select on public.listings, public.booking_reviews to anon, authenticated;
grant select on public.profiles, public.bookings, public.payments, public.messages, public.booking_events to authenticated;

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to anon, authenticated using (true);
drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select to anon, authenticated using (status <> 'cancelada');
drop policy if exists bookings_participant on public.bookings;
create policy bookings_participant on public.bookings for select to authenticated using (
  exists (select 1 from public.profiles pr where pr.user_id = auth.uid()
          and (pr.venue_id = bookings.venue_id or pr.musician_id = bookings.musician_id)));
drop policy if exists payments_participant on public.payments;
create policy payments_participant on public.payments for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = payments.booking_id));
drop policy if exists messages_participant on public.messages;
create policy messages_participant on public.messages for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = messages.booking_id));
drop policy if exists events_participant on public.booking_events;
create policy events_participant on public.booking_events for select to authenticated using (
  exists (select 1 from public.bookings b where b.id = booking_events.booking_id));
drop policy if exists reviews_visible on public.booking_reviews;
drop policy if exists reviews_published on public.booking_reviews;
drop policy if exists reviews_own on public.booking_reviews;
-- Cualquiera (incluso sin sesión) ve las reseñas ya publicadas
create policy reviews_published on public.booking_reviews for select to anon, authenticated using (published_at is not null);
-- El autor ve además la suya aunque todavía no esté publicada
create policy reviews_own on public.booking_reviews for select to authenticated using (
  exists (select 1 from public.profiles pr where pr.user_id = auth.uid()
          and ((booking_reviews.author_role = 'bar' and pr.venue_id = booking_reviews.author_id)
            or (booking_reviews.author_role = 'musico' and pr.musician_id = booking_reviews.author_id))));

-- ------------------------------------------------------------------------------
-- 7. Funciones puras (fuente única de las reglas de dinero)
-- ------------------------------------------------------------------------------
create or replace function public.calc_fee(p_amount bigint, p_bps integer) returns bigint
language sql immutable as $$ select (p_amount * p_bps) / 10000 $$;

-- % de reembolso al cancelar el bar, según política y horas de anticipación
create or replace function public.refund_pct(p_policy text, p_hours_before numeric) returns integer
language sql immutable as $$
  select case p_policy
    when 'flexible' then case when p_hours_before >= 24 then 100 else 50 end
    when 'moderada' then case when p_hours_before >= 72 then 100 when p_hours_before >= 24 then 50 else 0 end
    when 'estricta' then case when p_hours_before >= 168 then 100 when p_hours_before >= 72 then 50 else 0 end
    else 0 end
$$;

-- Reparto del dinero: reembolso al bar + pago al músico + ganancia de la plataforma = cobrado
create or replace function public.settle_amounts(p_cachet bigint, p_venue_fee bigint, p_musician_bps integer, p_pct integer)
returns table (refunded bigint, payout bigint, platform_fee bigint)
language sql immutable as $$
  with x as (select (p_cachet * p_pct) / 100 as rc, (p_venue_fee * p_pct) / 100 as rf)
  select x.rc + x.rf,
         (p_cachet - x.rc) - public.calc_fee(p_cachet - x.rc, p_musician_bps),
         (p_venue_fee - x.rf) + public.calc_fee(p_cachet - x.rc, p_musician_bps)
  from x
$$;

-- ------------------------------------------------------------------------------
-- 8. Helpers internos
-- ------------------------------------------------------------------------------
create or replace function public.app_now() returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select case when s.allow_clock_override and nullif(current_setting('app.now', true), '') is not null
              then current_setting('app.now')::timestamptz else now() end
  from public.app_settings s limit 1
$$;

create or replace function public.current_profile() returns public.profiles
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.profiles;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into p from public.profiles where user_id = auth.uid();
  if not found then raise exception 'no_profile' using errcode = 'P0001'; end if;
  if p.suspended then raise exception 'suspended' using errcode = 'P0001'; end if;
  return p;
end $$;

create or replace function public._log(p_booking uuid, p_event text, p_from text, p_to text, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.booking_events (booking_id, actor, event, from_status, to_status, meta)
  values (p_booking, coalesce(auth.uid()::text, 'sistema'), p_event, p_from, p_to, p_meta)
$$;

-- Bloquea primero la publicación y luego la reserva (orden fijo: evita deadlocks).
-- Usa FOR NO KEY UPDATE para no chocar con los chequeos de claves foráneas (mensajes, notificaciones, reseñas).
create or replace function public._lock_booking(p_id uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare lid uuid; b public.bookings;
begin
  select listing_id into lid from public.bookings where id = p_id;
  if not found then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  perform 1 from public.listings where id = lid for no key update;
  select * into b from public.bookings where id = p_id for no key update;
  return b;
end $$;

create or replace function public._role_in(p public.profiles, b public.bookings) returns text
language sql immutable as $$
  select case when p.venue_id is not null and p.venue_id = b.venue_id then 'bar'
              when p.musician_id is not null and p.musician_id = b.musician_id then 'musico' end
$$;

-- Reabre la publicación si todavía queda tiempo; si no, la cierra
create or replace function public._reopen_listing(p_listing uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.listings set status = case when starts_at > public.app_now() + interval '2 hours' then 'abierta' else 'cerrada' end
  where id = p_listing and status = 'reservada';
end $$;

create or replace function public._accept(b public.bookings) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.app_settings; l public.listings; r public.bookings; rid uuid;
begin
  -- Mismo motivo: dos aceptaciones simultáneas del mismo músico en horarios que se pisan chocan en la restricción de exclusión.
  perform pg_advisory_xact_lock(hashtextextended('mus:' || b.musician_id, 0));
  select * into s from public.app_settings;
  select * into l from public.listings where id = b.listing_id;
  update public.listings set status = 'reservada' where id = l.id;
  begin
    update public.bookings set status = 'aceptada', updated_at = public.app_now(), responded_at = coalesce(responded_at, public.app_now()),
      fund_by = least(public.app_now() + make_interval(hours => s.fund_ttl_hours), l.starts_at - interval '1 hour')
    where id = b.id returning * into r;
  exception when exclusion_violation then
    raise exception 'musician_busy' using errcode = 'P0001';
  end;
  perform public._log(b.id, 'aceptada', b.status, 'aceptada');
  -- las demás solicitudes de la misma fecha quedan rechazadas
  for rid in
    with rej as (
      update public.bookings set status = 'rechazada', cancelled_by = 'sistema', cancel_reason = 'listing_taken', updated_at = public.app_now()
      where listing_id = l.id and status = 'solicitada' and id <> b.id returning id)
    select id from rej
  loop
    perform public._log(rid, 'rechazada', 'solicitada', 'rechazada', '{"reason":"listing_taken"}');
  end loop;
  return r;
end $$;

create or replace function public._expire(b public.bookings) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.bookings;
begin
  update public.bookings set status = 'expirada', cancelled_by = 'sistema', cancel_reason = 'timeout', updated_at = public.app_now()
  where id = b.id returning * into r;
  perform public._log(b.id, 'expirada', b.status, 'expirada');
  if b.status = 'aceptada' then perform public._reopen_listing(b.listing_id); end if;
  return r;
end $$;

-- Liquida el pago de una reserva: p_pct = % de reembolso al bar (0 = se paga todo al músico)
-- Gancho posterior a la liquidación (reembolsos reales y pagos a músicos). Lo redefine la migración de Mercado Pago.
create or replace function public._after_settle(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin null; end $$;

create or replace function public._settle(b public.bookings, p_pct integer, p_reason text default 'cancelacion') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pay public.payments; a record;
begin
  select * into pay from public.payments where booking_id = b.id for no key update;
  if not found then raise exception 'payment_missing' using errcode = 'P0001'; end if;
  if pay.status <> 'held' then raise exception 'payment_already_settled' using errcode = 'P0001'; end if;
  select * into a from public.settle_amounts(pay.cachet_ars, pay.venue_fee_ars, pay.musician_fee_bps, p_pct);
  update public.payments set refunded_ars = a.refunded, payout_ars = a.payout, platform_fee_ars = a.platform_fee,
    status = case when p_pct = 0 then 'released' when a.refunded = pay.charged_ars then 'refunded' else 'partially_refunded' end,
    settled_at = public.app_now()
  where id = pay.id;
  perform public._after_settle(pay.id, p_reason);
end $$;

create or replace function public._complete(b public.bookings) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.bookings;
begin
  perform public._settle(b, 0);
  update public.bookings set status = 'realizada', updated_at = public.app_now() where id = b.id returning * into r;
  perform public._log(b.id, 'realizada', b.status, 'realizada');
  return r;
end $$;

create or replace function public._recompute_rating(p_kind text, p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; sm numeric; keys text[]; k text; bd jsonb := '{}'; base jsonb; bc integer; br numeric; ksum numeric;
begin
  if p_kind = 'venue' then
    perform 1 from public.venues where id = p_id for no key update;
    select base_rating, base_count, base_breakdown into br, bc, base from public.venues where id = p_id;
    keys := array['soundQuality','paymentReliability','hospitality','respect'];
    select count(*), coalesce(sum(rating), 0) into n, sm from public.booking_reviews
      where author_role = 'musico' and target_id = p_id and published_at is not null;
  else
    perform 1 from public.musicians where id = p_id for no key update;
    select base_rating, base_count, base_breakdown into br, bc, base from public.musicians where id = p_id;
    keys := array['punctuality','liveSound','crowdDrawing','professionalism'];
    select count(*), coalesce(sum(rating), 0) into n, sm from public.booking_reviews
      where author_role = 'bar' and target_id = p_id and published_at is not null;
  end if;
  foreach k in array keys loop
    select coalesce(sum((breakdown ->> k)::numeric), 0) into ksum from public.booking_reviews
      where target_id = p_id and published_at is not null and author_role = case when p_kind = 'venue' then 'musico' else 'bar' end;
    bd := bd || jsonb_build_object(k, round((coalesce((base ->> k)::numeric, br) * bc + ksum) / (bc + n), 2));
  end loop;
  if p_kind = 'venue' then
    update public.venues set rating = round((br * bc + sm) / (bc + n), 2), review_count = bc + n, rating_breakdown = bd where id = p_id;
  else
    update public.musicians set rating = round((br * bc + sm) / (bc + n), 2), review_count = bc + n, rating_breakdown = bd where id = p_id;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 9. API para clientes (RPC)
-- ------------------------------------------------------------------------------
create or replace function public.create_listing(
  p_starts_at timestamptz, p_ends_at timestamptz, p_cachet_ars bigint,
  p_genres text[] default '{}', p_backline text[] default '{}', p_notes text default '',
  p_booking_mode text default 'approval', p_policy text default 'moderada')
returns public.listings language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; l public.listings;
begin
  p := public.current_profile();
  if p.role <> 'bar' then raise exception 'forbidden_role' using errcode = 'P0001'; end if;
  if (select require_verification from public.app_settings) and not p.verified then raise exception 'not_verified' using errcode = 'P0001'; end if;
  if p_starts_at is null or p_ends_at is null or p_cachet_ars is null then raise exception 'invalid_listing' using errcode = 'P0001'; end if;
  if p_starts_at <= public.app_now() + interval '2 hours' then raise exception 'starts_too_soon' using errcode = 'P0001'; end if;
  if p_starts_at > public.app_now() + interval '1 year' then raise exception 'starts_too_far' using errcode = 'P0001'; end if;
  -- Serializa las publicaciones de un mismo bar: sin esto, dos fechas superpuestas insertadas a la vez se esperan mutuamente (deadlock)
  -- en la restricción de exclusión en vez de devolver 'listing_overlap'.
  perform pg_advisory_xact_lock(hashtextextended('venue:' || p.venue_id, 0));
  begin
    insert into public.listings (venue_id, starts_at, ends_at, cachet_ars, genres, backline, notes, booking_mode, cancellation_policy)
    values (p.venue_id, p_starts_at, p_ends_at, p_cachet_ars, coalesce(p_genres, '{}'), coalesce(p_backline, '{}'),
            coalesce(p_notes, ''), p_booking_mode, p_policy)
    returning * into l;
  exception
    when exclusion_violation then raise exception 'listing_overlap' using errcode = 'P0001';
    when check_violation then raise exception 'invalid_listing' using errcode = 'P0001';
  end;
  return l;
end $$;

create or replace function public.cancel_listing(p_listing_id uuid) returns public.listings
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; l public.listings; rid uuid;
begin
  p := public.current_profile();
  select * into l from public.listings where id = p_listing_id for no key update;
  if not found or p.venue_id is distinct from l.venue_id then raise exception 'listing_not_found' using errcode = 'P0001'; end if;
  if l.status = 'cancelada' then return l; end if;
  if l.status = 'reservada' then raise exception 'listing_has_booking' using errcode = 'P0001'; end if;
  for rid in
    with rej as (
      update public.bookings set status = 'rechazada', cancelled_by = 'bar', cancel_reason = 'listing_cancelled', updated_at = public.app_now()
      where listing_id = l.id and status = 'solicitada' returning id)
    select id from rej
  loop
    perform public._log(rid, 'rechazada', 'solicitada', 'rechazada', '{"reason":"listing_cancelled"}');
  end loop;
  update public.listings set status = 'cancelada' where id = l.id returning * into l;
  return l;
end $$;

create or replace function public.request_booking(p_listing_id uuid, p_proposed_cachet bigint default null, p_note text default '')
returns public.bookings language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; l public.listings; s public.app_settings; b public.bookings; c bigint;
begin
  p := public.current_profile();
  if p.role <> 'musico' then raise exception 'forbidden_role' using errcode = 'P0001'; end if;
  select * into s from public.app_settings;
  if s.require_verification and not p.verified then raise exception 'not_verified' using errcode = 'P0001'; end if;
  -- serializa las solicitudes de un mismo músico para que el tope de pendientes no se pueda saltear en paralelo
  perform pg_advisory_xact_lock(hashtextextended('req:' || p.musician_id, 0));
  select * into l from public.listings where id = p_listing_id for no key update;
  if not found or l.status = 'cancelada' then raise exception 'listing_not_found' using errcode = 'P0001'; end if;
  if l.status <> 'abierta' then raise exception 'listing_not_open' using errcode = 'P0001'; end if;
  if l.starts_at <= public.app_now() + interval '2 hours' then raise exception 'listing_too_soon' using errcode = 'P0001'; end if;
  c := coalesce(p_proposed_cachet, l.cachet_ars);
  if c < 0 or c > 100000000 then raise exception 'invalid_cachet' using errcode = 'P0001'; end if;
  if l.booking_mode = 'instant' and c <> l.cachet_ars then raise exception 'instant_requires_listed_cachet' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'note_too_long' using errcode = 'P0001'; end if;
  if exists (select 1 from public.bookings x where x.listing_id = l.id and x.musician_id = p.musician_id and x.status = 'solicitada') then
    raise exception 'already_requested' using errcode = 'P0001'; end if;
  if exists (select 1 from public.bookings x where x.musician_id = p.musician_id
             and x.status in ('aceptada','confirmada','realizada') and tstzrange(x.starts_at, x.ends_at) && tstzrange(l.starts_at, l.ends_at)) then
    raise exception 'musician_busy' using errcode = 'P0001'; end if;
  if (select count(*) from public.bookings x where x.musician_id = p.musician_id and x.status = 'solicitada') >= s.max_pending_requests then
    raise exception 'too_many_requests' using errcode = 'P0001'; end if;
  insert into public.bookings (listing_id, venue_id, musician_id, cachet_ars, note, starts_at, ends_at, cancellation_policy, respond_by, created_at, updated_at)
  values (l.id, l.venue_id, p.musician_id, c, coalesce(p_note, ''), l.starts_at, l.ends_at, l.cancellation_policy,
          least(public.app_now() + make_interval(hours => s.request_ttl_hours), l.starts_at - interval '1 hour'),
          public.app_now(), public.app_now())
  returning * into b;
  perform public._log(b.id, 'solicitada', null, 'solicitada', jsonb_build_object('mode', l.booking_mode));
  if l.booking_mode = 'instant' then b := public._accept(b); end if;
  return b;
end $$;

create or replace function public.respond_booking(p_booking_id uuid, p_accept boolean, p_reason text default '')
returns public.bookings language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings; l public.listings;
begin
  p := public.current_profile();
  b := public._lock_booking(p_booking_id);
  if p.venue_id is distinct from b.venue_id then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status <> 'solicitada' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if public.app_now() > b.respond_by then return public._expire(b); end if;
  select * into l from public.listings where id = b.listing_id;
  if not p_accept then
    update public.bookings set status = 'rechazada', cancelled_by = 'bar', cancel_reason = left(coalesce(p_reason, ''), 500), updated_at = public.app_now(), responded_at = public.app_now()
    where id = b.id returning * into b;
    perform public._log(b.id, 'rechazada', 'solicitada', 'rechazada');
    return b;
  end if;
  if l.status <> 'abierta' then raise exception 'listing_not_open' using errcode = 'P0001'; end if;
  return public._accept(b);
end $$;

-- Cobro confirmado: guarda la retención y confirma la reserva. Lo usan el pago simulado y Mercado Pago (una sola regla de dinero).
create or replace function public._fund_booking(b public.bookings, p_provider text, p_ref text, p_venue_bps integer, p_musician_bps integer)
returns public.bookings language plpgsql security definer set search_path = public, pg_temp as $$
declare vfee bigint; r public.bookings;
begin
  vfee := public.calc_fee(b.cachet_ars, p_venue_bps);
  insert into public.payments (booking_id, cachet_ars, venue_fee_bps, musician_fee_bps, venue_fee_ars, charged_ars, provider, provider_ref, created_at)
  values (b.id, b.cachet_ars, p_venue_bps, p_musician_bps, vfee, b.cachet_ars + vfee, p_provider, p_ref, public.app_now());
  update public.bookings set status = 'confirmada', updated_at = public.app_now() where id = b.id returning * into r;
  perform public._log(b.id, 'confirmada', 'aceptada', 'confirmada', jsonb_build_object('charged', b.cachet_ars + vfee, 'provider', p_provider));
  return r;
end $$;

-- El bar "paga" (modo simulado): el dinero queda retenido hasta que el show se realiza. Idempotente.
-- Con payment_mode = 'mercadopago' el cobro real pasa por begin_payment + el webhook, nunca por acá.
create or replace function public.fund_booking(p_booking_id uuid, p_provider_ref text default null)
returns public.bookings language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings; s public.app_settings;
begin
  p := public.current_profile();
  b := public._lock_booking(p_booking_id);
  if p.venue_id is distinct from b.venue_id then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status = 'confirmada' then return b; end if;
  if b.status <> 'aceptada' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  select * into s from public.app_settings;
  if s.payment_mode <> 'simulado' then raise exception 'payment_required' using errcode = 'P0001'; end if;
  if public.app_now() > b.fund_by or public.app_now() >= b.starts_at then return public._expire(b); end if;
  return public._fund_booking(b, 'simulado', p_provider_ref, s.venue_fee_bps, s.musician_fee_bps);
end $$;

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default '')
returns public.bookings language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings; role text; hrs numeric; pct integer := 0; late boolean := false; prev text;
begin
  p := public.current_profile();
  b := public._lock_booking(p_booking_id);
  role := public._role_in(p, b);
  if role is null then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status not in ('solicitada','aceptada','confirmada') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  prev := b.status;
  if b.status = 'confirmada' then
    if public.app_now() >= b.starts_at then raise exception 'show_already_started' using errcode = 'P0001'; end if;
    hrs := extract(epoch from (b.starts_at - public.app_now())) / 3600;
    if role = 'musico' then
      pct := 100;
      late := hrs < 24;
      if late then update public.profiles set late_cancellations = late_cancellations + 1 where user_id = p.user_id; end if;
    else
      pct := public.refund_pct(b.cancellation_policy, hrs);
    end if;
    perform public._settle(b, pct);
  end if;
  update public.bookings set status = 'cancelada', cancelled_by = role, cancel_reason = left(coalesce(p_reason, ''), 500), updated_at = public.app_now()
  where id = b.id returning * into b;
  perform public._log(b.id, 'cancelada', prev, 'cancelada',
                      jsonb_build_object('by', role, 'refund_pct', pct, 'late', late));
  if (select status from public.listings where id = b.listing_id) = 'reservada' then perform public._reopen_listing(b.listing_id); end if;
  return b;
end $$;

create or replace function public.complete_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings;
begin
  p := public.current_profile();
  b := public._lock_booking(p_booking_id);
  if public._role_in(p, b) is null then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status = 'realizada' then return b; end if;
  if b.status <> 'confirmada' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if b.disputed_at is not null then raise exception 'booking_disputed' using errcode = 'P0001'; end if;
  if public.app_now() < b.ends_at then raise exception 'show_not_finished' using errcode = 'P0001'; end if;
  return public._complete(b);
end $$;

create or replace function public.report_problem(p_booking_id uuid, p_reason text) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings; role text;
begin
  p := public.current_profile();
  b := public._lock_booking(p_booking_id);
  role := public._role_in(p, b);
  if role is null then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status <> 'confirmada' or public.app_now() < b.starts_at then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if b.disputed_at is not null then return b; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then raise exception 'invalid_reason' using errcode = 'P0001'; end if;
  update public.bookings set disputed_at = public.app_now(), disputed_by = role, dispute_reason = btrim(p_reason), updated_at = public.app_now()
  where id = b.id returning * into b;
  perform public._log(b.id, 'disputa', 'confirmada', 'confirmada', jsonb_build_object('by', role));
  return b;
end $$;

create or replace function public.submit_review(p_booking_id uuid, p_rating integer, p_breakdown jsonb, p_comment text default '')
returns public.booking_reviews language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings; role text; s public.app_settings; r public.booking_reviews;
        keys text[]; k text; v numeric;
begin
  p := public.current_profile();
  b := public._lock_booking(p_booking_id);
  role := public._role_in(p, b);
  if role is null then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status <> 'realizada' then raise exception 'booking_not_completed' using errcode = 'P0001'; end if;
  select * into s from public.app_settings;
  if public.app_now() > b.ends_at + make_interval(days => s.review_window_days) then raise exception 'review_window_closed' using errcode = 'P0001'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_comment, '')) > 1000 then raise exception 'comment_too_long' using errcode = 'P0001'; end if;
  keys := case when role = 'bar' then array['punctuality','liveSound','crowdDrawing','professionalism']
                                 else array['soundQuality','paymentReliability','hospitality','respect'] end;
  if p_breakdown is null or jsonb_typeof(p_breakdown) <> 'object' then raise exception 'invalid_breakdown' using errcode = 'P0001'; end if;
  foreach k in array keys loop
    begin v := (p_breakdown ->> k)::numeric; exception when others then v := null; end;
    if v is null or v < 1 or v > 5 then raise exception 'invalid_breakdown' using errcode = 'P0001'; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_breakdown)) <> array_length(keys, 1) then raise exception 'invalid_breakdown' using errcode = 'P0001'; end if;
  begin
    insert into public.booking_reviews (booking_id, author_role, author_id, target_id, rating, breakdown, comment, created_at)
    values (b.id, role, case when role = 'bar' then b.venue_id else b.musician_id end,
            case when role = 'bar' then b.musician_id else b.venue_id end,
            p_rating, p_breakdown, coalesce(p_comment, ''), public.app_now())
    returning * into r;
  exception when unique_violation then raise exception 'already_reviewed' using errcode = 'P0001';
  end;
  if (select count(*) from public.booking_reviews where booking_id = b.id) = 2 then
    update public.booking_reviews set published_at = public.app_now() where booking_id = b.id and published_at is null;
    perform public._recompute_rating('venue', b.venue_id);
    perform public._recompute_rating('musician', b.musician_id);
    select * into r from public.booking_reviews where id = r.id;
  end if;
  perform public._log(b.id, 'resena', 'realizada', 'realizada', jsonb_build_object('by', role));
  return r;
end $$;

create or replace function public.send_message(p_booking_id uuid, p_body text) returns public.messages
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings; role text; m public.messages; body text := btrim(coalesce(p_body, ''));
begin
  p := public.current_profile();
  select * into b from public.bookings where id = p_booking_id;
  if not found then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  role := public._role_in(p, b);
  if role is null then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status in ('rechazada','expirada') then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if char_length(body) = 0 then raise exception 'empty_message' using errcode = 'P0001'; end if;
  if char_length(body) > 2000 then raise exception 'message_too_long' using errcode = 'P0001'; end if;
  if (select count(*) from public.messages where booking_id = b.id) >= 500 then raise exception 'message_limit' using errcode = 'P0001'; end if;
  insert into public.messages (booking_id, sender_role, sender_user, body, created_at)
  values (b.id, role, p.user_id, body, public.app_now()) returning * into m;
  return m;
end $$;

-- ------------------------------------------------------------------------------
-- 10. Tareas del sistema (cron / service role): vencimientos, cierre, publicación
-- ------------------------------------------------------------------------------
create or replace function public.expire_stale_bookings() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; b public.bookings; n integer := 0;
begin
  for r in select id from public.bookings
           where (status = 'solicitada' and respond_by < public.app_now())
              or (status = 'aceptada' and (fund_by < public.app_now() or starts_at <= public.app_now()))
           order by id loop
    b := public._lock_booking(r.id);
    if (b.status = 'solicitada' and b.respond_by < public.app_now())
       or (b.status = 'aceptada' and (b.fund_by < public.app_now() or b.starts_at <= public.app_now())) then
      perform public._expire(b); n := n + 1;
    end if;
  end loop;
  update public.listings set status = 'cerrada' where status = 'abierta' and starts_at <= public.app_now();
  return n;
end $$;

create or replace function public.complete_due_bookings() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; b public.bookings; n integer := 0;
begin
  for r in select id from public.bookings where status = 'confirmada' and ends_at <= public.app_now() and disputed_at is null order by id loop
    b := public._lock_booking(r.id);
    if b.status = 'confirmada' and b.ends_at <= public.app_now() and b.disputed_at is null then
      perform public._complete(b); n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.publish_due_reviews() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n integer := 0; s public.app_settings;
begin
  select * into s from public.app_settings;
  for r in select distinct br.target_id, br.author_role from public.booking_reviews br
           join public.bookings b on b.id = br.booking_id
           where br.published_at is null and b.ends_at + make_interval(days => s.review_window_days) < public.app_now()
           order by 2, 1 loop
    update public.booking_reviews br set published_at = public.app_now()
      from public.bookings b
      where b.id = br.booking_id and br.published_at is null and br.target_id = r.target_id and br.author_role = r.author_role
        and b.ends_at + make_interval(days => s.review_window_days) < public.app_now();
    perform public._recompute_rating(case when r.author_role = 'musico' then 'venue' else 'musician' end, r.target_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Disputa: el equipo resuelve con un % de reembolso al bar (solo service role)
create or replace function public.admin_resolve_dispute(p_booking_id uuid, p_refund_pct integer) returns public.bookings
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings;
begin
  if p_refund_pct is null or p_refund_pct not between 0 and 100 then raise exception 'invalid_pct' using errcode = 'P0001'; end if;
  b := public._lock_booking(p_booking_id);
  if b.status <> 'confirmada' or b.disputed_at is null then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  perform public._settle(b, p_refund_pct, 'disputa');
  update public.bookings set status = case when p_refund_pct = 100 then 'cancelada' else 'realizada' end,
    cancelled_by = case when p_refund_pct = 100 then 'sistema' else cancelled_by end,
    cancel_reason = case when p_refund_pct = 100 then 'dispute_refund' else cancel_reason end,
    updated_at = public.app_now()
  where id = b.id returning * into b;
  perform public._log(b.id, 'disputa_resuelta', 'confirmada', b.status, jsonb_build_object('refund_pct', p_refund_pct));
  if b.status = 'cancelada' then perform public._reopen_listing(b.listing_id); end if;
  return b;
end $$;

-- ------------------------------------------------------------------------------
-- 11. Permisos de ejecución
-- ------------------------------------------------------------------------------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'current_profile','_log','_lock_booking','_role_in','_reopen_listing','_accept','_expire','_settle','_fund_booking','_after_settle',
             '_complete','_recompute_rating','expire_stale_bookings','complete_due_bookings','publish_due_reviews',
             'admin_resolve_dispute','create_listing','cancel_listing','request_booking','respond_booking',
             'fund_booking','cancel_booking','complete_booking','report_problem','submit_review','send_message')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public.create_listing(timestamptz, timestamptz, bigint, text[], text[], text, text, text) to authenticated;
grant execute on function public.cancel_listing(uuid) to authenticated;
grant execute on function public.request_booking(uuid, bigint, text) to authenticated;
grant execute on function public.respond_booking(uuid, boolean, text) to authenticated;
grant execute on function public.fund_booking(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.complete_booking(uuid) to authenticated;
grant execute on function public.report_problem(uuid, text) to authenticated;
grant execute on function public.submit_review(uuid, integer, jsonb, text) to authenticated;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.calc_fee(bigint, integer), public.refund_pct(text, numeric),
  public.settle_amounts(bigint, bigint, integer, integer) to anon, authenticated;
