/** Mercado Pago falso para pruebas: preferencias, consulta de pagos y reembolsos (idempotentes por clave). */
export const mp = { payments: new Map<string, any>(), prefFail: 0, lookupStatus: 0, refundFail: 0, prefs: 0, refundsByKey: new Map<string, string>(), refundCalls: [] as any[] };
export function mpHandler(req: any, body: string) {
  const url = req.url as string;
  if (req.headers.authorization !== 'Bearer APP_USR-test-token') return { status: 401, body: '{"message":"invalid token"}' };
  if (req.method === 'POST' && url === '/checkout/preferences') {
    if (mp.prefFail > 0) { mp.prefFail--; return { status: 500, body: '{"message":"boom"}' }; }
    mp.prefs++; return { status: 201, body: JSON.stringify({ id: `pref-${mp.prefs}`, init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-${mp.prefs}`, sandbox_init_point: `https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-${mp.prefs}` }) };
  }
  let m = /^\/v1\/payments\/([^/]+)$/.exec(url);
  if (req.method === 'GET' && m) {
    if (mp.lookupStatus) return { status: mp.lookupStatus, body: '{"message":"x"}' };
    const p = mp.payments.get(decodeURIComponent(m[1])); return p ? { status: 200, body: JSON.stringify(p) } : { status: 404, body: '{"message":"Payment not found"}' };
  }
  m = /^\/v1\/payments\/([^/]+)\/refunds$/.exec(url);
  if (req.method === 'POST' && m) {
    const key = req.headers['x-idempotency-key'] as string; mp.refundCalls.push({ payment: m[1], key, body: JSON.parse(body) });
    if (mp.refundFail > 0) { mp.refundFail--; return { status: 500, body: '{"message":"refund failed"}' }; }
    if (!mp.refundsByKey.has(key)) mp.refundsByKey.set(key, `rf-${mp.refundsByKey.size + 1}`);
    return { status: 201, body: JSON.stringify({ id: mp.refundsByKey.get(key) }) };
  }
  return { status: 404, body: '{}' };
}


export const resetMp = () => Object.assign(mp, { payments: new Map(), prefFail: 0, lookupStatus: 0, refundFail: 0, prefs: 0, refundsByKey: new Map(), refundCalls: [] });
export const setPayment = (id: string, p: Partial<{ status: string; amount: number; currency: string; ref: string | null }>) =>
  mp.payments.set(id, { id: Number(id), status: p.status ?? 'approved', transaction_amount: p.amount ?? 100000, currency_id: p.currency ?? 'ARS', external_reference: p.ref === undefined ? null : p.ref });

