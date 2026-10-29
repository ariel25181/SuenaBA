import type { EmailMessage, PushPayload, PushResult, Sub, Deps, Notif, Target } from './delivery.ts';

/** Email por Resend (https://resend.com/docs/api-reference/emails/send-email). La Idempotency-Key evita duplicados en reintentos. */
export function resendSender(opts: { apiKey: string; from: string; baseUrl?: string; fetch?: typeof fetch }) {
  const f = opts.fetch ?? fetch, base = opts.baseUrl ?? 'https://api.resend.com';
  return async (m: EmailMessage): Promise<void> => {
    const res = await f(`${base}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
      body: JSON.stringify({ from: opts.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

/** Web Push (VAPID). 404/410 = el dispositivo ya no existe → 'gone'. Otros errores se reintentan. */
export function webPushSender(webpush: { sendNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts?: Record<string, unknown>): Promise<unknown> }, extraOptions: Record<string, unknown> = {}) {
  return async (sub: Sub, payload: PushPayload): Promise<PushResult> => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 86_400, urgency: 'normal', timeout: 10_000, ...extraOptions });
      return 'ok';
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) return 'gone';
      throw e;
    }
  };
}

type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> };
/** Conecta la cola de Supabase (RPC con service role) con el worker. */
export function supabaseQueue(client: Rpc): Pick<Deps, 'claim' | 'getTarget' | 'dropEndpoint' | 'markPushSuccess' | 'complete'> {
  const call = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await client.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };
  return {
    claim: async (limit) => ((await call('claim_pending_notifications', { p_limit: limit })) ?? []) as Notif[],
    getTarget: async (userId) => { const d = await call('get_delivery_target', { p_user: userId }); const r = Array.isArray(d) ? d[0] : d; return (r ?? null) as Target | null; },
    dropEndpoint: async (endpoint) => { await call('drop_push_endpoint', { p_endpoint: endpoint }); },
    markPushSuccess: async (endpoint) => { await call('mark_push_success', { p_endpoint: endpoint }); },
    complete: async (id, r) => { await call('complete_notification_delivery', { p_id: id, p_ok: r.ok, p_error: r.error, p_email_sent: r.emailSent, p_push_sent: r.pushSent }); },
  };
}
