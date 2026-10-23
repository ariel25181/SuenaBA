import type { Audience, ReservasTab } from './novedades.ts';

/** Subí este número para que todos vean de nuevo el tour (por ejemplo, tras un cambio grande). */
export const TOUR_VERSION = 1;

export interface TourStep { emoji: string; title: string; body: string; tab?: ReservasTab }

export const AUDIENCE_INFO: { id: Audience; emoji: string; label: string; desc: string }[] = [
  { id: 'anfitrion', emoji: '🍸', label: 'Soy anfitrión', desc: 'Tengo un bar o sala y quiero programar música en vivo.' },
  { id: 'musico', emoji: '🎸', label: 'Soy músico o banda', desc: 'Quiero encontrar fechas, reservarlas y cobrar mis shows.' },
  { id: 'publico', emoji: '🎟️', label: 'Soy público', desc: 'Quiero descubrir shows en vivo para ir a ver.' },
];

export const TOUR: Record<Audience, TourStep[]> = {
  anfitrion: [
    { emoji: '👋', title: 'Bienvenido, anfitrión', body: 'En un minuto te mostramos cómo llenar tu agenda de música en vivo, con pagos protegidos y reseñas verificadas.' },
    { emoji: '📅', title: 'Publicá tus fechas', body: 'En "Mis fechas" elegís día y horario, el cachet, el backline que ofrecés, los géneros y la política de cancelación. ¿Se pueden pisar tus fechas? No: el sistema lo evita.', tab: 'fechas' },
    { emoji: '⚡', title: 'Instantánea o con aprobación', body: 'Con reserva instantánea el primer músico que la pide la toma. Con aprobación recibís solicitudes (incluso con otro cachet) y elegís a quién aceptar.' },
    { emoji: '🔒', title: 'Pagá y confirmá', body: 'Al aceptar, pagás para confirmar. El dinero queda retenido por SuenaBA y recién se libera al músico después del show. Ves el total y la comisión antes de pagar.', tab: 'reservas' },
    { emoji: '↩️', title: 'Cancelaciones claras', body: 'Tu política (flexible, moderada o estricta) define el reembolso según la anticipación. Si cancela el músico, recibís el reembolso total.' },
    { emoji: '⭐', title: 'Después del show', body: 'Marcá el show como realizado, dejá tu reseña y mirá la del músico: se publican cuando ambos reseñan o a los 14 días. Si hubo un problema, reportalo.' },
    { emoji: '🏅', title: 'Ganá la insignia Superanfitrión', body: 'Respondé rápido, no canceles confirmadas y mantené buenas reseñas. En "Cuenta" ves tus pagos y tu reputación.', tab: 'cuenta' },
    { emoji: '🔔', title: 'Todo te llega a tiempo', body: 'Nuevas solicitudes, pagos y mensajes aparecen en "Avisos". Para empezar, creá tu perfil: el equipo lo verifica y ya podés publicar.', tab: 'avisos' },
  ],
  musico: [
    { emoji: '👋', title: 'Bienvenido, músico', body: 'Te mostramos cómo encontrar fechas, reservarlas y cobrar con seguridad.' },
    { emoji: '🔎', title: 'Explorá y filtrá', body: 'En "Explorar" buscás por día, barrio, género, cachet y modo de reserva. Podés ocultar las fechas que se pisan con tus shows.', tab: 'explorar' },
    { emoji: '❤️', title: 'Favoritos y alertas', body: 'Guardá fechas y bares con el corazón. Y si guardás una búsqueda, te avisamos apenas un bar publique una fecha que coincide.' },
    { emoji: '🎯', title: 'Reservá o proponé', body: 'Si es instantánea, reservás ya. Si es con aprobación, enviás una solicitud y podés proponer otro cachet. Siempre ves cuánto vas a recibir.', tab: 'reservas' },
    { emoji: '💸', title: 'Cobrá seguro', body: 'Cuando el bar paga, el dinero queda retenido por SuenaBA y se libera al realizarse el show. Si el bar cancela, la política de la fecha define tu compensación.' },
    { emoji: '⚠️', title: 'Cancelar tiene consecuencias', body: 'Si cancelás una reserva pagada, el bar recibe el reembolso total. Cancelar con menos de 24 horas suma una cancelación tardía a tu perfil.' },
    { emoji: '⭐', title: 'Reseñas y Superartista', body: 'Después del show, reseñás al bar. Con shows cumplidos y buenas reseñas ganás la insignia Superartista. Tus ganancias están en "Cuenta".', tab: 'cuenta' },
    { emoji: '🔔', title: 'Todo te llega a tiempo', body: 'Aceptaciones, pagos y mensajes aparecen en "Avisos". Para empezar, creá tu perfil: el equipo lo verifica y ya podés reservar.', tab: 'avisos' },
  ],
  publico: [
    { emoji: '👋', title: 'Bienvenido', body: 'SuenaBA conecta bares y músicos de Buenos Aires. Acá descubrís los shows que ya están confirmados.' },
    { emoji: '🎟️', title: 'La cartelera', body: 'Ves los próximos shows confirmados y pagos: bar, banda, día, horario y géneros. No necesitás cuenta.', tab: 'cartelera' },
    { emoji: '🧭', title: 'Filtrá a tu gusto', body: 'Elegí tu barrio y tus géneros favoritos para encontrar el plan de esta semana.' },
    { emoji: '🎸', title: '¿Tocás o tenés un bar?', body: 'Si querés publicar fechas o reservarlas, volvé a elegir tu tipo de uso y creá tu perfil. Siempre podés repetir este tour desde el botón de ayuda.' },
  ],
};
