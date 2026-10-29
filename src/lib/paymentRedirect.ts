/** Redirección al checkout y espera de la confirmación al volver (reemplazables en los tests). */
let redirectImpl: (url: string) => void = (url) => { globalThis.location.assign(url); };
export const goToCheckout = (url: string) => redirectImpl(url);
export const setRedirect = (fn: ((url: string) => void) | null) => { redirectImpl = fn ?? ((url) => { globalThis.location.assign(url); }); };

/** Al volver de Mercado Pago, el aviso (webhook) puede tardar unos segundos: consultamos cada `ms` hasta `max` veces. */
export const pollConfig = { ms: 3000, max: 20 };

export type PaymentReturn = { result: 'ok' | 'error' | 'pendiente'; bookingId: string } | null;
export function readPaymentReturn(search: string = globalThis.location?.search ?? ''): PaymentReturn {
  const q = new URLSearchParams(search), r = q.get('pago'), id = q.get('reserva');
  if (!r || !id || !['ok', 'error', 'pendiente'].includes(r) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { result: r as 'ok' | 'error' | 'pendiente', bookingId: id };
}
export function clearPaymentReturn() {
  try { const u = new URL(globalThis.location.href); u.searchParams.delete('pago'); u.searchParams.delete('reserva'); globalThis.history.replaceState({}, '', u.pathname + (u.search || '') + u.hash); } catch { /* ignorar */ }
}
