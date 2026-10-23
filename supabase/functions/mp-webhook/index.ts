// Edge Function (Deno): recibe los avisos de Mercado Pago. Debe ser PÚBLICA (Mercado Pago no envía JWT):
//   supabase functions deploy mp-webhook --no-verify-jwt
// La seguridad la da la firma x-signature (MP_WEBHOOK_SECRET) y que SIEMPRE se vuelve a consultar el pago a Mercado Pago.
// En el panel de Mercado Pago configurá la URL:  https://<proyecto>.supabase.co/functions/v1/mp-webhook  (evento "Pagos")
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleWebhook } from '../_shared/payments.ts';
import { supabasePayDeps } from '../_shared/paymentsSupabase.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

Deno.serve((req) => handleWebhook(req, {
  mp: { accessToken: env('MP_ACCESS_TOKEN'), sandbox: env('MP_SANDBOX') === 'true' },
  appUrl: env('APP_URL'), functionsUrl: `${env('SUPABASE_URL')}/functions/v1`, webhookSecret: env('MP_WEBHOOK_SECRET'),
  log: (m, x) => console.log(m, x ?? ''),
  ...supabasePayDeps(admin, () => admin),
}));
