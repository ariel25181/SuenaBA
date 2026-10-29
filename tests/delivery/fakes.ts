import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface Hit { url: string; headers: http.IncomingHttpHeaders; body: string; raw: Buffer; at: number }
export interface Fake { url: string; hits: Hit[]; close(): Promise<void>; reset(): void; handler: { fn: (req: http.IncomingMessage, body: string, n: number) => { status: number; body?: string } } }

/** Servidor HTTP local que registra cada pedido y responde lo que el test indique. */
export interface Tls { key: string; cert: string }
/** Certificado autofirmado para 127.0.0.1 (los servicios push reales siempre usan HTTPS). */
export function makeTlsCert(): Tls {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suenaba-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: fs.readFileSync(`${dir}/k.pem`, 'utf8'), cert: fs.readFileSync(`${dir}/c.pem`, 'utf8') };
}

export async function startFake(initial: Fake['handler']['fn'] = () => ({ status: 200, body: '{}' }), tls?: Tls): Promise<Fake> {
  const hits: Hit[] = [];
  const handler = { fn: initial };
  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks), body = raw.toString('utf8');
      hits.push({ url: req.url ?? '', headers: req.headers, body, raw, at: Date.now() });
      const r = handler.fn(req, body, hits.length);
      res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(r.body ?? '');
    });
  };
  const server = tls ? https.createServer(tls, onRequest) : http.createServer(onRequest);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as AddressInfo).port;
  return { url: `${tls ? 'https' : 'http'}://127.0.0.1:${port}`, hits, handler, reset: () => { hits.length = 0; }, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }) };
}

const b64u = (b: Buffer) => b.toString('base64url');
/** Una suscripción push "de navegador": clave pública P-256 y secreto de autenticación válidos. */
export function makeSubscription(endpoint: string) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { endpoint, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(crypto.randomBytes(16)) };
}

/** Verifica la firma ES256 del header Authorization de VAPID (lo que valida un servicio push real). */
export function verifyVapid(authHeader: string | undefined, publicKeyB64u: string, expectedAud: string): { ok: boolean; reason?: string; sub?: string } {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(authHeader ?? '');
  if (!m) return { ok: false, reason: 'formato' };
  if (m[2] !== publicKeyB64u) return { ok: false, reason: 'clave distinta' };
  const [h, p, s] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (claims.aud !== expectedAud) return { ok: false, reason: `aud ${claims.aud}` };
  if (claims.exp * 1000 < Date.now()) return { ok: false, reason: 'vencido' };
  const raw = Buffer.from(publicKeyB64u, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  return ok ? { ok, sub: claims.sub } : { ok: false, reason: 'firma' };
}
