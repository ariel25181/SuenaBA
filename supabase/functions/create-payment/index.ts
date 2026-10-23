// Edge Function (Deno): crea el pago de una reserva en Mercado Pago y devuelve el link (init_point).
// La invoca la app con el JWT del bar:  supabase.functions.invoke('create-payment', { body: { booking_id } })
// Secrets: MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, APP_URL, MP_SANDBOX (opcional "true"), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleCreatePayment } from '../_shared/payments.ts';
import { supabasePayDeps } from '../_shared/paymentsSupabase.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const asUser = (jwt: string) => createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });

Deno.serve((req) => handleCreatePayment(req, {
  mp: { accessToken: env('MP_ACCESS_TOKEN'), sandbox: env('MP_SANDBOX') === 'true' },
  appUrl: env('APP_URL'), functionsUrl: `${env('SUPABASE_URL')}/functions/v1`, webhookSecret: env('MP_WEBHOOK_SECRET'),
  ...supabasePayDeps(admin, asUser),
}));
