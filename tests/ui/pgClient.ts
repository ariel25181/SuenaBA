import type pg from 'pg';
import { asUser, BizError } from '../db/helpers.ts';
import type { AppClient } from '../../src/lib/bookingsApi.ts';

/**
 * Cliente falso con la misma interfaz que supabase-js, pero que ejecuta todo contra Postgres real
 * como el usuario activo (rol authenticated + RLS). Permite probar las pantallas de punta a punta.
 */
export function createPgClient(pool: pg.Pool, session: { userId: string | null; email?: string }): AppClient {
  const listeners = new Set<(e: string, s: any) => void>();
  const user = () => (session.userId ? { id: session.userId, email: session.email } : null);
  const err = (e: any) => ({ message: e instanceof BizError ? e.code : e.message, code: e.code });

  return {
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      try {
        const rows = await asUser(pool, session.userId, async (c) => {
          const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
          const vals = keys.map((k) => { const v = (args as any)[k]; return v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v; });
          return (await c.query(sql, vals)).rows;
        }, { role: session.userId ? 'authenticated' : 'anon' });
        // PostgREST: funciones escalares devuelven el valor; las que devuelven filas, un arreglo/objeto
        if (rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === fn) return { data: rows[0][fn], error: null };
        return { data: rows, error: null };
      } catch (e) { return { data: null, error: err(e) }; }
    },
    from(table: string) {
      const where: string[] = [], vals: unknown[] = []; let cols = '*', order = '', limit = '';
      const q: any = {
        select(c = '*') { cols = c; return q; },
        eq(col: string, v: unknown) { vals.push(v); where.push(`"${col}" = $${vals.length}`); return q; },
        neq(col: string, v: unknown) { vals.push(v); where.push(`"${col}" <> $${vals.length}`); return q; },
        in(col: string, v: unknown[]) { vals.push(v); where.push(`"${col}" = any($${vals.length})`); return q; },
        not(col: string, op: string, v: unknown) { if (op === 'is' && v === null) where.push(`"${col}" is not null`); return q; },
        order(col: string, o: { ascending?: boolean } = {}) { order = ` order by "${col}" ${o.ascending === false ? 'desc' : 'asc'}`; return q; },
        limit(n: number) { limit = ` limit ${Number(n)}`; return q; },
        then(res: (v: any) => any, rej?: (e: any) => any) {
          return asUser(pool, session.userId, async (c) => (await c.query(`select ${cols} from public.${table}${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}`, vals)).rows,
            { role: session.userId ? 'authenticated' : 'anon' }).then((data) => ({ data, error: null }), (e) => ({ data: null, error: err(e) })).then(res, rej);
        },
      };
      return q;
    },
    auth: {
      async getSession() { const u = user(); return { data: { session: u ? { user: u } : null } }; },
      onAuthStateChange(cb) { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; },
      async signInWithPassword({ email }) { const r = await pool.query('select id from auth.users where email = $1', [email]); if (!r.rows[0]) return { error: { message: 'Invalid login' } }; session.userId = r.rows[0].id; session.email = email; listeners.forEach((l) => l('SIGNED_IN', { user: user() })); return { error: null }; },
      async signUp({ email }) { const r = await pool.query('insert into auth.users (email) values ($1) returning id', [email]); session.userId = r.rows[0].id; session.email = email; listeners.forEach((l) => l('SIGNED_IN', { user: user() })); return { error: null, data: { session: {} } }; },
      async signOut() { session.userId = null; listeners.forEach((l) => l('SIGNED_OUT', null)); },
    },
  };
}
