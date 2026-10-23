import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import webpush from 'web-push';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, asSystem, checkInvariants, H, D, type Actor, type Api } from '../db/helpers.ts';
import { startFake, makeSubscription, verifyVapid, makeTlsCert, type Fake } from './fakes.ts';
import { runBatch, handleWorkerRequest, buildEmail, buildPush, escapeHtml, oneLine, safeEqual, type Deps } from '../../supabase/functions/_shared/delivery.ts';
import { resendSender, webPushSender, supabaseQueue } from '../../supabase/functions/_shared/providers.ts';

const DB = 'suenaba_pipeline';
let pool: pg.Pool, A: Api, resend: Fake, push: Fake;
let bar1: Actor, m1: Actor, m2: Actor;
const vapid = webpush.generateVAPIDKeys();
const tls = makeTlsCert();
const pushAgent = new https.Agent({ ca: tls.cert });
const clock = { now: undefined as Date | undefined };
const mins = (n: number) => new Date(Date.now() + n * 60_000);
const day = (n: number) => new Date(Date.now() + n * D);

/** Cliente "service role" mínimo sobre Postgres real, con reloj controlable. */
const serviceRpc = {
  async rpc(fn: string, args: Record<string, unknown> = {}) {
    const keys = Object.keys(args);
    try {
      const rows = await asSystem(pool, async (c) => (await c.query(`select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map((k) => args[k]))).rows, { now: clock.now });
      if (rows.length === 1 && Object.keys(rows[0]).length === 1 && fn in rows[0]) return { data: rows[0][fn], error: null };
      return { data: rows, error: null };
    } catch (e: any) { return { data: null, error: { message: e.message } }; }
  },
};
function makeDeps(over: Partial<Deps> = {}): Deps {
  webpush.setVapidDetails('mailto:equipo@suenaba.test', vapid.publicKey, vapid.privateKey);
  return {
    appUrl: 'https://suenaba.test', ...supabaseQueue(serviceRpc),
    sendEmail: resendSender({ apiKey: 're_test_key', from: 'SuenaBA <avisos@suenaba.test>', baseUrl: resend.url }),
    sendPush: webPushSender(webpush, { agent: pushAgent }), ...over,
  };
}
let dayCursor = 10;
async function mkNotifs(n: number, who: Actor = m1) {
  for (let i = 0; i < n; i++) { const s = day(dayCursor++); const l = await A.createListing(bar1, { starts: s, ends: new Date(s.getTime() + 3 * H), cachet: 1 } as any); await A.request(who, l.id); }
}
const subFor = async (a: Actor, name: string) => { const s = makeSubscription(`${push.url}/${name}`); await asSystem(pool, (c) => c.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)`, [a.userId, s.endpoint, s.p256dh, s.auth])); return s; };
const notif = async () => (await A.q('select * from notifications order by created_at, id'));
const emailBodies = () => resend.hits.map((h) => JSON.parse(h.body));

before(async () => { pool = await createTestDb(DB, 20); A = api(pool); });
after(async () => { await resend?.close(); await push?.close(); await dropTestDb(pool, DB); });
beforeEach(async () => {
  await resetData(pool); const w = await seedActors(pool, 1, 2); [bar1] = w.bars; [m1, m2] = w.mus; clock.now = undefined; dayCursor = 10;
  resend = await startFake();
  push = await startFake((req) => { const v = verifyVapid(req.headers.authorization, vapid.publicKey, new URL(push.url).origin); return v.ok ? { status: 201 } : { status: 403, body: v.reason }; }, tls);
});
afterEach(async () => { await resend.close(); await push.close(); const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Contenido de los avisos', () => {
  it('el email escapa HTML, limpia el asunto y valida el enlace', () => {
    const e = buildEmail({ id: 'n1', title: 'Hola\r\nBcc: evil@x.com <b>', body: '<img src=x onerror=alert(1)> & "comillas" \'simples\'' }, 'https://suenaba.test', 'a@b.com');
    assert.ok(!/[\r\n]/.test(e.subject)); assert.equal(e.subject, 'Hola Bcc: evil@x.com <b>');          // el asunto es texto plano
    assert.ok(!e.html.includes('<img') && !e.html.includes('<b>'));
    assert.ok(e.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;comillas&quot; &#39;simples&#39;'));
    assert.equal(e.idempotencyKey, 'n1'); assert.match(e.text, /Abrí SuenaBA: https:\/\/suenaba\.test/);
    assert.ok(buildEmail({ id: 'n', title: 't', body: 'b' }, 'javascript:alert(1)', 'a@b.com').html.includes('href="https://suenaba.app"'));
    assert.ok(buildEmail({ id: 'n', title: 't', body: 'b' }, 'https://x.com/"><script>', 'a@b.com').html.includes('href="https://suenaba.app"'));
    assert.equal(buildEmail({ id: 'n', title: '', body: 'b' }, 'https://x.com', 'a@b.com').subject, 'Aviso de SuenaBA');
  });
  it('el push se acorta a lo que entra en una notificación y agrupa por reserva', () => {
    const p = buildPush({ title: 'T'.repeat(200), body: 'x'.repeat(500), kind: 'message', booking_id: 'b-1' }, 'https://suenaba.test');
    assert.ok(p.title.length <= 80 && p.body.length <= 140); assert.equal(p.tag, 'booking-b-1');
    assert.equal(buildPush({ title: 't', body: 'b', kind: 'search_match', booking_id: null }, 'https://x.com').tag, 'search_match');
  });
  it('utilidades: escapeHtml, oneLine y comparación de secretos', () => {
    assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(oneLine(' a\n\n b\u2028c ', 10), 'a b c');
    assert.ok(safeEqual('secreto-1234567890', 'secreto-1234567890')); assert.ok(!safeEqual('secreto-1234567890', 'secreto-1234567891')); assert.ok(!safeEqual('a', '')); assert.ok(!safeEqual('', 'a'));
  });
});

describe('Entrega de punta a punta (Postgres real + Resend y push falsos)', () => {
  it('un aviso llega por email y por push a todos los dispositivos, con firma VAPID válida', async () => {
    await subFor(bar1, 'tel'); await subFor(bar1, 'notebook');
    await mkNotifs(1);
    const st = await runBatch(makeDeps());
    assert.deepEqual([st.claimed, st.delivered, st.emails, st.pushes, st.retried], [1, 1, 1, 1, 0]);
    assert.equal(resend.hits.length, 1);
    const h = resend.hits[0], mail = JSON.parse(h.body);
    assert.equal(h.headers.authorization, 'Bearer re_test_key');
    assert.equal(h.headers['idempotency-key'], (await notif())[0].id);
    assert.deepEqual([mail.from, mail.to, mail.subject], ['SuenaBA <avisos@suenaba.test>', [`${bar1.entityId}@t.com`], 'Nueva solicitud']);
    assert.match(mail.html, /Músico 1/);
    assert.equal(push.hits.length, 2);                                                               // un push por dispositivo
    for (const p of push.hits) { assert.equal(p.headers['content-encoding'], 'aes128gcm'); assert.ok(p.raw.length > 50); assert.equal(p.headers.ttl, '86400'); }
    const n = (await notif())[0];
    assert.deepEqual([n.delivered_at !== null, n.email_sent_at !== null, n.push_sent_at !== null, n.failed_at], [true, true, true, null]);
    assert.notEqual((await A.q('select last_success_at from push_subscriptions limit 1'))[0].last_success_at, null);
    assert.equal((await runBatch(makeDeps())).claimed, 0);                                           // cola vacía
  });

  it('respeta las preferencias: sin email, sin push, tipos silenciados y tipos que no van por email', async () => {
    await subFor(bar1, 'tel');
    await A.setNotifPrefs(bar1, { email: false }); await mkNotifs(1); await runBatch(makeDeps());
    assert.deepEqual([resend.hits.length, push.hits.length], [0, 1]);
    resend.reset(); push.reset();
    await A.setNotifPrefs(bar1, { email: true, push: false }); await mkNotifs(1); await runBatch(makeDeps());
    assert.deepEqual([resend.hits.length, push.hits.length], [1, 0]);
    resend.reset(); push.reset();
    await A.setNotifPrefs(bar1, { push: true, muted: ['booking_requested'] }); await mkNotifs(1); await runBatch(makeDeps());
    assert.deepEqual([resend.hits.length, push.hits.length], [0, 0]);                                  // silenciado
    assert.equal((await notif()).filter((n) => n.delivered_at === null).length, 0);                    // pero queda "resuelto"
    // mensajes: solo push (no email)
    await A.setNotifPrefs(bar1, { muted: [] });
    const s = day(30); const l = await A.createListing(bar1, { starts: s, ends: new Date(s.getTime() + 3 * H), cachet: 1 } as any); const b = await A.request(m2, l.id);
    await runBatch(makeDeps()); resend.reset(); push.reset();
    await A.message(m2, b.id, 'Hola, ¿hay backline?'); await runBatch(makeDeps());
    assert.deepEqual([resend.hits.length, push.hits.length], [0, 1]);
  });

  it('un usuario sin email ni dispositivos igual se da por entregado (no queda en cola para siempre)', async () => {
    await asSystem(pool, (c) => c.query(`update auth.users set email = null where id = $1`, [bar1.userId]));
    await mkNotifs(2); const st = await runBatch(makeDeps());
    assert.deepEqual([st.delivered, resend.hits.length, push.hits.length], [2, 0, 0]);
    assert.equal((await runBatch(makeDeps())).claimed, 0);
  });

  it('el contenido malicioso de un nombre no inyecta HTML ni cabeceras en el email', async () => {
    await A.q(`update musicians set stage_name = $1 where id = $2`, ['<img src=x onerror=alert(1)>\r\nBcc: evil@x.com', m1.entityId]);
    await mkNotifs(1); await runBatch(makeDeps());
    const mail = emailBodies()[0];
    assert.ok(!mail.html.includes('<img')); assert.ok(mail.html.includes('&lt;img src=x onerror=alert(1)&gt;')); assert.ok(!/[\r\n]/.test(mail.subject));
  });

  it('email caído: reintenta con espera, no repite el push y la clave de idempotencia es la misma', async () => {
    await subFor(bar1, 'tel'); await mkNotifs(1);
    resend.handler.fn = (_r, _b, n) => (n <= 2 ? { status: 500, body: 'boom' } : { status: 200, body: '{}' });
    let st = await runBatch(makeDeps());
    assert.deepEqual([st.delivered, st.retried, st.pushes, push.hits.length], [0, 1, 1, 1]);
    let n = (await notif())[0]; assert.deepEqual([n.delivered_at, n.push_sent_at !== null, n.email_sent_at, n.delivery_attempts], [null, true, null, 1]); assert.match(n.delivery_error, /email: resend 500/);
    assert.equal((await runBatch(makeDeps())).claimed, 0);                                           // todavía en espera
    clock.now = mins(3); st = await runBatch(makeDeps());
    assert.deepEqual([st.retried, st.pushes], [1, 0]);                                               // reintento 2: falla otra vez
    clock.now = mins(3 + 5); st = await runBatch(makeDeps());
    assert.deepEqual([st.delivered, st.emails], [1, 1]);
    n = (await notif())[0]; assert.deepEqual([n.delivered_at !== null, n.email_sent_at !== null, n.delivery_attempts, n.delivery_error], [true, true, 3, null]);
    assert.equal(push.hits.length, 1, 'el push no se repite en los reintentos');
    assert.equal(new Set(resend.hits.map((h) => h.headers['idempotency-key'])).size, 1);
    assert.equal(resend.hits.length, 3);
  });

  it('email que nunca funciona: a los 5 intentos queda como fallido con el motivo', async () => {
    await mkNotifs(1); resend.handler.fn = () => ({ status: 503, body: 'sin servicio' });
    let t = 0;
    for (const wait of [0, 2, 4, 8, 16]) { t += wait; clock.now = mins(t + 0.1); await runBatch(makeDeps()); }
    const n = (await notif())[0];
    assert.deepEqual([n.delivery_attempts, n.failed_at !== null, n.delivered_at], [5, true, null]); assert.match(n.delivery_error, /resend 503/);
    clock.now = mins(10_000); assert.equal((await runBatch(makeDeps())).claimed, 0);
    assert.equal(resend.hits.length, 5);
  });

  it('dispositivos dados de baja (404/410) se eliminan; si hay otro que sí recibe, alcanza', async () => {
    const gone = await subFor(bar1, 'viejo'), alive = await subFor(bar1, 'nuevo'), alsoGone = await subFor(bar1, 'otro');
    push.handler.fn = (req) => (req.url!.endsWith('/viejo') ? { status: 410 } : req.url!.endsWith('/otro') ? { status: 404 } : { status: 201 });
    await mkNotifs(1); const st = await runBatch(makeDeps());
    assert.deepEqual([st.delivered, st.droppedDevices, st.pushes], [1, 2, 1]);
    assert.deepEqual((await A.q('select endpoint from push_subscriptions')).map((r) => r.endpoint), [alive.endpoint]);
    assert.ok(gone && alsoGone);
  });

  it('si todos los dispositivos están dados de baja se da por entregado; si fallan de forma transitoria, se reintenta', async () => {
    await subFor(bar1, 'a'); push.handler.fn = () => ({ status: 410 });
    await mkNotifs(1); assert.equal((await runBatch(makeDeps())).delivered, 1);
    assert.equal((await A.q('select count(*)::int n from push_subscriptions'))[0].n, 0);
    await subFor(bar1, 'b'); push.handler.fn = () => ({ status: 503 });
    await mkNotifs(1); const st = await runBatch(makeDeps());
    assert.deepEqual([st.delivered, st.retried], [0, 1]);
    assert.equal((await A.q('select count(*)::int n from push_subscriptions'))[0].n, 1);               // no se borra por un error transitorio
    assert.match((await notif()).at(-1).delivery_error, /push:/);
  });

  it('un servicio push que rechaza la firma VAPID se detecta (la prueba no es un sello de goma)', async () => {
    await subFor(bar1, 'tel'); await mkNotifs(1);
    const other = webpush.generateVAPIDKeys();
    push.handler.fn = (req) => { const v = verifyVapid(req.headers.authorization, other.publicKey, new URL(push.url).origin); return v.ok ? { status: 201 } : { status: 403 }; };
    const st = await runBatch(makeDeps());
    assert.deepEqual([st.delivered, st.retried], [0, 1]);
  });

  it('4 workers a la vez entregan cada aviso una sola vez (sin emails ni push duplicados)', async () => {
    await subFor(bar1, 'tel'); await subFor(m1, 'm1tel'); await mkNotifs(20);
    const stats = await Promise.all([1, 2, 3, 4].map(() => runBatch(makeDeps(), 7)));
    let guard = 0; while ((await runBatch(makeDeps(), 50)).claimed > 0 && guard++ < 5);
    assert.equal(stats.reduce((a, s) => a + s.errors, 0), 0);
    const keys = resend.hits.map((h) => h.headers['idempotency-key'] as string);
    assert.equal(keys.length, 20); assert.equal(new Set(keys).size, 20, 'email duplicado');
    assert.equal(push.hits.length, 20, 'push duplicado');
    assert.equal((await notif()).filter((n) => n.delivered_at === null).length, 0);
  });

  it('si un worker muere a mitad, sus avisos se recuperan a los 10 minutos', async () => {
    await mkNotifs(3);
    const claimed = await makeDeps().claim(10); assert.equal(claimed.length, 3);                       // "murió" sin completar
    assert.equal((await runBatch(makeDeps())).claimed, 0);
    clock.now = mins(11); const st = await runBatch(makeDeps());
    assert.deepEqual([st.claimed, st.delivered], [3, 3]);
  });

  it('un fallo del servicio de base de datos al completar no pierde el aviso', async () => {
    await mkNotifs(1);
    const st = await runBatch(makeDeps({ complete: async () => { throw new Error('db caída'); } }));
    assert.deepEqual([st.errors, st.delivered], [1, 0]);
    clock.now = mins(11); assert.equal((await runBatch(makeDeps())).delivered, 1);                     // se reclama sola
  });
});

describe('Endpoint del worker', () => {
  const call = (secret: string | null, method = 'POST', deps = makeDeps(), cfg: Record<string, unknown> = {}) =>
    handleWorkerRequest(new Request('https://x.test/notify-worker', { method, headers: secret === null ? {} : { 'x-worker-secret': secret } }), { secret: 'secreto-compartido-123', deps, ...cfg });
  it('rechaza sin secreto, con secreto incorrecto o con otro método, y no procesa nada', async () => {
    await mkNotifs(1);
    assert.equal((await call(null)).status, 403); assert.equal((await call('mal-secreto-1234567')).status, 403); assert.equal((await call('secreto-compartido-123', 'GET')).status, 405);
    assert.equal((await handleWorkerRequest(new Request('https://x.test', { method: 'POST' }), { secret: 'corto', deps: makeDeps() })).status, 500);   // mal configurado
    assert.equal(resend.hits.length, 0); assert.equal((await notif())[0].delivery_attempts, 0);
  });
  it('con el secreto correcto procesa varios lotes hasta vaciar la cola y devuelve estadísticas', async () => {
    await subFor(bar1, 'tel'); await mkNotifs(12);
    const res = await call('secreto-compartido-123', 'POST', makeDeps(), { batchSize: 5, maxBatches: 10 });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual([j.claimed, j.delivered, j.emails, j.pushes], [12, 12, 12, 12]);
  });
  it('tope de lotes por invocación (para no exceder el tiempo de la función)', async () => {
    await mkNotifs(12);
    const j = await (await call('secreto-compartido-123', 'POST', makeDeps(), { batchSize: 5, maxBatches: 2 })).json();
    assert.equal(j.claimed, 10);
    assert.equal((await A.q('select count(*)::int n from notifications where delivered_at is null'))[0].n, 2);
  });
});
