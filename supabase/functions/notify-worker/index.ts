// Edge Function (Deno): envía los avisos pendientes por email (Resend) y push (Web Push).
// Se programa con pg_cron / Supabase Cron cada 1 minuto:  POST /functions/v1/notify-worker  con el header x-worker-secret.
//
// Variables de entorno (supabase secrets set ...):
//   WORKER_SECRET            secreto compartido (mínimo 16 caracteres)
//   RESEND_API_KEY, EMAIL_FROM   p. ej. "SuenaBA <avisos@tudominio.com>" (dominio verificado en Resend)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   (npx web-push generate-vapid-keys); subject = "mailto:vos@tudominio.com"
//   APP_URL                  https://tu-sitio  (link de los emails y de las notificaciones push)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (los inyecta Supabase)
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { handleWorkerRequest } from '../_shared/delivery.ts';
import { resendSender, supabaseQueue, webPushSender } from '../_shared/providers.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

Deno.serve((req) => handleWorkerRequest(req, {
  secret: env('WORKER_SECRET'),
  deps: {
    appUrl: env('APP_URL'),
    ...supabaseQueue(admin),
    sendEmail: resendSender({ apiKey: env('RESEND_API_KEY'), from: env('EMAIL_FROM') }),
    sendPush: webPushSender(webpush),
  },
}));
