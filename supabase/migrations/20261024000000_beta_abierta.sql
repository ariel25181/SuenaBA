-- ==============================================================================
-- SuenaBA - Beta abierta: alta automática de perfiles (para que testers entren sin esperar aprobación).
-- Ejecutar DESPUÉS de 20261023000000_mercado_pago.sql.
--   Activar:   update app_settings set auto_approve_profiles = true;
--   Desactivar: update app_settings set auto_approve_profiles = false;   (vuelve la aprobación manual)
-- Los perfiles creados así quedan SIN verificar (verified = false); se puede exigir verificación con require_verification.
-- ==============================================================================
alter table public.app_settings add column if not exists auto_approve_profiles boolean not null default false;

-- Resuelve una solicitud (aprueba creando bar/músico + perfil, o rechaza). Lo usan el equipo y la beta abierta.
create or replace function public._resolve_profile_request(p_request_id uuid, p_approve boolean, p_note text, p_verified boolean)
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
      insert into public.profiles (user_id, role, venue_id, verified) values (r.user_id, 'bar', eid, p_verified);
    else
      insert into public.musicians (id, stage_name, format, bio, base_rating, base_count)
      values (eid, r.display_name, 'Solista', r.bio, 5.0, 0);
      insert into public.profiles (user_id, role, musician_id, verified) values (r.user_id, 'musico', eid, p_verified);
    end if;
  end if;
  update public.profile_requests set status = case when p_approve then 'aprobada' else 'rechazada' end,
    reviewer_note = left(coalesce(p_note, ''), 500), reviewed_at = public.app_now() where id = r.id returning * into r;
  perform public._notify(r.user_id, case when p_approve then 'profile_approved' else 'profile_rejected' end,
    case when not p_approve then 'No pudimos verificar tu perfil' when p_verified then '¡Tu perfil fue verificado!' else '¡Tu perfil está listo!' end, coalesce(p_note, ''));
  return r;
end $$;

create or replace function public.admin_review_profile_request(p_request_id uuid, p_approve boolean, p_note text default '')
returns public.profile_requests language sql security definer set search_path = public, pg_temp as $$
  select * from public._resolve_profile_request(p_request_id, p_approve, p_note, true)
$$;

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
  if (select auto_approve_profiles from public.app_settings) then
    r := public._resolve_profile_request(r.id, true, 'Alta automática (beta abierta)', false);
  end if;
  return r;
end $$;

revoke all on function public._resolve_profile_request(uuid, boolean, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_review_profile_request(uuid, boolean, text) from public, anon, authenticated;
