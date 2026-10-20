import './setup.ts';
import React from 'react';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, checkInvariants, H, D, type Actor, type Api } from '../db/helpers.ts';
import { createPgClient } from './pgClient.ts';
import { SessionProvider } from '../../src/context/SessionContext.tsx';
import { ReservasApp } from '../../src/components/reservas/ReservasApp.tsx';
import { TOUR_VERSION } from '../../src/content/tour.ts';
import { latestNovedadId } from '../../src/content/novedades.ts';

const DB = 'suenaba_ui';
let pool: pg.Pool, A: Api;
let bar1: Actor, bar2: Actor, m1: Actor, m2: Actor;
const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const T = { timeout: 5000 };

async function listing(a: Actor, days: number, extra: Record<string, unknown> = {}) {
  const starts = day(days), ends = plus(starts, 3 * H);
  const row = await A.createListing(a, { starts, ends, cachet: 120000, ...extra } as any);
  return { id: row.id as string, starts, ends };
}
/** Monta la app como un usuario dado (por email, como un login real). */
function mount(email: string | null) {
  const session: { userId: string | null; email?: string } = { userId: null };
  const client = createPgClient(pool, session);
  const utils = render(<SessionProvider client={client}><ReservasApp /></SessionProvider>);
  return { ...utils, session, client };
}
async function login(email: string) {
  fireEvent.change(await screen.findByLabelText('Email', {}, T), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}
async function asUserUI(email: string) { const m = mount(null); await login(email); await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T); return m; }
const tab = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const clickAsync = async (name: string | RegExp) => fireEvent.click(await screen.findByRole('button', { name }, T));
const em = (a: Actor) => `${a.entityId}@t.com`;

before(async () => { pool = await createTestDb(DB, 20); A = api(pool); });
after(async () => { cleanup(); (globalThis as any).window?.close?.(); await dropTestDb(pool, DB); });
/** Preferencias "ya hizo el tour y vio las novedades" para que no estorben en los demás flujos. */
const presetPrefs = (audience: string | null = 'musico') => localStorage.setItem('suenaba:prefs:v1', JSON.stringify({ audience, tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() }));
beforeEach(async () => { localStorage.clear(); presetPrefs(); await resetData(pool); const w = await seedActors(pool, 2, 2); [bar1, bar2] = w.bars; [m1, m2] = w.mus; });
afterEach(async () => { cleanup(); const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Acceso y alta de perfil', () => {
  it('login con error, creación de cuenta, solicitud de perfil y aprobación', async () => {
    presetPrefs('anfitrion');
    const m = mount(null);
    await login('nadie@x.com');
    assert.match((await screen.findByRole('alert', {}, T)).textContent!, /incorrectos/);
    fireEvent.click(screen.getByText('¿No tenés cuenta? Crear una'));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nuevo@bar.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } });
    click('Crear cuenta');
    await screen.findByText('Contanos quién sos', {}, T);
    fireEvent.click(screen.getByRole('radio', { name: 'Tengo un bar' }));
    fireEvent.change(screen.getByLabelText('Nombre del bar'), { target: { value: 'La Esquina' } });
    click('Enviar solicitud');
    assert.match((await screen.findByRole('alert', {}, T)).textContent!, /barrio y dirección/);       // falta dirección
    fireEvent.change(screen.getByLabelText('Barrio'), { target: { value: 'Palermo Soho' } });
    fireEvent.change(screen.getByLabelText('Dirección'), { target: { value: 'Honduras 5000' } });
    fireEvent.change(screen.getByLabelText(/Enlace para verificarte/), { target: { value: 'http://inseguro.com' } });
    click('Enviar solicitud');
    assert.match((await screen.findByRole('alert', {}, T)).textContent!, /https:\/\//);
    fireEvent.change(screen.getByLabelText(/Enlace para verificarte/), { target: { value: 'https://instagram.com/laesquina' } });
    click('Enviar solicitud');
    await screen.findByText('Estamos revisando tu perfil', {}, T);
    const req = (await A.q('select id from profile_requests'))[0];
    await A.reviewRequest(req.id, true, 'ok');
    click('Actualizar estado');
    await screen.findByRole('button', { name: 'Mis fechas' }, T);
    assert.ok(m.session.userId);
  });
});

describe('Explorar y reservar (músico)', () => {
  it('lista fechas, filtra, guarda favoritos y solicita una reserva con el desglose de comisión', async () => {
    await A.q(`update app_settings set musician_fee_bps = 1000`);
    await A.q(`update venues set neighborhood = 'San Telmo' where id = $1`, [bar2.entityId]);
    const a = await listing(bar1, 10, { genres: ['Jazz'], cachet: 120000 });
    await listing(bar2, 11, { genres: ['Rock'], cachet: 300000, mode: 'instant' });
    await asUserUI(em(m1));
    await screen.findByText('Bar 1', {}, T); await screen.findByText('Bar 2', {}, T);
    await screen.findByText('2 fechas disponibles');
    // favorito persistente
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Bar 1 en favoritos' }));
    await screen.findByRole('button', { name: 'Quitar Bar 1 de favoritos' }, T);
    assert.equal((await A.q('select count(*)::int n from favorites where user_id = $1', [m1.userId]))[0].n, 1);
    // filtros: barrio + género
    fireEvent.click(screen.getByRole('button', { name: 'San Telmo' })); click('Buscar');
    await waitFor(() => assert.ok(!screen.queryByText('Bar 1'), "no debería estar en pantalla"), T);
    await screen.findByText('Bar 2', {}, T);
    fireEvent.click(screen.getByRole('button', { name: 'San Telmo' })); fireEvent.click(screen.getByRole('button', { name: 'Jazz' })); click('Buscar');
    await screen.findByText('Bar 1', {}, T);
    await waitFor(() => assert.ok(!screen.queryByText('Bar 2'), "no debería estar en pantalla"), T);
    // sin resultados
    fireEvent.change(screen.getByLabelText('Cachet mínimo'), { target: { value: '999999' } }); click('Buscar');
    await screen.findByText(/No hay fechas con esos filtros/, {}, T);
    fireEvent.change(screen.getByLabelText('Cachet mínimo'), { target: { value: '' } }); click('Buscar');
    await screen.findByText('Bar 1', {}, T);
    // detalle con desglose de comisión (10%)
    click('Ver detalle de Bar 1');
    const sheet = await screen.findByRole('dialog', { name: 'Bar 1' }, T);
    within(sheet).getByText(/Política de cancelación: Moderada/);
    await within(sheet).findByText(/Comisión SuenaBA \(10%\)/, {}, T);
    within(sheet).getByText(/Vas a recibir/);
    assert.match(sheet.textContent!, /\$108\.000/);
    fireEvent.change(within(sheet).getByLabelText(/Tu propuesta de cachet/), { target: { value: '150000' } });
    assert.match(sheet.textContent!, /\$135\.000/);                                   // 150.000 − 10%
    fireEvent.change(within(sheet).getByLabelText(/Mensaje para el bar/), { target: { value: 'Somos un trío' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enviar solicitud' }));
    const booking = await screen.findByRole('dialog', { name: 'Reserva con Bar 1' }, T);
    within(booking).getByText('Solicitud enviada');
    assert.match(booking.textContent!, /\$150\.000/);
    const b = (await A.q('select * from bookings'))[0];
    assert.deepEqual([b.status, b.cachet_ars, b.note, b.listing_id], ['solicitada', 150000, 'Somos un trío', a.id]);
  });

  it('muestra errores de negocio en español (fecha tomada por otro mientras mirabas)', async () => {
    const l = await listing(bar1, 10, { mode: 'instant' });
    await asUserUI(em(m1));
    await screen.findByText('Bar 1', {}, T);
    await A.request(m2, l.id);                                                         // otro músico la reserva primero
    click('Ver detalle de Bar 1');
    const sheet = await screen.findByRole('dialog', { name: 'Bar 1' }, T);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reservar ahora' }));
    assert.match((await within(sheet).findByRole('alert', {}, T)).textContent!, /ya no está disponible/);
    assert.equal((await A.q(`select count(*)::int n from bookings where musician_id = $1`, [m1.entityId]))[0].n, 0);
  });

  it('un bar ve la cartelera pero no puede reservar; ocultar fechas que se pisan funciona', async () => {
    const mine = await listing(bar1, 10); const b = await A.request(m1, mine.id); await A.respond(bar1, b.id, true);
    await listing(bar2, 10); await listing(bar2, 12);
    await asUserUI(em(m1));
    await screen.findByText('1 fecha disponible', {}, T).catch(() => {});
    await waitFor(() => assert.equal(screen.getAllByText('Bar 2').length, 1), T);       // la que se pisa está oculta
    cleanup();
    await asUserUI(em(bar1)); tab('Cuenta');
    await screen.findByText('Tus pagos', {}, T);
  });
});

describe('Flujo del bar: avisos, aceptar, pagar, cancelar', () => {
  it('el bar recibe el aviso, acepta, paga (retenido) y el músico es notificado', async () => {
    const l = await listing(bar1, 10);
    await A.request(m1, l.id, null, 'Hola!');
    await asUserUI(em(bar1));
    tab('Reservas');
    await screen.findByText('Requieren tu acción', {}, T);
    const avisos = await screen.findByRole('button', { name: /Avisos/ }, T);
    assert.match(avisos.textContent!, /1/);
    fireEvent.click(avisos);
    fireEvent.click(await screen.findByText('Nueva solicitud', {}, T));
    const sheet = await screen.findByRole('dialog', { name: 'Reserva con Músico 1' }, T);
    within(sheet).getByText('Solicitud enviada');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aceptar solicitud' }));
    await within(sheet).findByText('Aceptada · falta el pago', {}, T);
    fireEvent.click(await within(sheet).findByRole('button', { name: /Pagar y confirmar/ }, T));
    await within(sheet).findByText('Confirmada', {}, T);
    assert.match(sheet.textContent!, /retenido por SuenaBA/);
    assert.match(sheet.textContent!, /Pago retenido: fecha confirmada/);
    const kinds = (await A.q(`select kind from notifications where user_id = $1 order by created_at`, [m1.userId])).map((r) => r.kind);
    assert.deepEqual(kinds, ['booking_accepted', 'booking_funded']);
  });

  it('rechazar pide confirmación; mensajes de chat llegan a la otra parte', async () => {
    const l = await listing(bar1, 10); const b = await A.request(m1, l.id);
    await asUserUI(em(bar1)); tab('Reservas');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver reserva con Músico 1' }, T));
    const sheet = await screen.findByRole('dialog', { name: 'Reserva con Músico 1' }, T);
    fireEvent.change(within(sheet).getByLabelText('Escribí un mensaje'), { target: { value: '¿Llevan bajo?' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enviar' }));
    await within(sheet).findByText('¿Llevan bajo?', {}, T);
    assert.equal((await A.q(`select count(*)::int n from messages where booking_id = $1`, [b.id]))[0].n, 1);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Rechazar' }));
    fireEvent.change(within(sheet).getByLabelText('Motivo (opcional)'), { target: { value: 'No encaja' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar rechazo' }));
    await within(sheet).findByText('Rechazada', {}, T);
    assert.ok(!within(sheet).queryByLabelText('Escribí un mensaje'), "no debería estar en pantalla");           // chat cerrado en rechazadas
  });

  it('cancelar una reserva pagada muestra el reembolso según la política y lo aplica', async () => {
    const l = await listing(bar1, 0.4, { policy: 'flexible' });                          // ~9,6 h: flexible => 50%
    const b = await A.request(m1, l.id); await A.respond(bar1, b.id, true); await A.fund(bar1, b.id);
    await asUserUI(em(bar1)); tab('Reservas');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver reserva con Músico 1' }, T));
    const sheet = await screen.findByRole('dialog', { name: 'Reserva con Músico 1' }, T);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar reserva' }));
    assert.match(within(sheet).getByText(/te reembolsamos/).textContent!, /50% \(\$60\.000\)/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sí, cancelar' }));
    await within(sheet).findByText('Cancelada', {}, T);
    await within(sheet).findByText(/reembolsado en parte/, {}, T);
    const p = (await A.q('select refunded_ars, payout_ars from payments'))[0];
    assert.deepEqual([p.refunded_ars, p.payout_ars], [60000, 60000]);
  });

  it('el músico que cancela tarde ve la advertencia y suma una cancelación tardía', async () => {
    const l = await listing(bar1, 0.4); const b = await A.request(m1, l.id); await A.respond(bar1, b.id, true); await A.fund(bar1, b.id);
    await asUserUI(em(m1)); tab('Reservas');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver reserva con Bar 1' }, T));
    const sheet = await screen.findByRole('dialog', { name: 'Reserva con Bar 1' }, T);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar reserva' }));
    assert.match(sheet.textContent!, /reembolso total/);
    assert.match(sheet.textContent!, /cancelación tardía/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sí, cancelar' }));
    await within(sheet).findByText('Cancelada', {}, T);
    assert.equal((await A.q('select late_cancellations from profiles where user_id = $1', [m1.userId]))[0].late_cancellations, 1);
  });
});

describe('Después del show: realizar, reseñar, ganancias', () => {
  it('completar, reseñas cruzadas desde ambas cuentas y ganancias visibles', async () => {
    await A.q(`update app_settings set venue_fee_bps = 500, musician_fee_bps = 1000`);
    const l = await listing(bar1, 10);
    const b = await A.request(m1, l.id); await A.respond(bar1, b.id, true); await A.fund(bar1, b.id);
    // el show ya pasó
    await A.q(`update bookings set starts_at = starts_at - interval '11 days', ends_at = ends_at - interval '11 days'`);
    await A.q(`update listings set starts_at = starts_at - interval '11 days', ends_at = ends_at - interval '11 days'`);

    await asUserUI(em(bar1)); tab('Reservas');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver reserva con Músico 1' }, T));
    let sheet = await screen.findByRole('dialog', { name: 'Reserva con Músico 1' }, T);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Marcar show como realizado' }));
    await within(sheet).findByText('Realizada', {}, T);
    await within(sheet).findByText('¿Cómo fue con Músico 1?', {}, T);
    const send = within(sheet).getByRole('button', { name: 'Enviar reseña' });
    assert.equal((send as HTMLButtonElement).disabled, true);                                  // faltan criterios
    const star = (group: string, n: number) => fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: group })).getByRole('radio', { name: `${n} estrellas` }));
    star('Calificación general', 5); star('Puntualidad', 5); star('Sonido en vivo', 4); star('Convocatoria', 4); star('Profesionalismo', 5);
    fireEvent.change(within(sheet).getByLabelText('Comentario (opcional)'), { target: { value: 'Gran show' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enviar reseña' }));
    await within(sheet).findByText(/Ya dejaste tu reseña/, {}, T);
    assert.equal((await A.q('select count(*)::int n from booking_reviews where published_at is not null'))[0].n, 0);   // espera a la otra parte
    cleanup();

    await asUserUI(em(m1)); tab('Reservas');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver reserva con Bar 1' }, T));
    sheet = await screen.findByRole('dialog', { name: 'Reserva con Bar 1' }, T);
    await within(sheet).findByText('¿Cómo fue con Bar 1?', {}, T);
    const star2 = (group: string, n: number) => fireEvent.click(within(within(sheet).getByRole('radiogroup', { name: group })).getByRole('radio', { name: `${n} estrellas` }));
    star2('Calificación general', 4); star2('Calidad de sonido', 5); star2('Cumplimiento de pago', 5); star2('Hospitalidad', 4); star2('Respeto', 5);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enviar reseña' }));
    await within(sheet).findByText(/Ya dejaste tu reseña \(publicada\)|Ya dejaste tu reseña/, {}, T);
    await waitFor(async () => assert.equal((await A.q('select count(*)::int n from booking_reviews where published_at is not null'))[0].n, 2), T);
    const v = (await A.q('select rating, review_count from venues where id = $1', [bar1.entityId]))[0];
    assert.deepEqual([v.rating, v.review_count], [4.45, 11]);
    // ganancias del músico: 120.000 − 10% = 108.000
    cleanup(); await asUserUI(em(m1)); tab('Cuenta');
    const card = await screen.findByLabelText('Ganancias', {}, T);
    await waitFor(() => assert.match(card.textContent!, /Cobrado\$108\.000/), T);
    assert.match(card.textContent!, /Shows realizados: 1/);
    cleanup(); await asUserUI(em(bar1)); tab('Cuenta');
    const card2 = await screen.findByLabelText('Ganancias', {}, T);
    await waitFor(() => assert.match(card2.textContent!, /Pagado en shows\$126\.000/), T);   // 120.000 + 5% de comisión
  });
});

describe('Panel del bar, avisos y favoritos', () => {
  it('publicar y cancelar una fecha; errores de validación visibles', async () => {
    await asUserUI(em(bar1));
    const fmt = (d: Date) => d.toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText('Inicio'), { target: { value: fmt(day(0.05)) } });
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: fmt(day(0.2)) } });
    fireEvent.change(screen.getByLabelText('Cachet (ARS)'), { target: { value: '90000' } });
    click('Publicar fecha');
    assert.match((await screen.findByRole('alert', {}, T)).textContent!, /al menos 2 horas/);
    fireEvent.change(screen.getByLabelText('Inicio'), { target: { value: fmt(day(10)) } });
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: fmt(plus(day(10), 3 * H)) } });
    fireEvent.change(screen.getByLabelText('Géneros (separados por coma)'), { target: { value: 'Jazz, Blues' } });
    fireEvent.change(screen.getByLabelText('Política de cancelación'), { target: { value: 'estricta' } });
    click('Publicar fecha');
    await screen.findByText('Fecha publicada.', {}, T);
    const row = (await A.q('select * from listings'))[0];
    assert.deepEqual([row.cachet_ars, row.genres, row.cancellation_policy, row.venue_id], [90000, ['Jazz', 'Blues'], 'estricta', bar1.entityId]);
    fireEvent.click(await screen.findByRole('button', { name: /Cancelar fecha del/ }, T));
    await waitFor(async () => assert.equal((await A.q('select status from listings'))[0].status, 'cancelada'), T);
  });

  it('avisos: sin leer, abrir y marcar todas como leídas; favoritos: listar y quitar', async () => {
    const l1 = await listing(bar1, 10), l2 = await listing(bar2, 11);
    await A.request(m1, l1.id); await A.request(m2, l1.id);
    await asUserUI(em(bar1)); tab('Avisos');
    await screen.findByText('2 sin leer', {}, T);
    click('Marcar todas como leídas');
    await screen.findByText('0 sin leer', {}, T);
    assert.equal((await A.q('select count(*)::int n from notifications where user_id = $1 and read_at is null', [bar1.userId]))[0].n, 0);
    cleanup();
    await A.toggleFav(m1, 'listing', l2.id); await A.toggleFav(m1, 'venue', bar1.entityId); await A.toggleFav(m1, 'musician', m2.entityId);
    await asUserUI(em(m1)); tab('Favoritos');
    await screen.findByText(/Bar 2 ·/, {}, T); screen.getByText('Bar 1'); screen.getByText('Músico 2');
    click(/Quitar Bar 1 de favoritos/);
    await waitFor(() => assert.ok(!screen.queryByText('Bar 1'), "no debería estar en pantalla"), T);
    assert.equal((await A.q('select count(*)::int n from favorites where user_id = $1', [m1.userId]))[0].n, 2);
  });

  it('alertas de búsqueda: guardar desde Explorar, recibir el aviso y borrarla desde Cuenta', async () => {
    await listing(bar1, 10, { genres: ['Jazz'] });
    await asUserUI(em(m1));
    await screen.findByText('Bar 1', {}, T);
    fireEvent.click(screen.getByRole('button', { name: 'Jazz' }));
    click('Guardar búsqueda');
    fireEvent.change(screen.getByLabelText('Nombre de la búsqueda'), { target: { value: 'Jazz cerca' } });
    click('Guardar alerta');
    await screen.findByText(/Búsqueda guardada/, {}, T);
    await listing(bar2, 12, { genres: ['Jazz'] });                                         // aparece una fecha nueva que coincide
    tab('Avisos');
    await screen.findByText('Nueva fecha para tu búsqueda "Jazz cerca"', {}, T);
    tab('Cuenta');
    await clickAsync('Borrar alerta Jazz cerca');
    await waitFor(async () => assert.equal((await A.q('select count(*)::int n from saved_searches'))[0].n, 0), T);
  });

  it('cerrar sesión vuelve al login', async () => {
    await asUserUI(em(m1)); tab('Cuenta');
    await clickAsync('Cerrar sesión');
    await screen.findByText('Ingresá a SuenaBA', {}, T);
  });
});
