import type { PayDeps, Intent, RefundRow } from './payments.ts';

type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> };
const first = (d: any) => (Array.isArray(d) ? d[0] : d);

/** Une las funciones de Mercado Pago con las RPC de Supabase. `asUser(jwt)` devuelve un cliente que actúa con el JWT del usuario. */
export function supabasePayDeps(admin: Rpc, asUser: (jwt: string) => Rpc): Pick<PayDeps, 'beginPayment' | 'attachPreference' | 'confirmIntent' | 'claimRefunds' | 'completeRefund' | 'expireIntents'> {
  const call = async (c: Rpc, fn: string, args: Record<string, unknown>) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(error.message); return data; };
  return {
    beginPayment: async (jwt, bookingId) => first(await call(asUser(jwt), 'begin_payment', { p_booking_id: bookingId })) as Intent,
    attachPreference: async (id, pref, point) => first(await call(admin, 'attach_preference', { p_intent: id, p_preference_id: pref, p_init_point: point })) as Intent,
    confirmIntent: async (id, payment, amount, currency, status) => { await call(admin, 'confirm_payment_intent', { p_intent: id, p_mp_payment_id: payment, p_amount: amount, p_currency: currency, p_mp_status: status }); },
    claimRefunds: async (limit) => ((await call(admin, 'claim_pending_refunds', { p_limit: limit })) ?? []) as RefundRow[],
    completeRefund: async (id, ok, refundId, error) => { await call(admin, 'complete_refund', { p_id: id, p_ok: ok, p_mp_refund_id: refundId, p_error: error }); },
    expireIntents: async () => Number(await call(admin, 'expire_stale_intents', {})),
  };
}
