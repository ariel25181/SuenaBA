/**
 * Reglas de reservas (espejo en TypeScript de las funciones SQL de la migración).
 * Sirven para mostrar previsualizaciones en la UI (comisión, reembolso al cancelar).
 * La fuente de verdad sigue siendo la base de datos: tests/db/rules.parity.test.ts
 * verifica que ambas implementaciones den exactamente los mismos números.
 */

export type BookingStatus = 'solicitada' | 'aceptada' | 'confirmada' | 'realizada' | 'rechazada' | 'cancelada' | 'expirada';
export type CancellationPolicy = 'flexible' | 'moderada' | 'estricta';
export type BookingMode = 'instant' | 'approval';

/** Comisión en puntos básicos (100 bps = 1%), redondeo hacia abajo. */
export const calcFee = (amount: number, bps: number): number => Math.floor((amount * bps) / 10000);

/** % de reembolso al bar si cancela, según política y horas de anticipación. */
export function refundPct(policy: CancellationPolicy, hoursBefore: number): number {
  switch (policy) {
    case 'flexible': return hoursBefore >= 24 ? 100 : 50;
    case 'moderada': return hoursBefore >= 72 ? 100 : hoursBefore >= 24 ? 50 : 0;
    case 'estricta': return hoursBefore >= 168 ? 100 : hoursBefore >= 72 ? 50 : 0;
    default: return 0;
  }
}

export interface Settlement { refunded: number; payout: number; platformFee: number }

/** Reparto: reembolso al bar + pago al músico + ganancia de la plataforma = total cobrado. */
export function settleAmounts(cachet: number, venueFee: number, musicianBps: number, pct: number): Settlement {
  const refundCachet = Math.floor((cachet * pct) / 100);
  const refundFee = Math.floor((venueFee * pct) / 100);
  const retained = cachet - refundCachet;
  const musicianFee = calcFee(retained, musicianBps);
  return { refunded: refundCachet + refundFee, payout: retained - musicianFee, platformFee: venueFee - refundFee + musicianFee };
}

/** Lo que verá el bar antes de pagar y el músico antes de aceptar. */
export function pricePreview(cachet: number, venueBps: number, musicianBps: number) {
  const venueFee = calcFee(cachet, venueBps);
  const musicianFee = calcFee(cachet, musicianBps);
  return { cachet, venueFee, barPays: cachet + venueFee, musicianFee, musicianReceives: cachet - musicianFee, platformFee: venueFee + musicianFee };
}

export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  solicitada: ['aceptada', 'rechazada', 'cancelada', 'expirada'],
  aceptada: ['confirmada', 'cancelada', 'expirada'],
  confirmada: ['realizada', 'cancelada'],
  realizada: [], rechazada: [], cancelada: [], expirada: [],
};
export const canTransition = (from: BookingStatus, to: BookingStatus) => TRANSITIONS[from].includes(to);

export const STATUS_LABEL: Record<BookingStatus, string> = {
  solicitada: 'Solicitud enviada', aceptada: 'Aceptada · falta el pago', confirmada: 'Confirmada',
  realizada: 'Realizada', rechazada: 'Rechazada', cancelada: 'Cancelada', expirada: 'Vencida',
};

/** Mensajes en español para los códigos de error que devuelven las funciones SQL. */
export const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Iniciá sesión para continuar.',
  no_profile: 'Tu usuario todavía no tiene un perfil de bar o músico.',
  suspended: 'Tu cuenta está suspendida. Contactanos para resolverlo.',
  forbidden_role: 'Esta acción no está disponible para tu tipo de perfil.',
  listing_not_found: 'Esa fecha no existe o fue cancelada.',
  listing_not_open: 'Esa fecha ya no está disponible.',
  listing_too_soon: 'Faltan menos de 2 horas: ya no se pueden pedir reservas.',
  listing_overlap: 'Ya publicaste otra fecha en ese horario.',
  listing_has_booking: 'La fecha tiene una reserva: cancelá primero la reserva.',
  invalid_listing: 'Revisá los datos de la fecha (horario, cachet, modo o política).',
  starts_too_soon: 'La fecha debe empezar al menos 2 horas en el futuro.',
  starts_too_far: 'No se pueden publicar fechas a más de un año.',
  invalid_cachet: 'El cachet no es válido.',
  instant_requires_listed_cachet: 'En reserva instantánea el cachet es el publicado.',
  note_too_long: 'La nota es demasiado larga (máx. 1000 caracteres).',
  already_requested: 'Ya pediste esta fecha.',
  too_many_requests: 'Tenés demasiadas solicitudes pendientes. Esperá respuestas antes de pedir más.',
  musician_busy: 'El músico ya tiene otro show confirmado en ese horario.',
  booking_not_found: 'No encontramos esa reserva.',
  invalid_state: 'Esa acción no corresponde al estado actual de la reserva.',
  show_not_finished: 'El show todavía no terminó.',
  show_already_started: 'El show ya empezó: ya no se puede cancelar.',
  booking_disputed: 'La reserva tiene un problema reportado y está en revisión.',
  invalid_reason: 'Contanos qué pasó (máx. 1000 caracteres).',
  booking_not_completed: 'Solo se puede reseñar un show realizado.',
  review_window_closed: 'Pasó el plazo para dejar la reseña (14 días).',
  invalid_rating: 'La calificación debe ser un número entero de 1 a 5.',
  invalid_breakdown: 'Completá todos los criterios con valores de 1 a 5.',
  comment_too_long: 'El comentario es demasiado largo (máx. 1000 caracteres).',
  already_reviewed: 'Ya dejaste tu reseña para esta reserva.',
  empty_message: 'El mensaje está vacío.',
  message_too_long: 'El mensaje es demasiado largo (máx. 2000 caracteres).',
  message_limit: 'Esta conversación llegó al límite de mensajes.',
  not_verified: 'Tu perfil todavía no fue verificado.',
  invalid_favorite: 'No se puede guardar ese favorito.',
  target_not_found: 'Ese elemento ya no existe.',
  favorites_limit: 'Llegaste al máximo de 500 favoritos.',
  invalid_name: 'Poné un nombre de hasta 60 caracteres.',
  invalid_filters: 'Los filtros de la búsqueda no son válidos.',
  too_many_searches: 'Ya tenés 10 búsquedas guardadas. Borrá alguna para crear otra.',
  profile_exists: 'Ya tenés un perfil creado.',
  request_pending: 'Ya enviaste una solicitud y está en revisión.',
  invalid_request: 'Revisá los datos: nombre, barrio y dirección (para bares) son obligatorios.',
  invalid_evidence: 'El enlace debe empezar con https://',
  invalid_prefs: 'No pudimos guardar tus preferencias.',
  payments_disabled: 'Los pagos con Mercado Pago todavía no están activados.',
  already_paid: 'Esta reserva ya está paga.',
  mp_unavailable: 'Mercado Pago no está disponible en este momento. Probá de nuevo en unos minutos.',
  payment_required: 'Esta reserva se paga con Mercado Pago.',
  invalid_alias: 'Ingresá un alias de 6 a 20 caracteres (con al menos una letra) o un CBU/CVU de 22 dígitos.',
  invalid_subscription: 'No pudimos registrar este dispositivo para recibir avisos.',
};
export const errorMessage = (code: string) => ERROR_MESSAGES[code] ?? 'Ocurrió un error inesperado. Probá de nuevo.';

export const POLICY_LABEL: Record<CancellationPolicy, string> = { flexible: 'Flexible', moderada: 'Moderada', estricta: 'Estricta' };
export const POLICY_RULES: Record<CancellationPolicy, string> = {
  flexible: 'Reembolso total hasta 24 h antes del show; después, 50%.',
  moderada: 'Reembolso total hasta 72 h antes; 50% entre 72 h y 24 h; después, sin reembolso.',
  estricta: 'Reembolso total hasta 7 días antes; 50% entre 7 días y 72 h; después, sin reembolso.',
};
export const hoursUntil = (iso: string, now: Date = new Date()) => (new Date(iso).getTime() - now.getTime()) / 3_600_000;
