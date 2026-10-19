import test from 'node:test';
import assert from 'node:assert/strict';
import { calcFee, refundPct, settleAmounts, pricePreview, canTransition, errorMessage, TRANSITIONS } from './bookingRules.ts';
import { createBookingsApi, BookingError, type RpcClient } from '../lib/bookingsApi.ts';

test('comisión 0 por defecto y redondeo hacia abajo', () => {
  assert.equal(calcFee(100000, 0), 0);
  assert.equal(calcFee(100000, 500), 5000);
  assert.equal(calcFee(999, 333), 33); // 33.2667 -> 33
});

test('política de reembolso: bordes exactos', () => {
  assert.deepEqual([24, 23.99].map((h) => refundPct('flexible', h)), [100, 50]);
  assert.deepEqual([72, 71.99, 24, 23.99].map((h) => refundPct('moderada', h)), [100, 50, 50, 0]);
  assert.deepEqual([168, 167.99, 72, 71.99].map((h) => refundPct('estricta', h)), [100, 50, 50, 0]);
});

test('el reparto siempre suma lo cobrado', () => {
  for (const cachet of [0, 1, 999, 100000, 123457, 100_000_000])
    for (const vb of [0, 1, 333, 500, 3000]) for (const mb of [0, 7, 1000, 3000]) for (const pct of [0, 1, 33, 50, 99, 100]) {
      const fee = calcFee(cachet, vb), s = settleAmounts(cachet, fee, mb, pct);
      assert.equal(s.refunded + s.payout + s.platformFee, cachet + fee, `${cachet}/${vb}/${mb}/${pct}`);
      assert.ok(s.refunded >= 0 && s.payout >= 0 && s.platformFee >= 0);
    }
});

test('previsualización de precio', () => {
  assert.deepEqual(pricePreview(100000, 500, 1000), { cachet: 100000, venueFee: 5000, barPays: 105000, musicianFee: 10000, musicianReceives: 90000, platformFee: 15000 });
});

test('transiciones: los estados finales no salen a ningún lado', () => {
  for (const s of ['realizada', 'rechazada', 'cancelada', 'expirada'] as const) assert.deepEqual(TRANSITIONS[s], []);
  assert.ok(canTransition('solicitada', 'aceptada') && !canTransition('aceptada', 'realizada'));
});

test('mensajes de error en español con respaldo genérico', () => {
  assert.match(errorMessage('musician_busy'), /otro show/);
  assert.match(errorMessage('algo_raro'), /inesperado/);
});

test('API: mapea filas y traduce errores de negocio', async () => {
  const row = { id: 'b1', listing_id: 'l1', venue_id: 'v', musician_id: 'm', status: 'aceptada', cachet_ars: '120000', note: null, starts_at: 'a', ends_at: 'b', cancellation_policy: 'flexible', respond_by: 'c', fund_by: null };
  const calls: [string, any][] = [];
  const ok: RpcClient = { rpc: async (fn, args) => { calls.push([fn, args]); return { data: [row], error: null }; }, from: () => ({}) };
  const b = await createBookingsApi(ok).respond('b1', true);
  assert.deepEqual([b.status, b.cachetArs, b.note, b.fundBy], ['aceptada', 120000, '', null]);
  assert.deepEqual(calls[0], ['respond_booking', { p_booking_id: 'b1', p_accept: true, p_reason: '' }]);

  const bad: RpcClient = { rpc: async () => ({ data: null, error: { message: 'musician_busy' } }), from: () => ({}) };
  await assert.rejects(createBookingsApi(bad).request('l1'), (e: any) => e instanceof BookingError && e.code === 'musician_busy' && /otro show/.test(e.message));
  const weird: RpcClient = { rpc: async () => ({ data: null, error: { message: 'JWT expired', code: 'PGRST301' } }), from: () => ({}) };
  await assert.rejects(createBookingsApi(weird).cancel('x'), (e: any) => e.code === 'PGRST301');
});
