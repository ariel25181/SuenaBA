-- ==============================================================================
-- SuenaBA - Tour de bienvenida, novedades y cartelera pública
-- Ejecutar DESPUÉS de 20261020000000_airbnb_extras.sql.
-- ==============================================================================

-- Preferencias por usuario: tipo de uso (anfitrión / músico / público), tour visto y novedades leídas.
create table if not exists public.user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  audience text check (audience in ('anfitrion','musico','publico')),
  tour_version integer not null default 0 check (tour_version between 0 and 1000000),
  whats_new_seen integer not null default 0 check (whats_new_seen between 0 and 1000000),
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
revoke all on public.user_prefs from anon, authenticated;
grant select on public.user_prefs to authenticated;
drop policy if exists prefs_own on public.user_prefs;
create policy prefs_own on public.user_prefs for select to authenticated using (user_id = auth.uid());

-- Guarda preferencias. Los contadores solo avanzan (un dispositivo desactualizado no puede "des-ver" el tour).
create or replace function public.save_user_prefs(p_audience text default null, p_tour_version integer default null, p_whats_new_seen integer default null)
returns public.user_prefs language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.user_prefs;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_audience is not null and p_audience not in ('anfitrion','musico','publico') then raise exception 'invalid_prefs' using errcode = 'P0001'; end if;
  if p_tour_version is not null and p_tour_version not between 0 and 1000000 then raise exception 'invalid_prefs' using errcode = 'P0001'; end if;
  if p_whats_new_seen is not null and p_whats_new_seen not between 0 and 1000000 then raise exception 'invalid_prefs' using errcode = 'P0001'; end if;
  insert into public.user_prefs as u (user_id, audience, tour_version, whats_new_seen)
  values (auth.uid(), p_audience, coalesce(p_tour_version, 0), coalesce(p_whats_new_seen, 0))
  on conflict (user_id) do update set
    audience = coalesce(excluded.audience, u.audience),
    tour_version = greatest(u.tour_version, coalesce(p_tour_version, 0)),
    whats_new_seen = greatest(u.whats_new_seen, coalesce(p_whats_new_seen, 0)),
    updated_at = public.app_now()
  returning * into r;
  return r;
end $$;

-- Cartelera pública: shows confirmados (ya pagos) por venir. Sin datos de dinero ni de usuarios.
create or replace function public.upcoming_shows(
  p_from timestamptz default null, p_to timestamptz default null, p_neighborhoods text[] default null, p_genres text[] default null,
  p_limit integer default 20, p_offset integer default 0)
returns table (booking_id uuid, venue_id text, venue_name text, neighborhood text, address text, cover_photo text, musician_id text,
               musician_name text, musician_format text, genres text[], starts_at timestamptz, ends_at timestamptz, total_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id, v.id, v.name, v.neighborhood, v.address, v.cover_photo, m.id, m.stage_name, m.format,
         (select coalesce(array_agg(distinct g), '{}') from unnest(l.genres || coalesce(m.genres, '{}')) g),
         b.starts_at, b.ends_at, count(*) over ()
  from public.bookings b
  join public.listings l on l.id = b.listing_id
  join public.venues v on v.id = b.venue_id
  join public.musicians m on m.id = b.musician_id
  where b.status = 'confirmada' and b.disputed_at is null and b.starts_at > public.app_now()
    and (p_from is null or b.starts_at >= p_from) and (p_to is null or b.starts_at <= p_to)
    and (p_neighborhoods is null or cardinality(p_neighborhoods) = 0 or v.neighborhood = any(p_neighborhoods))
    and (p_genres is null or cardinality(p_genres) = 0 or (l.genres || coalesce(m.genres, '{}')) && p_genres)
  order by b.starts_at, b.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.save_user_prefs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.upcoming_shows(timestamptz, timestamptz, text[], text[], integer, integer) from public, anon, authenticated;
grant execute on function public.save_user_prefs(text, integer, integer) to authenticated;
grant execute on function public.upcoming_shows(timestamptz, timestamptz, text[], text[], integer, integer) to anon, authenticated;
