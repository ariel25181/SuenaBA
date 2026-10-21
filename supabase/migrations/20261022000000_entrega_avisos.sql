-- ==============================================================================
-- SuenaBA - Entrega de avisos por email y push: cola con reintentos, preferencias y suscripciones.
-- Ejecutar DESPUÉS de 20261021000000_tour_novedades.sql.
-- Semántica: entrega "al menos una vez". Cada canal (email / push) se marca por separado para no repetirlo en reintentos.
-- ==============================================================================

alter table public.notifications
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists failed_at timestamptz,
  add column if not exists delivery_error text,
  add column if not exists email_sent_at timestamptz,
  add column if not exists push_sent_at timestamptz;
drop index if exists public.notifications_undelivered_idx;
create index if not exists notifications_queue_idx on public.notifications (next_attempt_at, created_at) where delivered_at is null and failed_at is null;

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default true,
  muted_kinds text[] not null default '{}' check (cardinality(muted_kinds) <= 30),
  updated_at timestamptz not null default now()
);
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000 and endpoint ~ '^https://'),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at);

alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;
revoke all on public.notification_prefs, public.push_subscriptions from anon, authenticated;
grant select on public.notification_prefs to authenticated;
grant select (id, created_at, user_agent) on public.push_subscriptions to authenticated;   -- nunca exponemos las claves
drop policy if exists nprefs_own on public.notification_prefs;
create policy nprefs_own on public.notification_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- ---- Usuario: preferencias y suscripciones
create or replace function public.set_notification_prefs(p_email boolean default null, p_push boolean default null, p_muted_kinds text[] default null)
returns public.notification_prefs language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.notification_prefs;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_muted_kinds is not null and (cardinality(p_muted_kinds) > 30 or exists (select 1 from unnest(p_muted_kinds) k where k is null or k !~ '^[a-z_]{1,40}$')) then
    raise exception 'invalid_prefs' using errcode = 'P0001'; end if;
  insert into public.notification_prefs as n (user_id, email_enabled, push_enabled, muted_kinds)
  values (auth.uid(), coalesce(p_email, true), coalesce(p_push, true), coalesce(p_muted_kinds, '{}'))
  on conflict (user_id) do update set
    email_enabled = coalesce(p_email, n.email_enabled), push_enabled = coalesce(p_push, n.push_enabled),
    muted_kinds = coalesce(p_muted_kinds, n.muted_kinds), updated_at = public.app_now()
  returning * into r;
  return r;
end $$;

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push:' || auth.uid()::text, 0));
  if p_endpoint is null or p_endpoint !~ '^https://[^[:space:]]{4,}$' or char_length(p_endpoint) > 1000
     or p_p256dh is null or char_length(p_p256dh) not between 20 and 200 or p_auth is null or char_length(p_auth) not between 8 and 100 then
    raise exception 'invalid_subscription' using errcode = 'P0001'; end if;
  -- un mismo navegador puede pasar de una cuenta a otra: el endpoint queda con quien lo registró último
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent
  returning id into rid;
  -- máximo 10 dispositivos por usuario (se descartan los más viejos)
  delete from public.push_subscriptions where id in (
    select id from public.push_subscriptions where user_id = auth.uid() order by created_at desc, id desc offset 10);
  return rid;
end $$;

create or replace function public.remove_push_subscription(p_endpoint text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return found;
end $$;

-- ---- Worker (service role): cola con reintentos
drop function if exists public.claim_pending_notifications(integer);
create or replace function public.claim_pending_notifications(p_limit integer default 50) returns setof public.notifications
language sql security definer set search_path = public, pg_temp as $$
  update public.notifications n set claimed_at = public.app_now(), delivery_attempts = n.delivery_attempts + 1
  where n.id in (
    select id from public.notifications
    where delivered_at is null and failed_at is null and next_attempt_at <= public.app_now()
      and (claimed_at is null or claimed_at < public.app_now() - interval '10 minutes')      -- reclama las que un worker dejó colgadas
    order by created_at, id limit least(greatest(coalesce(p_limit, 50), 1), 200) for update skip locked)
  returning n.*
$$;

-- Resultado del intento. p_ok = true => entregada. Si falla: reintenta con espera creciente (2, 4, 8, 16 min) hasta 5 intentos.
create or replace function public.complete_notification_delivery(p_id uuid, p_ok boolean, p_error text default null,
  p_email_sent boolean default false, p_push_sent boolean default false)
returns public.notifications language plpgsql security definer set search_path = public, pg_temp as $$
declare n public.notifications;
begin
  select * into n from public.notifications where id = p_id for update;
  if not found then raise exception 'notification_not_found' using errcode = 'P0001'; end if;
  if n.delivered_at is not null or n.failed_at is not null then return n; end if;
  update public.notifications set
    email_sent_at = case when p_email_sent then coalesce(email_sent_at, public.app_now()) else email_sent_at end,
    push_sent_at = case when p_push_sent then coalesce(push_sent_at, public.app_now()) else push_sent_at end,
    claimed_at = null,
    delivered_at = case when p_ok then public.app_now() end,
    delivery_error = case when p_ok then null else left(p_error, 500) end,
    failed_at = case when not p_ok and delivery_attempts >= 5 then public.app_now() end,
    next_attempt_at = case when not p_ok and delivery_attempts < 5 then public.app_now() + make_interval(mins => power(2, delivery_attempts)::int) else next_attempt_at end
  where id = p_id returning * into n;
  return n;
end $$;

-- Todo lo que el worker necesita saber de un usuario (email, preferencias y dispositivos) en una sola llamada
create or replace function public.get_delivery_target(p_user uuid)
returns table (email text, email_enabled boolean, push_enabled boolean, muted_kinds text[], subscriptions jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.email::text, coalesce(p.email_enabled, true), coalesce(p.push_enabled, true), coalesce(p.muted_kinds, '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth) order by s.created_at) from public.push_subscriptions s where s.user_id = u.id), '[]')
  from auth.users u left join public.notification_prefs p on p.user_id = u.id where u.id = p_user
$$;

-- Un servicio de push informa que el dispositivo ya no existe (404/410)
create or replace function public.drop_push_endpoint(p_endpoint text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with d as (delete from public.push_subscriptions where endpoint = p_endpoint returning 1) select exists (select 1 from d)
$$;
create or replace function public.mark_push_success(p_endpoint text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.push_subscriptions set last_success_at = public.app_now() where endpoint = p_endpoint
$$;

revoke all on function public.set_notification_prefs(boolean, boolean, text[]) from public, anon, authenticated;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon, authenticated;
revoke all on function public.remove_push_subscription(text) from public, anon, authenticated;
revoke all on function public.claim_pending_notifications(integer) from public, anon, authenticated;
revoke all on function public.complete_notification_delivery(uuid, boolean, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.get_delivery_target(uuid) from public, anon, authenticated;
revoke all on function public.drop_push_endpoint(text) from public, anon, authenticated;
revoke all on function public.mark_push_success(text) from public, anon, authenticated;
grant execute on function public.set_notification_prefs(boolean, boolean, text[]) to authenticated;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
