import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Ejecuta el script con una "supabase" y un "npx" falsos que registran lo que reciben. */
function run(env: Record<string, string>, args: string[] = [], existingSecrets = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(path.join(dir, 'supabase'), `#!/usr/bin/env bash\nif [ "$1" = "secrets" ] && [ "$2" = "list" ]; then printf '%s' "$FAKE_EXISTING"; exit 0; fi\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'npx'), `#!/usr/bin/env bash\necho '{"publicKey":"PUB_KEY_FAKE_123","privateKey":"PRIV_KEY_FAKE_456"}'\n`, { mode: 0o755 });
  const r = spawnSync('bash', ['scripts/configurar-secretos.sh', ...args], {
    encoding: 'utf8', env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, NO_PROMPT: '1', FAKE_EXISTING: existingSecrets, SUPABASE_BIN: path.join(dir, 'supabase'), NPX_BIN: path.join(dir, 'npx'), ...env },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
  return { ...r, calls };
}
const BASE = { APP_URL: 'https://suenaba.test', CONTACT_EMAIL: 'yo@suenaba.test', RESEND_API_KEY: 're_SECRETO_UNO', EMAIL_FROM: 'SuenaBA <a@suenaba.test>', MP_ACCESS_TOKEN: 'APP_USR-SECRETO_DOS', MP_WEBHOOK_SECRET: 'WEBHOOK_SECRETO_TRES' };

test('primera vez: carga todos los secretos, genera VAPID y worker, e imprime el SQL y la clave pública', () => {
  const r = run(BASE);
  assert.equal(r.status, 0, r.stderr);
  for (const k of ['APP_URL=https://suenaba.test', 'WORKER_SECRET=', 'VAPID_PUBLIC_KEY=PUB_KEY_FAKE_123', 'VAPID_PRIVATE_KEY=PRIV_KEY_FAKE_456', 'VAPID_SUBJECT=mailto:yo@suenaba.test',
    'RESEND_API_KEY=re_SECRETO_UNO', 'EMAIL_FROM=SuenaBA <a@suenaba.test>', 'MP_ACCESS_TOKEN=APP_USR-SECRETO_DOS', 'MP_WEBHOOK_SECRET=WEBHOOK_SECRETO_TRES', 'MP_SANDBOX=true'])
    assert.ok(r.calls.includes(k), `falta ${k}`);
  assert.match(r.calls, /secrets set --project-ref dncmdvxcxizbcjacpkoe /);
  assert.match(r.stdout, /VITE_VAPID_PUBLIC_KEY\n\s+PUB_KEY_FAKE_123/);
  assert.match(r.stdout, /cron\.schedule\('suenaba-avisos'/); assert.match(r.stdout, /process-refunds/); assert.match(r.stdout, /mp-webhook/);
  const worker = /WORKER_SECRET=([0-9a-f]{48})/.exec(r.calls)![1];
  assert.ok(r.stdout.includes(`vault.create_secret('${worker}', 'worker_secret')`), 'el SQL usa el mismo secreto que se cargó');
});

test('nunca muestra en pantalla las claves privadas ni los tokens', () => {
  const r = run(BASE);
  for (const s of ['re_SECRETO_UNO', 'APP_USR-SECRETO_DOS', 'WEBHOOK_SECRETO_TRES', 'PRIV_KEY_FAKE_456']) { assert.ok(!r.stdout.includes(s), `se filtró ${s} en stdout`); assert.ok(!r.stderr.includes(s), `se filtró ${s} en stderr`); }
});

test('si ya hay claves VAPID y secreto, no las regenera (no rompe los dispositivos ya suscriptos)', () => {
  const r = run({ APP_URL: 'https://suenaba.test' }, [], 'VAPID_PRIVATE_KEY  abc\nWORKER_SECRET  def\n');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.calls.includes('VAPID_'), 'no debe tocar VAPID'); assert.ok(!r.calls.includes('WORKER_SECRET'), 'no debe tocar WORKER_SECRET');
  assert.match(r.stdout, /ya existen: no se tocan/); assert.ok(!/cron\.schedule/.test(r.stdout));
  const rot = run({ APP_URL: 'https://suenaba.test', ROTATE_VAPID: '1' }, [], 'VAPID_PRIVATE_KEY  abc\nWORKER_SECRET  def\n');
  assert.ok(rot.calls.includes('VAPID_PRIVATE_KEY=PRIV_KEY_FAKE_456'));
});

test('--dry-run no cambia nada y avisa de lo que falta', () => {
  const r = run({ APP_URL: 'https://suenaba.test' }, ['--dry-run']);
  assert.equal(r.status, 0); assert.equal(r.calls, ''); assert.match(r.stdout, /--dry-run: no se cambió nada/);
  const ok = run({ APP_URL: 'https://suenaba.test' });
  assert.match(ok.stdout, /no cargaste RESEND_API_KEY/); assert.match(ok.stdout, /no cargaste MP_ACCESS_TOKEN/);
});

test('valida la URL y la presencia de herramientas', () => {
  assert.notEqual(run({}).status, 0);                                          // falta APP_URL
  const bad = run({ APP_URL: 'http://inseguro.test' }); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /https/);
  const nosb = run({ APP_URL: 'https://suenaba.test', SUPABASE_BIN: '/no/existe/supabase' }); assert.notEqual(nosb.status, 0); assert.match(nosb.stderr, /Supabase CLI/);
});
