-- ==============================================================================
-- SuenaBA - Extras estilo Airbnb: favoritos, notificaciones, búsqueda con filtros,
-- alertas de búsqueda, insignias (Superanfitrión), verificación y ganancias.
-- Ejecutar DESPUÉS de 20261019000000_reservas.sql.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Favoritos
-- ------------------------------------------------------------------------------
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('listing','venue','musician')),
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target_id)
);

-- ------------------------------------------------------------------------------
-- 2. Notificaciones (bandeja interna; delivered_at sirve de cola para push/email)
-- ------------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  booking_id uuid references public.bookings(id),
  listing_id uuid references public.listings(id),
  title text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  delivered_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_undelivered_idx on public.notifications (created_at) where delivered_at is null;

-- ------------------------------------------------------------------------------
-- 3. Búsquedas guardadas (alertas)
-- ------------------------------------------------------------------------------
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  filters jsonb not null,
  created_at timestamptz not null default now(),
  last_notified_at timestamptz
);

-- ------------------------------------------------------------------------------
-- 4. Solicitudes de alta de perfil (verificación)
-- ------------------------------------------------------------------------------
create table if not exists public.profile_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('bar','musico')),
  display_name text not null check (char_length(display_name) between 2 and 80),
  neighborhood text,
  address text,
  bio text not null default '' check (char_length(bio) <= 1000),
  evidence_url text,
  status text not null default 'pendiente' check (status in ('pendiente','aprobada','rechazada')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index if not exists profile_requests_one_pending on public.profile_requests (user_id) where status = 'pendiente';

-- RLS: cada usuario ve solo lo suyo; escritura solo por RPC
alter table public.favorites enable row level security;
alter table public.notifications enable row level security;
alter table public.saved_searches enable row level security;
alter table public.profile_requests enable row level security;
revoke all on public.favorites, public.notifications, public.saved_searches, public.profile_requests from anon, authenticated;
grant select on public.favorites, public.notifications, public.saved_searches, public.profile_requests to authenticated;
drop policy if exists fav_own on public.favorites;
create policy fav_own on public.favorites for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_own on public.notifications;
create policy notif_own on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists ss_own on public.saved_searches;
create policy ss_own on public.saved_searches for select to authenticated using (user_id = auth.uid());
drop policy if exists pr_own on public.profile_requests;
create policy pr_own on public.profile_requests for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 5. Notificaciones automáticas desde la auditoría de reservas
-- ------------------------------------------------------------------------------
create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text, p_booking uuid default null, p_listing uuid default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notifications (user_id, kind, booking_id, listing_id, title, body, created_at)
  select p_user, p_kind, p_booking, p_listing, p_title, left(coalesce(p_body, ''), 300), public.app_now()
  where p_user is not null
$$;

create or replace function public._notify_event(p_booking uuid, p_event text, p_meta jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; bar_u uuid; mus_u uuid; bar_name text; mus_name text; by_role text := p_meta ->> 'by'; reason text := p_meta ->> 'reason';
        day text;
begin
  select * into b from public.bookings where id = p_booking;
  select user_id into bar_u from public.profiles where venue_id = b.venue_id;
  select user_id into mus_u from public.profiles where musician_id = b.musician_id;
  select name into bar_name from public.venues where id = b.venue_id;
  select stage_name into mus_name from public.musicians where id = b.musician_id;
  day := to_char(b.starts_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI');
  case p_event
    when 'solicitada' then
      if p_meta ->> 'mode' = 'instant' then
        perform public._notify(bar_u, 'booking_instant', 'Reserva instantánea', mus_name || ' reservó tu fecha del ' || day, b.id, b.listing_id);
      else
        perform public._notify(bar_u, 'booking_requested', 'Nueva solicitud', mus_name || ' quiere tocar el ' || day, b.id, b.listing_id);
      end if;
    when 'aceptada' then
      perform public._notify(mus_u, 'booking_accepted', '¡Te aceptaron!', bar_name || ' aceptó tu solicitud del ' || day || '. Falta que paguen para confirmar.', b.id, b.listing_id);
    when 'rechazada' then
      perform public._notify(mus_u,
        case reason when 'listing_taken' then 'booking_listing_taken' when 'listing_cancelled' then 'booking_listing_cancelled' else 'booking_rejected' end,
        case reason when 'listing_taken' then 'La fecha ya se ocupó' when 'listing_cancelled' then 'Fecha cancelada' else 'Solicitud rechazada' end,
        bar_name || ' · ' || day, b.id, b.listing_id);
    when 'confirmada' then
      perform public._notify(mus_u, 'booking_funded', 'Fecha confirmada', bar_name || ' pagó: tu show del ' || day || ' está confirmado.', b.id, b.listing_id);
    when 'cancelada' then
      if by_role = 'bar' then perform public._notify(mus_u, 'booking_cancelled', 'Reserva cancelada', bar_name || ' canceló el show del ' || day, b.id, b.listing_id);
      elsif by_role = 'musico' then perform public._notify(bar_u, 'booking_cancelled', 'Reserva cancelada', mus_name || ' canceló el show del ' || day, b.id, b.listing_id);
      else
        perform public._notify(bar_u, 'booking_cancelled', 'Reserva cancelada', 'El show del ' || day || ' fue cancelado', b.id, b.listing_id);
        perform public._notify(mus_u, 'booking_cancelled', 'Reserva cancelada', 'El show del ' || day || ' fue cancelado', b.id, b.listing_id);
      end if;
    when 'expirada' then
      perform public._notify(bar_u, 'booking_expired', 'Reserva vencida', mus_name || ' · ' || day, b.id, b.listing_id);
      perform public._notify(mus_u, 'booking_expired', 'Reserva vencida', bar_name || ' · ' || day, b.id, b.listing_id);
    when 'realizada' then
      perform public._notify(bar_u, 'review_invite', 'Dejá tu reseña', '¿Cómo fue el show con ' || mus_name || '?', b.id, b.listing_id);
      perform public._notify(mus_u, 'review_invite', 'Dejá tu reseña', '¿Cómo fue tocar en ' || bar_name || '?', b.id, b.listing_id);
    when 'disputa' then
      perform public._notify(case when by_role = 'bar' then mus_u else bar_u end, 'booking_disputed', 'Problema reportado', 'Reportaron un problema en el show del ' || day || '. El pago queda en revisión.', b.id, b.listing_id);
    when 'disputa_resuelta' then
      perform public._notify(bar_u, 'dispute_resolved', 'Disputa resuelta', 'El equipo resolvió el problema del show del ' || day, b.id, b.listing_id);
      perform public._notify(mus_u, 'dispute_resolved', 'Disputa resuelta', 'El equipo resolvió el problema del show del ' || day, b.id, b.listing_id);
    when 'resena' then
      perform public._notify(case when by_role = 'bar' then mus_u else bar_u end, 'review_pending', 'Tu contraparte ya reseñó', 'Dejá tu reseña para que se publiquen ambas.', b.id, b.listing_id);
    else null;
  end case;
end $$;

create or replace function public._log(p_booking uuid, p_event text, p_from text, p_to text, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.booking_events (booking_id, actor, event, from_status, to_status, meta)
  values (p_booking, coalesce(auth.uid()::text, 'sistema'), p_event, p_from, p_to, p_meta);
  perform public._notify_event(p_booking, p_event, p_meta);
end $$;

-- Mensajes nuevos avisan a la contraparte
create or replace function public._trg_notify_message() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings; to_user uuid; from_name text;
begin
  select * into b from public.bookings where id = new.booking_id;
  if new.sender_role = 'bar' then
    select user_id into to_user from public.profiles where musician_id = b.musician_id;
    select name into from_name from public.venues where id = b.venue_id;
  else
    select user_id into to_user from public.profiles where venue_id = b.venue_id;
    select stage_name into from_name from public.musicians where id = b.musician_id;
  end if;
  perform public._notify(to_user, 'message', 'Mensaje de ' || from_name, new.body, b.id, b.listing_id);
  return new;
end $$;
drop trigger if exists trg_notify_message on public.messages;
create trigger trg_notify_message after insert on public.messages for each row execute function public._trg_notify_message();

-- ------------------------------------------------------------------------------
-- 6. Alertas: una publicación nueva avisa a quienes la buscaban
-- ------------------------------------------------------------------------------
create or replace function public._trg_notify_saved_searches() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.venues; s record; f jsonb; n integer := 0;
begin
  select * into v from public.venues where id = new.venue_id;
  for s in select ss.id, ss.name, ss.filters, ss.user_id, p.musician_id from public.saved_searches ss
           join public.profiles p on p.user_id = ss.user_id and p.role = 'musico' and not p.suspended
           order by ss.created_at limit 500 loop
    f := s.filters;
    if jsonb_array_length(coalesce(f -> 'neighborhoods', '[]')) > 0 and not (f -> 'neighborhoods') ? v.neighborhood then continue; end if;
    if jsonb_array_length(coalesce(f -> 'genres', '[]')) > 0
       and not exists (select 1 from jsonb_array_elements_text(f -> 'genres') g where g = any(new.genres)) then continue; end if;
    if f ? 'minCachet' and new.cachet_ars < (f ->> 'minCachet')::bigint then continue; end if;
    if f ? 'maxCachet' and new.cachet_ars > (f ->> 'maxCachet')::bigint then continue; end if;
    if f ? 'mode' and new.booking_mode <> f ->> 'mode' then continue; end if;
    if f ? 'from' and new.starts_at < (f ->> 'from')::timestamptz then continue; end if;
    if f ? 'to' and new.starts_at > (f ->> 'to')::timestamptz then continue; end if;
    if exists (select 1 from public.bookings x where x.musician_id = s.musician_id and x.status in ('aceptada','confirmada','realizada')
               and tstzrange(x.starts_at, x.ends_at) && tstzrange(new.starts_at, new.ends_at)) then continue; end if;
    perform public._notify(s.user_id, 'search_match', 'Nueva fecha para tu búsqueda "' || s.name || '"',
      v.name || ' · ' || to_char(new.starts_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI') || ' · $' || new.cachet_ars, null, new.id);
    update public.saved_searches set last_notified_at = public.app_now() where id = s.id;
    n := n + 1;
  end loop;
  return new;
end $$;
drop trigger if exists trg_notify_saved_searches on public.listings;
create trigger trg_notify_saved_searches after insert on public.listings for each row execute function public._trg_notify_saved_searches();

-- ------------------------------------------------------------------------------
-- 7. Estadísticas e insignias (Superanfitrión / Superartista)
-- ------------------------------------------------------------------------------
create or replace function public.entity_stats(p_kind text, p_id text)
returns table (completed integer, cancelled_after_confirm integer, cancel_rate numeric, response_rate numeric,
               avg_response_hours numeric, rating numeric, review_count integer, is_superhost boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.app_settings; t timestamptz := public.app_now() - interval '365 days';
        c integer; cc integer; cr numeric; rr numeric; art numeric; rt numeric; rc integer; reqs integer; resp integer;
begin
  select * into s from public.app_settings;
  if p_kind = 'venue' then
    select v.rating, v.review_count into rt, rc from public.venues v where v.id = p_id;
    if not found then return; end if;
    select count(*)::int into c from public.bookings b where b.venue_id = p_id and b.status = 'realizada' and b.starts_at > t;
    select count(*)::int into cc from public.booking_events e join public.bookings b on b.id = e.booking_id
      where b.venue_id = p_id and e.event = 'cancelada' and e.from_status = 'confirmada' and e.meta ->> 'by' = 'bar' and b.starts_at > t;
    select count(*) filter (where true)::int, count(*) filter (where b.responded_at is not null)::int,
           avg(extract(epoch from (b.responded_at - b.created_at)) / 3600) filter (where b.responded_at is not null)
      into reqs, resp, art
      from public.bookings b join public.listings l on l.id = b.listing_id
      where b.venue_id = p_id and l.booking_mode = 'approval' and b.starts_at > t
        and not (b.status = 'cancelada' and b.cancelled_by = 'musico' and b.responded_at is null)
        and not (b.status = 'rechazada' and b.cancel_reason in ('listing_taken','listing_cancelled'))
        and (b.responded_at is not null or b.status = 'expirada');
    rr := case when reqs = 0 then null else round(100.0 * resp / reqs, 1) end;
  elsif p_kind = 'musician' then
    select m.rating, m.review_count into rt, rc from public.musicians m where m.id = p_id;
    if not found then return; end if;
    select count(*)::int into c from public.bookings b where b.musician_id = p_id and b.status = 'realizada' and b.starts_at > t;
    select count(*)::int into cc from public.booking_events e join public.bookings b on b.id = e.booking_id
      where b.musician_id = p_id and e.event = 'cancelada' and e.from_status = 'confirmada' and e.meta ->> 'by' = 'musico' and b.starts_at > t;
    rr := null; art := null;
  else
    return;
  end if;
  cr := case when c + cc = 0 then 0 else round(100.0 * cc / (c + cc), 1) end;
  return query select c, cc, cr, rr, round(art, 1), rt, rc,
    (c >= s.superhost_min_shows and rt >= s.superhost_min_rating and cr <= s.superhost_max_cancel_pct
     and (p_kind = 'musician' or coalesce(rr, 100) >= s.superhost_min_response_pct));
end $$;

-- ------------------------------------------------------------------------------
-- 8. Búsqueda con filtros, orden y paginación
-- ------------------------------------------------------------------------------
-- ¿El usuario actual (si es músico) ya tiene un show que se pisa con este horario?
create or replace function public._viewer_busy(p_start timestamptz, p_end timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p join public.bookings b on b.musician_id = p.musician_id
    where p.user_id = auth.uid() and p.role = 'musico' and b.status in ('aceptada','confirmada','realizada')
      and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_start, p_end))
$$;

create or replace function public.search_listings(
  p_from timestamptz default null, p_to timestamptz default null,
  p_neighborhoods text[] default null, p_genres text[] default null,
  p_min_cachet bigint default null, p_max_cachet bigint default null,
  p_mode text default null, p_min_rating numeric default null, p_text text default null,
  p_hide_busy boolean default false, p_sort text default 'date', p_limit integer default 20, p_offset integer default 0)
returns table (listing_id uuid, venue_id text, venue_name text, neighborhood text, address text, cover_photo text, capacity integer,
               venue_rating numeric, venue_review_count integer, starts_at timestamptz, ends_at timestamptz, cachet_ars bigint,
               genres text[], backline text[], booking_mode text, cancellation_policy text, notes text, venue_superhost boolean, total_count bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with q as (
    select l.id, l.venue_id, v.name vname, v.neighborhood, v.address, v.cover_photo, v.capacity, v.rating vrating, v.review_count vcount,
           l.starts_at, l.ends_at, l.cachet_ars, l.genres, l.backline, l.booking_mode, l.cancellation_policy, l.notes
    from public.listings l join public.venues v on v.id = l.venue_id
    where l.status = 'abierta' and l.starts_at > public.app_now() + interval '2 hours'
      and (p_from is null or l.starts_at >= p_from) and (p_to is null or l.starts_at <= p_to)
      and (p_neighborhoods is null or cardinality(p_neighborhoods) = 0 or v.neighborhood = any(p_neighborhoods))
      and (p_genres is null or cardinality(p_genres) = 0 or l.genres && p_genres)
      and (p_min_cachet is null or l.cachet_ars >= p_min_cachet) and (p_max_cachet is null or l.cachet_ars <= p_max_cachet)
      and (p_mode is null or l.booking_mode = p_mode) and (p_min_rating is null or v.rating >= p_min_rating)
      and (p_text is null or btrim(p_text) = '' or v.name ilike '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
           or v.neighborhood ilike '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
           or l.notes ilike '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\')
      and (not p_hide_busy or not public._viewer_busy(l.starts_at, l.ends_at))
  )
  select q.id, q.venue_id, q.vname, q.neighborhood, q.address, q.cover_photo, q.capacity, q.vrating, q.vcount, q.starts_at, q.ends_at,
         q.cachet_ars, q.genres, q.backline, q.booking_mode, q.cancellation_policy, q.notes,
         coalesce((select s.is_superhost from public.entity_stats('venue', q.venue_id) s), false),
         count(*) over ()
  from q
  order by case when p_sort = 'cachet_desc' then -q.cachet_ars end, case when p_sort = 'rating_desc' then -q.vrating end, q.starts_at, q.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ------------------------------------------------------------------------------
-- 9. Favoritos, búsquedas guardadas, notificaciones, ganancias y verificación (RPC)
-- ------------------------------------------------------------------------------
create or replace function public.toggle_favorite(p_kind text, p_target_id text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; ok boolean;
begin
  p := public.current_profile();
  perform pg_advisory_xact_lock(hashtextextended('fav:' || p.user_id::text, 0));
  if p_kind not in ('listing','venue','musician') or p_target_id is null then raise exception 'invalid_favorite' using errcode = 'P0001'; end if;
  if exists (select 1 from public.favorites where user_id = p.user_id and kind = p_kind and target_id = p_target_id) then
    delete from public.favorites where user_id = p.user_id and kind = p_kind and target_id = p_target_id;
    return false;
  end if;
  ok := case p_kind
    when 'listing' then exists (select 1 from public.listings where id::text = p_target_id and status <> 'cancelada')
    when 'venue' then exists (select 1 from public.venues where id = p_target_id)
    else exists (select 1 from public.musicians where id = p_target_id) end;
  if not ok then raise exception 'target_not_found' using errcode = 'P0001'; end if;
  if (select count(*) from public.favorites where user_id = p.user_id) >= 500 then raise exception 'favorites_limit' using errcode = 'P0001'; end if;
  insert into public.favorites (user_id, kind, target_id) values (p.user_id, p_kind, p_target_id) on conflict do nothing;
  return true;
end $$;

create or replace function public.save_search(p_name text, p_filters jsonb) returns public.saved_searches
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; r public.saved_searches; k text; v jsonb; nm text := btrim(coalesce(p_name, ''));
begin
  p := public.current_profile();
  if p.role <> 'musico' then raise exception 'forbidden_role' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ss:' || p.user_id::text, 0));
  if char_length(nm) not between 1 and 60 then raise exception 'invalid_name' using errcode = 'P0001'; end if;
  if p_filters is null or jsonb_typeof(p_filters) <> 'object' then raise exception 'invalid_filters' using errcode = 'P0001'; end if;
  for k, v in select * from jsonb_each(p_filters) loop
    if k in ('neighborhoods','genres') then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 30 or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then
        raise exception 'invalid_filters' using errcode = 'P0001'; end if;
    elsif k in ('minCachet','maxCachet') then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 100000000 or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
        raise exception 'invalid_filters' using errcode = 'P0001'; end if;
    elsif k = 'mode' then
      if v #>> '{}' not in ('instant','approval') then raise exception 'invalid_filters' using errcode = 'P0001'; end if;
    elsif k in ('from','to') then
      begin perform (v #>> '{}')::timestamptz; exception when others then raise exception 'invalid_filters' using errcode = 'P0001'; end;
    else
      raise exception 'invalid_filters' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(*) from public.saved_searches where user_id = p.user_id) >= 10 then raise exception 'too_many_searches' using errcode = 'P0001'; end if;
  insert into public.saved_searches (user_id, name, filters) values (p.user_id, nm, p_filters) returning * into r;
  return r;
end $$;

create or replace function public.delete_saved_search(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  delete from public.saved_searches where id = p_id and user_id = auth.uid();
  return found;
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  update public.notifications set read_at = public.app_now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- Cola de entrega (push/email): el worker pide pendientes y los marca entregados
create or replace function public.claim_pending_notifications(p_limit integer default 100) returns setof public.notifications
language sql security definer set search_path = public, pg_temp as $$
  update public.notifications n set delivered_at = public.app_now()
  where n.id in (select id from public.notifications where delivered_at is null order by created_at limit least(greatest(p_limit, 1), 500) for update skip locked)
  returning n.*
$$;

create or replace function public.my_earnings()
returns table (role text, pending_ars bigint, settled_ars bigint, refunded_ars bigint, shows_completed integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.profiles;
begin
  p := public.current_profile();
  if p.role = 'bar' then
    return query select 'bar'::text,
      coalesce(sum(pay.charged_ars) filter (where pay.status = 'held'), 0)::bigint,
      coalesce(sum(pay.charged_ars - pay.refunded_ars) filter (where pay.status <> 'held'), 0)::bigint,
      coalesce(sum(pay.refunded_ars) filter (where pay.status <> 'held'), 0)::bigint,
      (select count(*)::int from public.bookings b where b.venue_id = p.venue_id and b.status = 'realizada')
    from public.payments pay join public.bookings b on b.id = pay.booking_id where b.venue_id = p.venue_id;
  else
    return query select 'musico'::text,
      coalesce(sum(pay.cachet_ars - public.calc_fee(pay.cachet_ars, pay.musician_fee_bps)) filter (where pay.status = 'held'), 0)::bigint,
      coalesce(sum(pay.payout_ars) filter (where pay.status <> 'held'), 0)::bigint,
      0::bigint,
      (select count(*)::int from public.bookings b where b.musician_id = p.musician_id and b.status = 'realizada')
    from public.payments pay join public.bookings b on b.id = pay.booking_id where b.musician_id = p.musician_id;
  end if;
end $$;

create or replace function public.request_profile(p_role text, p_display_name text, p_neighborhood text default null,
  p_address text default null, p_bio text default '', p_evidence_url text default null) returns public.profile_requests
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.profile_requests; nm text := btrim(coalesce(p_display_name, ''));
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profiles where user_id = auth.uid()) then raise exception 'profile_exists' using errcode = 'P0001'; end if;
  if exists (select 1 from public.profile_requests where user_id = auth.uid() and status = 'pendiente') then raise exception 'request_pending' using errcode = 'P0001'; end if;
  if p_role not in ('bar','musico') or char_length(nm) not between 2 and 80 then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  if p_role = 'bar' and (btrim(coalesce(p_neighborhood, '')) = '' or btrim(coalesce(p_address, '')) = '') then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_bio, '')) > 1000 then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  if p_evidence_url is not null and (char_length(p_evidence_url) > 500 or p_evidence_url !~ '^https://[^[:space:]]{3,}$') then raise exception 'invalid_evidence' using errcode = 'P0001'; end if;
  insert into public.profile_requests (user_id, role, display_name, neighborhood, address, bio, evidence_url)
  values (auth.uid(), p_role, nm, nullif(btrim(coalesce(p_neighborhood, '')), ''), nullif(btrim(coalesce(p_address, '')), ''), coalesce(p_bio, ''), p_evidence_url)
  returning * into r;
  return r;
end $$;

-- El equipo aprueba o rechaza: al aprobar se crea el bar/músico y el perfil verificado
create or replace function public.admin_review_profile_request(p_request_id uuid, p_approve boolean, p_note text default '')
returns public.profile_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.profile_requests; eid text;
begin
  select * into r from public.profile_requests where id = p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  if r.status <> 'pendiente' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if p_approve then
    if exists (select 1 from public.profiles where user_id = r.user_id) then raise exception 'profile_exists' using errcode = 'P0001'; end if;
    eid := case when r.role = 'bar' then 'v-' else 'm-' end || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    if r.role = 'bar' then
      insert into public.venues (id, name, neighborhood, address, type, bio, base_rating, base_count)
      values (eid, r.display_name, r.neighborhood, r.address, 'Bar de Copas', r.bio, 5.0, 0);
      insert into public.profiles (user_id, role, venue_id, verified) values (r.user_id, 'bar', eid, true);
    else
      insert into public.musicians (id, stage_name, format, bio, base_rating, base_count)
      values (eid, r.display_name, 'Solista', r.bio, 5.0, 0);
      insert into public.profiles (user_id, role, musician_id, verified) values (r.user_id, 'musico', eid, true);
    end if;
  end if;
  update public.profile_requests set status = case when p_approve then 'aprobada' else 'rechazada' end,
    reviewer_note = left(coalesce(p_note, ''), 500), reviewed_at = public.app_now() where id = r.id returning * into r;
  perform public._notify(r.user_id, case when p_approve then 'profile_approved' else 'profile_rejected' end,
    case when p_approve then '¡Tu perfil fue verificado!' else 'No pudimos verificar tu perfil' end, coalesce(p_note, ''));
  return r;
end $$;

create or replace function public.admin_verify_profile(p_user uuid, p_verified boolean) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.profiles set verified = p_verified where user_id = p_user
$$;

-- ------------------------------------------------------------------------------
-- 10. Permisos de ejecución
-- ------------------------------------------------------------------------------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_notify','_notify_event','_trg_notify_message','_trg_notify_saved_searches',
             'entity_stats','_viewer_busy','toggle_favorite','save_search','delete_saved_search','mark_notifications_read','claim_pending_notifications',
             'my_earnings','request_profile','admin_review_profile_request','admin_verify_profile')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public._viewer_busy(timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.toggle_favorite(text, text) to authenticated;
grant execute on function public.save_search(text, jsonb) to authenticated;
grant execute on function public.delete_saved_search(uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.my_earnings() to authenticated;
grant execute on function public.request_profile(text, text, text, text, text, text) to authenticated;
grant execute on function public.entity_stats(text, text) to anon, authenticated;
grant execute on function public.search_listings(timestamptz, timestamptz, text[], text[], bigint, bigint, text, numeric, text, boolean, text, integer, integer) to anon, authenticated;
