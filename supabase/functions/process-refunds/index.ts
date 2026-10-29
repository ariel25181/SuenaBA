// Edge Function (Deno): devuelve a los bares el dinero de reembolsos pendientes y vence intenciones de pago sin usar.
// Programala cada 5 minutos (pg_cron / Supabase Cron):  POST /functions/v1/process-refunds  con el header x-worker-secret.
// Secrets: WORKER_SECRET, MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_URL, MP_WEBHOOK_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleRefundsRequest } from '../_shared/payments.ts';
import { supabasePayDeps } from '../_shared/paymentsSupabase.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

Deno.serve((req) => handleRefundsRequest(req, {
  secret: env('WORKER_SECRET'),
  deps: {
    mp: { accessToken: env('MP_ACCESS_TOKEN') }, appUrl: env('APP_URL'), functionsUrl: `${env('SUPABASE_URL')}/functions/v1`, webhookSecret: env('MP_WEBHOOK_SECRET'),
    ...supabasePayDeps(admin, () => admin),
  },
}));
