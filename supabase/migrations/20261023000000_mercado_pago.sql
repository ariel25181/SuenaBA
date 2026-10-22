-- ==============================================================================
-- SuenaBA - Cobros con Mercado Pago (Checkout Pro), reembolsos reales y pagos a músicos.
-- Ejecutar DESPUÉS de 20261022000000_entrega_avisos.sql.
-- Activar:  update app_settings set payment_mode = 'mercadopago';   (por defecto sigue 'simulado')
--
-- Flujo: el bar pide pagar -> begin_payment crea una "intención" con el monto congelado -> la Edge Function crea la
-- preferencia en Mercado Pago -> el bar paga allá -> el webhook (verificado por firma) consulta el pago a Mercado Pago
-- y llama a confirm_payment_intent, que confirma la reserva UNA sola vez aunque el aviso llegue repetido o desordenado.
-- ==============================================================================

create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  status text not null default 'pendiente' check (status in ('pendiente','aprobado','cancelado','vencido','reembolsar','reembolsado','discrepancia')),
  provider text not null default 'mercadopago',
  external_reference text not null unique,
  preference_id text,
  init_point text,
  cachet_ars bigint not null check (cachet_ars >= 0),
  venue_fee_ars bigint not null check (venue_fee_ars >= 0),
  amount_ars bigint not null check (amount_ars >= 0),
  venue_fee_bps integer not null,
  musician_fee_bps integer not null,
  expires_at timestamptz not null,
  mp_payment_id text unique,
  mp_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  check (amount_ars = cachet_ars + venue_fee_ars)
);
create unique index if not exists payment_intents_one_pending on public.payment_intents (booking_id) where status = 'pendiente';

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  mp_payment_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (reason in ('cancelacion','disputa','pago_tardio','discrepancia','doble_cobro')),
  status text not null default 'pendiente' check (status in ('pendiente','hecho','fallido')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  mp_refund_id text,
  error text,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (mp_payment_id, reason)
);
create index if not exists payment_refunds_queue_idx on public.payment_refunds (next_attempt_at) where status = 'pendiente';

-- CBU/CVU (exactamente 22 dígitos) o alias (6-20 caracteres con al menos una letra: un número truncado no se toma por alias)
create or replace function public.valid_payout_alias(a text) returns boolean language sql immutable as
$$ select a ~ '^[0-9]{22}$' or (a ~ '^[A-Za-z0-9.-]{6,20}$' and a ~ '[A-Za-z]') $$;
alter table public.profiles add column if not exists payout_alias text check (payout_alias is null or public.valid_payout_alias(payout_alias));

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id),
  musician_id text not null references public.musicians(id),
  user_id uuid references auth.users(id),
  amount_ars bigint not null check (amount_ars > 0),
  alias_snapshot text,
  status text not null default 'pendiente' check (status in ('pendiente','pagado')),
  reference text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.payment_intents enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payouts enable row level security;
revoke all on public.payment_intents, public.payment_refunds, public.payouts from anon, authenticated;
grant select (id, booking_id, status, amount_ars, init_point, expires_at, created_at) on public.payment_intents to authenticated;
grant select (id, booking_id, amount, reason, status, created_at, done_at) on public.payment_refunds to authenticated;
grant select (id, booking_id, amount_ars, status, reference, created_at, paid_at) on public.payouts to authenticated;
-- el bar ve sus intentos de pago; el bar ve los reembolsos de sus reservas; el músico ve sus pagos
drop policy if exists intents_bar on public.payment_intents;
create policy intents_bar on public.payment_intents for select to authenticated using (
  exists (select 1 from public.profiles pr join public.bookings b on b.venue_id = pr.venue_id where pr.user_id = auth.uid() and b.id = payment_intents.booking_id));
drop policy if exists refunds_bar on public.payment_refunds;
create policy refunds_bar on public.payment_refunds for select to authenticated using (
  exists (select 1 from public.profiles pr join public.bookings b on b.venue_id = pr.venue_id where pr.user_id = auth.uid() and b.id = payment_refunds.booking_id));
drop policy if exists payouts_own on public.payouts;
create policy payouts_own on public.payouts for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------------------------
-- Liquidación: reembolsos reales y pago al músico
-- ------------------------------------------------------------------------------
create or replace function public._enqueue_refund(p_booking uuid, p_mp_payment text, p_amount numeric, p_reason text) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.payment_refunds (booking_id, mp_payment_id, amount, reason, next_attempt_at)
  select p_booking, p_mp_payment, p_amount, p_reason, public.app_now() where p_amount > 0
  on conflict (mp_payment_id, reason) do nothing
$$;

create or replace function public._after_settle(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pay public.payments; b public.bookings; bar_u uuid; alias text; mus_u uuid;
begin
  select * into pay from public.payments where id = p_payment_id;
  select * into b from public.bookings where id = pay.booking_id;
  if pay.refunded_ars > 0 then
    if pay.provider = 'mercadopago' and pay.provider_ref is not null then
      perform public._enqueue_refund(b.id, pay.provider_ref, pay.refunded_ars, p_reason);
    end if;
    select user_id into bar_u from public.profiles where venue_id = b.venue_id;
    perform public._notify(bar_u, 'payment_refund', 'Reembolso en camino', 'Te devolvemos $' || pay.refunded_ars || ' por la reserva cancelada.', b.id, b.listing_id);
  end if;
  if pay.payout_ars > 0 then
    select user_id, payout_alias into mus_u, alias from public.profiles where musician_id = b.musician_id;
    insert into public.payouts (booking_id, musician_id, user_id, amount_ars, alias_snapshot) values (b.id, b.musician_id, mus_u, pay.payout_ars, alias)
    on conflict (booking_id) do nothing;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- Cobro: intención de pago (bar), preferencia y confirmación (service role / webhook)
-- ------------------------------------------------------------------------------
create or replace function public.begin_payment(p_booking_id uuid) returns public.payment_intents
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; b public.bookings; s public.app_settings; i public.payment_intents; vfee bigint; nid uuid := gen_random_uuid();
begin
  p := public.current_profile();
  select * into s from public.app_settings;
  if s.payment_mode <> 'mercadopago' then raise exception 'payments_disabled' using errcode = 'P0001'; end if;
  b := public._lock_booking(p_booking_id);
  if p.venue_id is distinct from b.venue_id then raise exception 'booking_not_found' using errcode = 'P0001'; end if;
  if b.status = 'confirmada' then raise exception 'already_paid' using errcode = 'P0001'; end if;
  if b.status <> 'aceptada' then raise exception 'invalid_state' using errcode = 'P0001'; end if;
  if public.app_now() > b.fund_by or public.app_now() >= b.starts_at then raise exception 'booking_expired' using errcode = 'P0001'; end if;
  vfee := public.calc_fee(b.cachet_ars, s.venue_fee_bps);
  select * into i from public.payment_intents where booking_id = b.id and status = 'pendiente' for no key update;
  if found then
    -- mismo monto y todavía vigente: se reutiliza (el bar puede reabrir el link sin crear otro cobro)
    if i.expires_at > public.app_now() and i.cachet_ars = b.cachet_ars and i.venue_fee_ars = vfee then return i; end if;
    update public.payment_intents set status = case when expires_at <= public.app_now() then 'vencido' else 'cancelado' end, updated_at = public.app_now() where id = i.id;
  end if;
  if b.cachet_ars + vfee = 0 then   -- reserva gratuita: Mercado Pago no cobra $0, se confirma directo
    insert into public.payment_intents (id, booking_id, status, external_reference, cachet_ars, venue_fee_ars, amount_ars, venue_fee_bps, musician_fee_bps, expires_at, approved_at, mp_status, created_at, updated_at)
    values (nid, b.id, 'aprobado', nid::text, 0, 0, 0, s.venue_fee_bps, s.musician_fee_bps, b.fund_by, public.app_now(), 'free', public.app_now(), public.app_now()) returning * into i;
    perform public._fund_booking(b, 'gratis', null, s.venue_fee_bps, s.musician_fee_bps);
    return i;
  end if;
  insert into public.payment_intents (id, booking_id, external_reference, cachet_ars, venue_fee_ars, amount_ars, venue_fee_bps, musician_fee_bps, expires_at, created_at, updated_at)
  values (nid, b.id, nid::text, b.cachet_ars, vfee, b.cachet_ars + vfee, s.venue_fee_bps, s.musician_fee_bps,
          least(b.fund_by, public.app_now() + interval '24 hours'), public.app_now(), public.app_now())
  returning * into i;
  return i;
end $$;

create or replace function public.attach_preference(p_intent uuid, p_preference_id text, p_init_point text) returns public.payment_intents
language plpgsql security definer set search_path = public, pg_temp as $$
declare i public.payment_intents;
begin
  if p_init_point is null or p_init_point !~ '^https://[^[:space:]]+$' or p_preference_id is null or char_length(p_preference_id) > 100 then raise exception 'invalid_preference' using errcode = 'P0001'; end if;
  update public.payment_intents set preference_id = coalesce(preference_id, p_preference_id), init_point = coalesce(init_point, p_init_point), updated_at = public.app_now()
  where id = p_intent and status = 'pendiente' returning * into i;
  if not found then select * into i from public.payment_intents where id = p_intent; if not found then raise exception 'intent_not_found' using errcode = 'P0001'; end if; end if;
  return i;
end $$;

-- Confirma (o rechaza) un pago informado por el webhook. Idempotente: el mismo aviso repetido no cobra dos veces.
create or replace function public.confirm_payment_intent(p_intent uuid, p_mp_payment_id text, p_amount numeric, p_currency text, p_mp_status text)
returns public.payment_intents language plpgsql security definer set search_path = public, pg_temp as $$
declare bid uuid; b public.bookings; i public.payment_intents; bar_u uuid;
begin
  if p_mp_payment_id is null or p_mp_payment_id !~ '^[0-9]{1,30}$' then raise exception 'invalid_payment' using errcode = 'P0001'; end if;
  select booking_id into bid from public.payment_intents where id = p_intent;
  if not found then raise exception 'intent_not_found' using errcode = 'P0001'; end if;
  b := public._lock_booking(bid);                                   -- mismo orden de locks que el resto: publicación -> reserva -> intención
  select * into i from public.payment_intents where id = p_intent for no key update;
  if i.mp_payment_id = p_mp_payment_id and i.status <> 'pendiente' then return i; end if;               -- aviso repetido
  if i.status <> 'pendiente' then                                   -- ya se resolvió con OTRO pago: si este también se aprobó, se devuelve
    if p_mp_status = 'approved' and i.mp_payment_id is distinct from p_mp_payment_id then
      perform public._enqueue_refund(b.id, p_mp_payment_id, p_amount, 'doble_cobro');
    end if;
    return i;
  end if;
  if p_mp_status <> 'approved' then
    update public.payment_intents set mp_status = left(p_mp_status, 40), updated_at = public.app_now() where id = i.id returning * into i;
    return i;
  end if;
  if p_currency is distinct from 'ARS' or p_amount is distinct from i.amount_ars::numeric then
    update public.payment_intents set status = 'discrepancia', mp_payment_id = p_mp_payment_id, mp_status = 'approved', updated_at = public.app_now() where id = i.id returning * into i;
    perform public._enqueue_refund(b.id, p_mp_payment_id, p_amount, 'discrepancia');
    return i;
  end if;
  if b.status = 'aceptada' and public.app_now() < b.starts_at then
    perform public._fund_booking(b, 'mercadopago', p_mp_payment_id, i.venue_fee_bps, i.musician_fee_bps);
    update public.payment_intents set status = 'aprobado', mp_payment_id = p_mp_payment_id, mp_status = 'approved', approved_at = public.app_now(), updated_at = public.app_now() where id = i.id returning * into i;
  else
    -- pagó tarde: la reserva ya se canceló, venció o empezó. No se confirma nada y se le devuelve todo.
    update public.payment_intents set status = 'reembolsar', mp_payment_id = p_mp_payment_id, mp_status = 'approved', updated_at = public.app_now() where id = i.id returning * into i;
    perform public._enqueue_refund(b.id, p_mp_payment_id, p_amount, 'pago_tardio');
    select user_id into bar_u from public.profiles where venue_id = b.venue_id;
    perform public._notify(bar_u, 'payment_refund', 'Pago devuelto', 'La reserva ya no estaba disponible: te devolvemos $' || p_amount || '.', b.id, b.listing_id);
  end if;
  return i;
end $$;

create or replace function public.expire_stale_intents() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.payment_intents set status = 'vencido', updated_at = public.app_now() where status = 'pendiente' and expires_at < public.app_now();
  get diagnostics n = row_count; return n;
end $$;

-- ------------------------------------------------------------------------------
-- Cola de reembolsos (worker): espera creciente (2,4,8,16,32 min) y 6 intentos
-- ------------------------------------------------------------------------------
create or replace function public.claim_pending_refunds(p_limit integer default 20) returns setof public.payment_refunds
language sql security definer set search_path = public, pg_temp as $$
  update public.payment_refunds r set claimed_at = public.app_now(), attempts = r.attempts + 1
  where r.id in (select id from public.payment_refunds where status = 'pendiente' and next_attempt_at <= public.app_now()
      and (claimed_at is null or claimed_at < public.app_now() - interval '10 minutes')
    order by created_at, id limit least(greatest(coalesce(p_limit, 20), 1), 100) for update skip locked)
  returning r.*
$$;

create or replace function public.complete_refund(p_id uuid, p_ok boolean, p_mp_refund_id text default null, p_error text default null) returns public.payment_refunds
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payment_refunds;
begin
  select * into r from public.payment_refunds where id = p_id for update;
  if not found then raise exception 'refund_not_found' using errcode = 'P0001'; end if;
  if r.status <> 'pendiente' then return r; end if;
  update public.payment_refunds set claimed_at = null,
    status = case when p_ok then 'hecho' when attempts >= 6 then 'fallido' else 'pendiente' end,
    mp_refund_id = case when p_ok then left(p_mp_refund_id, 60) else mp_refund_id end,
    error = case when p_ok then null else left(p_error, 500) end,
    done_at = case when p_ok then public.app_now() end,
    next_attempt_at = case when not p_ok and attempts < 6 then public.app_now() + make_interval(mins => power(2, attempts)::int) else next_attempt_at end
  where id = p_id returning * into r;
  if p_ok then
    update public.payment_intents set status = 'reembolsado', updated_at = public.app_now()
    where mp_payment_id = r.mp_payment_id and status in ('reembolsar','discrepancia');
  end if;
  return r;
end $$;

-- ------------------------------------------------------------------------------
-- Pagos a músicos (transferencia manual por ahora) y alias de cobro
-- ------------------------------------------------------------------------------
create or replace function public.set_payout_alias(p_alias text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles; a text := nullif(btrim(coalesce(p_alias, '')), '');
begin
  p := public.current_profile();
  if p.role <> 'musico' then raise exception 'forbidden_role' using errcode = 'P0001'; end if;
  if a is not null and not public.valid_payout_alias(a) then raise exception 'invalid_alias' using errcode = 'P0001'; end if;
  update public.profiles set payout_alias = a where user_id = p.user_id;
  update public.payouts set alias_snapshot = a where user_id = p.user_id and status = 'pendiente';
end $$;

create or replace function public.admin_mark_payout_paid(p_payout_id uuid, p_reference text) returns public.payouts
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.payouts;
begin
  if p_reference is null or char_length(btrim(p_reference)) not between 3 and 100 then raise exception 'invalid_reference' using errcode = 'P0001'; end if;
  select * into r from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'payout_not_found' using errcode = 'P0001'; end if;
  if r.status = 'pagado' then return r; end if;
  if r.alias_snapshot is null then raise exception 'alias_missing' using errcode = 'P0001'; end if;
  update public.payouts set status = 'pagado', reference = btrim(p_reference), paid_at = public.app_now() where id = r.id returning * into r;
  perform public._notify(r.user_id, 'payout_paid', 'Te transferimos tu cobro', 'Te transferimos $' || r.amount_ars || ' (ref. ' || r.reference || ').', r.booking_id);
  return r;
end $$;

-- ------------------------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------------------------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_enqueue_refund','_after_settle','begin_payment','attach_preference','confirm_payment_intent',
             'expire_stale_intents','claim_pending_refunds','complete_refund','set_payout_alias','admin_mark_payout_paid')
  loop execute format('revoke all on function %s from public, anon, authenticated', f); end loop;
end $$;
grant execute on function public.begin_payment(uuid) to authenticated;
grant execute on function public.set_payout_alias(text) to authenticated;
