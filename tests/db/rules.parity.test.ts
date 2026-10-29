import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type pg from 'pg';
import { createTestDb, dropTestDb } from './helpers.ts';
import { calcFee, refundPct, settleAmounts, type CancellationPolicy } from '../../src/domain/bookingRules.ts';

const DB = 'suenaba_parity';
let pool: pg.Pool;
before(async () => { pool = await createTestDb(DB, 4); });
after(async () => { await dropTestDb(pool, DB); });

describe('Paridad TypeScript ↔ SQL', () => {
  it('calc_fee, refund_pct y settle_amounts dan exactamente lo mismo', async () => {
    let n = 0;
    const cachets = [0, 1, 7, 999, 50000, 123457, 987654321, 100_000_000];
    for (const cachet of cachets) for (const bps of [0, 1, 333, 500, 1234, 3000]) {
      const sql = (await pool.query('select public.calc_fee($1,$2) f', [cachet, bps])).rows[0].f;
      assert.equal(calcFee(cachet, bps), Number(sql)); n++;
    }
    for (const policy of ['flexible', 'moderada', 'estricta'] as CancellationPolicy[])
      for (const h of [0, 0.5, 23.99, 24, 24.01, 71.99, 72, 100, 167.99, 168, 500]) {
        const sql = (await pool.query('select public.refund_pct($1,$2::numeric) p', [policy, h])).rows[0].p;
        assert.equal(refundPct(policy, h), sql, `${policy} ${h}`); n++;
      }
    for (const cachet of cachets) for (const vb of [0, 500, 3000]) for (const mb of [0, 7, 1000, 3000]) for (const pct of [0, 1, 33, 50, 99, 100]) {
      const fee = calcFee(cachet, vb);
      const row = (await pool.query('select * from public.settle_amounts($1,$2,$3,$4)', [cachet, fee, mb, pct])).rows[0];
      const ts = settleAmounts(cachet, fee, mb, pct);
      assert.deepEqual([ts.refunded, ts.payout, ts.platformFee], [Number(row.refunded), Number(row.payout), Number(row.platform_fee)], `${cachet}/${vb}/${mb}/${pct}`); n++;
    }
    console.log(`  ${n} combinaciones idénticas entre TypeScript y SQL`);
  });
});
