import type { createBookingsApi } from './bookingsApi.ts';

type Api = ReturnType<typeof createBookingsApi>;

/** Lo que usamos del navegador (se puede reemplazar en los tests). */
export interface PushEnv {
  vapidKey: string;
  userAgent?: string;
  permission(): 'default' | 'granted' | 'denied' | 'unsupported';
  requestPermission(): Promise<'default' | 'granted' | 'denied'>;
  registration(): Promise<{ pushManager: { getSubscription(): Promise<PushSub | null>; subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<PushSub> } } | null>;
}
export interface PushSub { endpoint: string; toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; unsubscribe(): Promise<boolean> }

export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function browserPushEnv(): PushEnv {
  const g: any = globalThis;
  const env = (import.meta as any).env ?? {};
  return {
    vapidKey: env.VITE_VAPID_PUBLIC_KEY ?? '',
    userAgent: g.navigator?.userAgent,
    permission: () => (g.Notification && g.navigator?.serviceWorker && 'PushManager' in g ? g.Notification.permission : 'unsupported'),
    requestPermission: () => g.Notification.requestPermission(),
    registration: async () => { try { return (await g.navigator.serviceWorker.ready) ?? null; } catch { return null; } },
  };
}
let current: PushEnv | null = null;
export const getPushEnv = () => (current ??= browserPushEnv());
export const setPushEnv = (e: PushEnv | null) => { current = e; };

export type PushState = 'unsupported' | 'no_key' | 'denied' | 'off' | 'on';

/** Estado de las notificaciones en ESTE dispositivo. */
export async function pushState(env: PushEnv = getPushEnv()): Promise<PushState> {
  if (env.permission() === 'unsupported') return 'unsupported';
  if (!env.vapidKey) return 'no_key';
  if (env.permission() === 'denied') return 'denied';
  const reg = await env.registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && env.permission() === 'granted' ? 'on' : 'off';
}

export async function enablePush(api: Api, env: PushEnv = getPushEnv()): Promise<PushState> {
  const st = await pushState(env);
  if (st === 'unsupported' || st === 'no_key' || st === 'denied') return st;
  const perm = env.permission() === 'granted' ? 'granted' : await env.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await env.registration();
  if (!reg) return 'unsupported';
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(env.vapidKey) });
  const j = sub.toJSON();
  try {
    await api.registerPush({ endpoint: j.endpoint ?? sub.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '', userAgent: env.userAgent });
  } catch (e) {
    if (!existing) await sub.unsubscribe().catch(() => {});          // no dejamos una suscripción huérfana que el servidor no conoce
    throw e;
  }
  return 'on';
}

export async function disablePush(api: Api, env: PushEnv = getPushEnv()): Promise<PushState> {
  const reg = await env.registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) { const endpoint = sub.endpoint; await api.removePush(endpoint).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  return pushState(env);
}
