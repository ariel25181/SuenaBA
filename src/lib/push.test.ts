import test from 'node:test';
import assert from 'node:assert/strict';
import { disablePush, enablePush, pushState, urlBase64ToUint8Array, type PushEnv, type PushSub } from './push.ts';

function fakeEnv(o: { permission?: 'default' | 'granted' | 'denied' | 'unsupported'; key?: string; ask?: 'granted' | 'denied' | 'default'; existing?: boolean } = {}) {
  const log = { asked: 0, subscribed: [] as any[], unsubscribed: 0 };
  let perm = o.permission ?? 'default';
  const mk = (endpoint: string): PushSub => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) } }), unsubscribe: async () => { log.unsubscribed++; sub = null; return true; } });
  let sub: PushSub | null = o.existing ? mk('https://push.test/old') : null;
  const env: PushEnv = {
    vapidKey: o.key ?? 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
    userAgent: 'test-agent',
    permission: () => perm,
    requestPermission: async () => { log.asked++; perm = o.ask ?? 'granted'; return perm as any; },
    registration: async () => ({ pushManager: { getSubscription: async () => sub, subscribe: async (opts) => { log.subscribed.push(opts); sub = mk('https://push.test/new'); return sub; } } }),
  };
  return { env, log };
}
const fakeApi = (fail = false) => { const calls: any[] = []; return { calls, api: { registerPush: async (s: any) => { calls.push(['reg', s]); if (fail) throw new Error('boom'); return 'id'; }, removePush: async (e: string) => { calls.push(['rm', e]); return true; } } as any }; };

test('decodifica la clave VAPID (base64url) a los 65 bytes de una clave P-256', () => {
  const k = urlBase64ToUint8Array('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U');
  assert.equal(k.length, 65); assert.equal(k[0], 4);
});
test('estados: sin soporte, sin clave, bloqueado, apagado y encendido', async () => {
  assert.equal(await pushState(fakeEnv({ permission: 'unsupported' }).env), 'unsupported');
  assert.equal(await pushState(fakeEnv({ key: '' }).env), 'no_key');
  assert.equal(await pushState(fakeEnv({ permission: 'denied' }).env), 'denied');
  assert.equal(await pushState(fakeEnv({ permission: 'granted' }).env), 'off');
  assert.equal(await pushState(fakeEnv({ permission: 'granted', existing: true }).env), 'on');
});
test('activar: pide permiso, se suscribe con la clave del servidor y registra el dispositivo', async () => {
  const { env, log } = fakeEnv(); const { api, calls } = fakeApi();
  assert.equal(await enablePush(api, env), 'on');
  assert.equal(log.asked, 1); assert.equal(log.subscribed[0].userVisibleOnly, true); assert.equal(log.subscribed[0].applicationServerKey.length, 65);
  assert.deepEqual(calls[0], ['reg', { endpoint: 'https://push.test/new', p256dh: 'P'.repeat(87), auth: 'A'.repeat(22), userAgent: 'test-agent' }]);
});
test('activar: no vuelve a pedir permiso si ya está concedido y reutiliza la suscripción', async () => {
  const { env, log } = fakeEnv({ permission: 'granted', existing: true }); const { api, calls } = fakeApi();
  assert.equal(await enablePush(api, env), 'on'); assert.equal(log.asked, 0); assert.equal(log.subscribed.length, 0); assert.equal(calls[0][1].endpoint, 'https://push.test/old');
});
test('activar: si el usuario rechaza, no se registra nada; si ya está bloqueado, ni siquiera pregunta', async () => {
  const a = fakeEnv({ ask: 'denied' }); const x = fakeApi();
  assert.equal(await enablePush(x.api, a.env), 'denied'); assert.equal(x.calls.length, 0); assert.equal(a.log.subscribed.length, 0);
  const b = fakeEnv({ permission: 'denied' }); assert.equal(await enablePush(fakeApi().api, b.env), 'denied'); assert.equal(b.log.asked, 0);
  const c = fakeEnv({ ask: 'default' }); assert.equal(await enablePush(fakeApi().api, c.env), 'off');
  assert.equal(await enablePush(fakeApi().api, fakeEnv({ permission: 'unsupported' }).env), 'unsupported');
  assert.equal(await enablePush(fakeApi().api, fakeEnv({ key: '' }).env), 'no_key');
});
test('activar: si el servidor rechaza el registro se cancela la suscripción nueva (sin huérfanas) y se informa el error', async () => {
  const { env, log } = fakeEnv(); const { api } = fakeApi(true);
  await assert.rejects(enablePush(api, env), /boom/); assert.equal(log.unsubscribed, 1);
  const k = fakeEnv({ permission: 'granted', existing: true }); await assert.rejects(enablePush(fakeApi(true).api, k.env), /boom/); assert.equal(k.log.unsubscribed, 0);   // una vieja no se toca
});
test('desactivar: avisa al servidor y cancela la suscripción del navegador', async () => {
  const { env, log } = fakeEnv({ permission: 'granted', existing: true }); const { api, calls } = fakeApi();
  assert.equal(await disablePush(api, env), 'off'); assert.deepEqual(calls[0], ['rm', 'https://push.test/old']); assert.equal(log.unsubscribed, 1);
  assert.equal(await disablePush(api, env), 'off');   // sin suscripción: no falla
});
