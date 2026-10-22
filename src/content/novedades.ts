/**
 * Novedades de SuenaBA. Para anunciar una función nueva: agregá una entrada AL FINAL con el id siguiente.
 * Los usuarios ven un aviso "Novedades (n)" con las entradas más nuevas que su último id visto.
 */
export type Audience = 'anfitrion' | 'musico' | 'publico';
export type ReservasTab = 'explorar' | 'fechas' | 'reservas' | 'favoritos' | 'avisos' | 'cuenta' | 'cartelera';

export interface Novedad {
  id: number;
  date: string;           // YYYY-MM-DD
  tag: 'nuevo' | 'mejora';
  title: string;
  body: string;
  audiences: Audience[];
  tab?: ReservasTab;      // dónde probarla
}

const AMBOS: Audience[] = ['anfitrion', 'musico'];
const TODOS: Audience[] = ['anfitrion', 'musico', 'publico'];

export const NOVEDADES: Novedad[] = [
  { id: 1, date: '2026-10-19', tag: 'nuevo', title: 'Reservas estilo Airbnb', audiences: AMBOS, tab: 'reservas',
    body: 'El bar publica una fecha, el músico la solicita (o la reserva al instante), el bar acepta y paga, y después del show se libera el pago. Todo queda ordenado en un solo lugar.' },
  { id: 2, date: '2026-10-19', tag: 'nuevo', title: 'Pago retenido y comisión transparente', audiences: AMBOS, tab: 'reservas',
    body: 'El dinero queda retenido por SuenaBA hasta que el show se realiza. Antes de reservar ves cuánto vas a pagar o cobrar, con la comisión (si la hay) desglosada.' },
  { id: 3, date: '2026-10-19', tag: 'nuevo', title: 'Cancelaciones con reembolso claro', audiences: AMBOS, tab: 'reservas',
    body: 'Cada fecha tiene una política flexible, moderada o estricta. Antes de cancelar te mostramos cuánto se reembolsa según la anticipación.' },
  { id: 4, date: '2026-10-19', tag: 'nuevo', title: 'Reseñas cruzadas y justas', audiences: AMBOS, tab: 'reservas',
    body: 'Bar y músico se reseñan después del show. Las reseñas se publican cuando ambos reseñan o a los 14 días, así nadie se ve influido por la opinión del otro.' },
  { id: 5, date: '2026-10-19', tag: 'nuevo', title: 'Chat dentro de cada reserva', audiences: AMBOS, tab: 'reservas',
    body: 'Coordiná backline, horarios y detalles sin salir de SuenaBA. Te avisamos cuando llega un mensaje.' },
  { id: 6, date: '2026-10-20', tag: 'nuevo', title: 'Explorá con filtros', audiences: ['musico'], tab: 'explorar',
    body: 'Buscá fechas por día, barrio, género, cachet y modo de reserva, ordenalas y ocultá las que se pisan con tus shows.' },
  { id: 7, date: '2026-10-20', tag: 'nuevo', title: 'Favoritos', audiences: AMBOS, tab: 'favoritos',
    body: 'Guardá fechas, bares y músicos con el corazón para encontrarlos rápido después.' },
  { id: 8, date: '2026-10-20', tag: 'nuevo', title: 'Alertas de búsqueda', audiences: ['musico'], tab: 'explorar',
    body: 'Guardá una búsqueda y te avisamos apenas un bar publique una fecha que coincide, siempre que no se pise con otro show tuyo.' },
  { id: 9, date: '2026-10-20', tag: 'nuevo', title: 'Avisos dentro de la app', audiences: AMBOS, tab: 'avisos',
    body: 'Solicitudes, aceptaciones, pagos, cancelaciones, mensajes y reseñas pendientes: todo en tu bandeja de avisos.' },
  { id: 10, date: '2026-10-20', tag: 'nuevo', title: 'Superanfitrión y Superartista', audiences: AMBOS, tab: 'cuenta',
    body: 'Ganás la insignia con varios shows realizados, muy buena calificación, casi cero cancelaciones y (para bares) respuesta rápida a las solicitudes.' },
  { id: 11, date: '2026-10-20', tag: 'nuevo', title: 'Perfiles verificados', audiences: AMBOS, tab: 'cuenta',
    body: 'Pedís tu perfil con un enlace de referencia y el equipo lo verifica. Los perfiles verificados generan más confianza.' },
  { id: 12, date: '2026-10-20', tag: 'nuevo', title: 'Tus ganancias y pagos', audiences: AMBOS, tab: 'cuenta',
    body: 'Mirá cuánto está retenido, cuánto ya se pagó o cobró y cuántos shows realizaste.' },
  { id: 13, date: '2026-10-20', tag: 'nuevo', title: 'Reportar un problema', audiences: AMBOS, tab: 'reservas',
    body: 'Si algo sale mal en un show, reportalo: el pago queda retenido hasta que el equipo lo revise y resuelva.' },
  { id: 14, date: '2026-10-21', tag: 'nuevo', title: 'Cartelera pública', audiences: TODOS, tab: 'cartelera',
    body: 'Los shows confirmados y pagos aparecen en la cartelera: cualquiera puede verlos, sin cuenta, y filtrarlos por barrio y género.' },
  { id: 15, date: '2026-10-21', tag: 'nuevo', title: 'Tour de bienvenida y novedades', audiences: TODOS, tab: 'cuenta',
    body: 'Un recorrido corto según cómo uses SuenaBA (anfitrión, músico o público) y esta sección para enterarte de cada función nueva. Podés repetir el tour cuando quieras.' },
  { id: 16, date: '2026-10-22', tag: 'nuevo', title: 'Avisos por email y en tu celular', audiences: AMBOS, tab: 'cuenta',
    body: 'Además de la bandeja, te avisamos por email y con notificaciones en este dispositivo cuando hay una solicitud, un pago o un mensaje. En Cuenta elegís qué recibir.' },
  { id: 17, date: '2026-10-23', tag: 'nuevo', title: 'Pagos con Mercado Pago, reembolsos y cobros', audiences: AMBOS, tab: 'reservas',
    body: 'Cuando el equipo activa los pagos reales, el bar paga la reserva con Mercado Pago y se confirma sola al acreditarse. Si se cancela, el reembolso vuelve al medio de pago. Los músicos cargan su alias o CBU/CVU en Cuenta para cobrar.' },
];

/** Pestañas que existen para cada tipo de uso (para no ofrecer "Probar ahora" hacia algo que no está). */
export const TABS_BY_AUDIENCE: Record<Audience, ReservasTab[]> = {
  anfitrion: ['fechas', 'reservas', 'favoritos', 'avisos', 'cuenta'],
  musico: ['explorar', 'reservas', 'favoritos', 'avisos', 'cuenta'],
  publico: ['cartelera'],
};
export const tabFor = (n: Novedad, a: Audience | null): ReservasTab | undefined => (n.tab && a && TABS_BY_AUDIENCE[a].includes(n.tab) ? n.tab : undefined);

export const latestNovedadId = () => NOVEDADES.reduce((m, n) => Math.max(m, n.id), 0);
export const novedadesFor = (a: Audience | null) => NOVEDADES.filter((n) => !a || n.audiences.includes(a)).sort((x, y) => y.id - x.id);
export const unreadNovedades = (a: Audience | null, seen: number) => novedadesFor(a).filter((n) => n.id > seen).length;
