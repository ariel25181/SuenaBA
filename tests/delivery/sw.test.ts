import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/** Carga public/push-sw.js en un "service worker" falso y devuelve lo necesario para dispararle eventos. */
function loadSw(windows: { focus: () => Promise<unknown> }[] = []) {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: any[] = [], opened: string[] = [], focused: number[] = [];
  const self: any = {
    location: new URL('https://app.suenaba.test/'),
    addEventListener: (t: string, h: any) => { handlers[t] = h; },
    registration: { showNotification: async (title: string, o: any) => { shown.push({ title, ...o }); } },
    clients: {
      matchAll: async () => windows.map((w, i) => ({ focus: async () => { focused.push(i); return w.focus(); } })),
      openWindow: async (u: string) => { opened.push(u); },
    },
  };
  vm.runInNewContext(fs.readFileSync('public/push-sw.js', 'utf8'), { self, URL, String, Promise });
  const fire = async (type: string, ev: Record<string, unknown>) => { let p: Promise<unknown> = Promise.resolve(); handlers[type]({ ...ev, waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  return { fire, shown, opened, focused, handlers };
}
const pushEv = (data: unknown) => ({ data: { json: () => (typeof data === 'string' ? JSON.parse(data) : data), text: () => String(data) } });

test('push: muestra la notificación con título, texto, agrupación y destino', async () => {
  const sw = loadSw();
  await sw.fire('push', pushEv({ title: 'Nueva solicitud', body: 'Músico 1 quiere tocar el 30/10', tag: 'booking-1', url: 'https://app.suenaba.test/', kind: 'booking_requested' }));
  assert.equal(sw.shown.length, 1);
  assert.deepEqual([sw.shown[0].title, sw.shown[0].body, sw.shown[0].tag, sw.shown[0].data.url, sw.shown[0].icon], ['Nueva solicitud', 'Músico 1 quiere tocar el 30/10', 'booking-1', 'https://app.suenaba.test/', 'pwa-192x192.png']);
});
test('push: tolera datos vacíos o inválidos y recorta textos largos', async () => {
  const sw = loadSw();
  await sw.fire('push', { data: null });
  await sw.fire('push', { data: { json: () => { throw new Error('no es json'); }, text: () => 'texto plano' } });
  await sw.fire('push', pushEv({ title: 'T'.repeat(300), body: 'B'.repeat(900) }));
  assert.deepEqual([sw.shown[0].title, sw.shown[0].body], ['SuenaBA', '']);
  assert.deepEqual([sw.shown[1].title, sw.shown[1].body], ['SuenaBA', 'texto plano']);
  assert.ok(sw.shown[2].title.length <= 80 && sw.shown[2].body.length <= 200);
});
test('clic: enfoca la ventana abierta o abre una nueva; cierra la notificación', async () => {
  let closed = 0;
  const a = loadSw([{ focus: async () => {} }]);
  await a.fire('notificationclick', { notification: { close: () => closed++, data: { url: 'https://app.suenaba.test/' } } });
  assert.deepEqual([a.focused, a.opened, closed], [[0], [], 1]);
  const b = loadSw([]);
  await b.fire('notificationclick', { notification: { close: () => closed++, data: { url: 'https://app.suenaba.test/#reservas' } } });
  assert.deepEqual([b.opened, closed], [['https://app.suenaba.test/#reservas'], 2]);
});
test('clic: nunca abre esquemas peligrosos (javascript:, data:) ni urls inválidas', async () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'http://evil.test/', undefined, '//[::']) {
    const sw = loadSw([]);
    await sw.fire('notificationclick', { notification: { close: () => {}, data: bad === undefined ? undefined : { url: bad } } });
    assert.ok(sw.opened[0] === 'https://app.suenaba.test/' || /^https:\/\/app\.suenaba\.test\//.test(sw.opened[0]), `abrió ${sw.opened[0]} para ${bad}`);
  }
});
