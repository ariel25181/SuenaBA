/**
 * Entrega de avisos por email y push. Sin dependencias de runtime (corre igual en Deno y en Node):
 * todo lo externo entra por `Deps`, así se puede probar con servidores falsos.
 * Semántica "al menos una vez": cada canal se marca aparte para no repetirlo en un reintento.
 */
export interface Notif {
  id: string; user_id: string; kind: string; booking_id: string | null; listing_id: string | null;
  title: string; body: string; created_at: string; delivery_attempts: number; email_sent_at: string | null; push_sent_at: string | null;
}
export interface Sub { endpoint: string; p256dh: string; auth: string }
export interface Target { email: string | null; email_enabled: boolean; push_enabled: boolean; muted_kinds: string[]; subscriptions: Sub[] }
export interface PushPayload { title: string; body: string; tag: string; url: string; kind: string }
export type PushResult = 'ok' | 'gone';
export interface EmailMessage { to: string; subject: string; html: string; text: string; idempotencyKey: string }

export interface Deps {
  appUrl: string;
  claim(limit: number): Promise<Notif[]>;
  getTarget(userId: string): Promise<Target | null>;
  sendEmail(m: EmailMessage): Promise<void>;
  sendPush(sub: Sub, payload: PushPayload): Promise<PushResult>;
  dropEndpoint(endpoint: string): Promise<void>;
  markPushSuccess?(endpoint: string): Promise<void>;
  complete(id: string, r: { ok: boolean; error: string | null; emailSent: boolean; pushSent: boolean }): Promise<void>;
}

/** Por email solo lo importante; mensajes, alertas de búsqueda y recordatorios de reseña van solo por push/bandeja. */
export const NO_EMAIL_KINDS = new Set(['message', 'search_match', 'review_pending']);

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const oneLine = (s: string, max = 150) => s.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);
const safeUrl = (u: string) => (/^https:\/\/[^\s"'<>]+$/.test(u) || /^http:\/\/localhost(:\d+)?(\/[^\s"'<>]*)?$/.test(u) ? u : 'https://suenaba.app');

export function buildEmail(n: Pick<Notif, 'id' | 'title' | 'body'>, appUrl: string, to: string): EmailMessage {
  const url = safeUrl(appUrl), title = oneLine(n.title), body = n.body ?? '';
  const text = `${title}\n\n${body}\n\nAbrí SuenaBA: ${url}\n\nPodés cambiar qué avisos recibís desde Cuenta.`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1e293b;border-radius:16px;padding:24px;color:#e2e8f0">
<tr><td style="font-size:12px;color:#fbbf24;font-weight:bold">🎶 SuenaBA</td></tr>
<tr><td style="font-size:20px;font-weight:bold;padding:8px 0">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px;white-space:pre-wrap">${escapeHtml(body)}</td></tr>
<tr><td><a href="${escapeHtml(url)}" style="display:inline-block;background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:12px">Abrir SuenaBA</a></td></tr>
<tr><td style="font-size:11px;color:#94a3b8;padding-top:16px">Podés cambiar qué avisos recibís desde Cuenta.</td></tr>
</table></td></tr></table></body></html>`;
  return { to, subject: title || 'Aviso de SuenaBA', html, text, idempotencyKey: n.id };
}

export const buildPush = (n: Pick<Notif, 'title' | 'body' | 'kind' | 'booking_id'>, appUrl: string): PushPayload => ({
  title: truncate(oneLine(n.title, 80), 80), body: truncate(oneLine(n.body ?? '', 400), 140),
  tag: n.booking_id ? `booking-${n.booking_id}` : n.kind, url: safeUrl(appUrl), kind: n.kind,
});

const errMsg = (e: unknown) => oneLine(e instanceof Error ? e.message : String(e), 300);

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

export interface BatchStats { claimed: number; delivered: number; retried: number; emails: number; pushes: number; droppedDevices: number; errors: number }

export async function runBatch(d: Deps, limit = 50, concurrency = 5): Promise<BatchStats> {
  const st: BatchStats = { claimed: 0, delivered: 0, retried: 0, emails: 0, pushes: 0, droppedDevices: 0, errors: 0 };
  const items = await d.claim(limit);
  st.claimed = items.length;
  await mapLimit(items, concurrency, async (n) => {
    let emailSent = !!n.email_sent_at, pushSent = !!n.push_sent_at, error: string | null = null;
    try {
      const t = await d.getTarget(n.user_id);
      if (t && !t.muted_kinds.includes(n.kind)) {
        if (t.email_enabled && t.email && !NO_EMAIL_KINDS.has(n.kind) && !emailSent) {
          try { await d.sendEmail(buildEmail(n, d.appUrl, t.email)); emailSent = true; st.emails++; }
          catch (e) { error = `email: ${errMsg(e)}`; }
        }
        if (t.push_enabled && t.subscriptions.length > 0 && !pushSent) {
          const payload = buildPush(n, d.appUrl);
          let ok = 0, gone = 0, lastErr: string | null = null;
          for (const s of t.subscriptions) {
            try {
              if ((await d.sendPush(s, payload)) === 'ok') { ok++; await d.markPushSuccess?.(s.endpoint); }
              else { gone++; await d.dropEndpoint(s.endpoint); st.droppedDevices++; }
            } catch (e) { lastErr = errMsg(e); }
          }
          // Push es "mejor esfuerzo" multi-dispositivo: alcanza con que llegue a uno, o que todos hayan sido dados de baja.
          if (ok > 0 || gone === t.subscriptions.length) { pushSent = true; if (ok > 0) st.pushes++; }
          else error = error ? `${error}; push: ${lastErr}` : `push: ${lastErr}`;
        }
      }
    } catch (e) { error = errMsg(e); }
    try {
      await d.complete(n.id, { ok: error === null, error, emailSent, pushSent });
      error === null ? st.delivered++ : st.retried++;
    } catch { st.errors++; /* queda "en proceso": se reclama sola a los 10 minutos */ }
  });
  return st;
}

/** Compara en tiempo constante para no filtrar el secreto por tiempos de respuesta. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Endpoint del worker: solo POST con el secreto compartido; procesa lotes hasta vaciar la cola (máx. maxBatches). */
export async function handleWorkerRequest(req: Request, cfg: { secret: string; deps: Deps; batchSize?: number; maxBatches?: number }): Promise<Response> {
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (!cfg.secret || cfg.secret.length < 16) return json({ error: 'worker_not_configured' }, 500);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!safeEqual(req.headers.get('x-worker-secret') ?? '', cfg.secret)) return json({ error: 'forbidden' }, 403);
  const size = cfg.batchSize ?? 50, total: BatchStats = { claimed: 0, delivered: 0, retried: 0, emails: 0, pushes: 0, droppedDevices: 0, errors: 0 };
  for (let i = 0; i < (cfg.maxBatches ?? 4); i++) {
    const s = await runBatch(cfg.deps, size);
    for (const k of Object.keys(total) as (keyof BatchStats)[]) total[k] += s[k];
    if (s.claimed < size) break;
  }
  return json(total);
}
