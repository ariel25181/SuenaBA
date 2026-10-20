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
import { TOUR, TOUR_VERSION } from '../../src/content/tour.ts';
import { latestNovedadId, novedadesFor, unreadNovedades } from '../../src/content/novedades.ts';

const DB = 'suenaba_tourui';
let pool: pg.Pool, A: Api;
let bar1: Actor, bar2: Actor, m1: Actor, m2: Actor;
const T = { timeout: 5000 };
const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const KEY = 'suenaba:prefs:v1';
const setPrefs = (p: Record<string, unknown>) => localStorage.setItem(KEY, JSON.stringify(p));
const getPrefs = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');
const em = (a: Actor) => `${a.entityId}@t.com`;

function mount() { const session: { userId: string | null; email?: string } = { userId: null }; return render(<SessionProvider client={createPgClient(pool, session)}><ReservasApp /></SessionProvider>); }
async function login(email: string) {
  fireEvent.change(await screen.findByLabelText('Email', {}, T), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const tourDialog = () => screen.queryByRole('dialog', { name: 'Tour de bienvenida' });
async function walkTour(audience: 'anfitrion' | 'musico' | 'publico', finishLabel: string) {
  const dlg = await screen.findByRole('dialog', { name: 'Tour de bienvenida' }, T);
  const n = TOUR[audience].length;
  for (let i = 1; i < n; i++) { within(dlg).getByText(`Paso ${i} de ${n}`); fireEvent.click(within(dlg).getByRole('button', { name: 'Siguiente' })); }
  within(dlg).getByText(`Paso ${n} de ${n}`);
  fireEvent.click(within(dlg).getByRole('button', { name: finishLabel }));
  await waitFor(() => assert.ok(!tourDialog(), 'el tour debería cerrarse'), T);
}
async function confirmedShow(bar: Actor, mus: Actor, days: number, genres: string[]) {
  const starts = day(days);
  const l = await A.createListing(bar, { starts, ends: plus(starts, 3 * H), cachet: 100000, genres } as any);
  const b = await A.request(mus, l.id); await A.respond(bar, b.id, true); await A.fund(bar, b.id);
}

before(async () => { pool = await createTestDb(DB, 20); A = api(pool); });
after(async () => { cleanup(); (globalThis as any).window?.close?.(); await dropTestDb(pool, DB); });
beforeEach(async () => { localStorage.clear(); await resetData(pool); const w = await seedActors(pool, 2, 2); [bar1, bar2] = w.bars; [m1, m2] = w.mus; });
afterEach(async () => { cleanup(); const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Bienvenida: tipo de uso y tour', () => {
  it('primera visita: pregunta el tipo de uso, hace el tour completo y no lo repite', async () => {
    mount();
    await screen.findByText('¿Cómo vas a usar SuenaBA?', {}, T);
    screen.getByRole('button', { name: /Soy anfitrión/ }); screen.getByRole('button', { name: /Soy músico o banda/ }); screen.getByRole('button', { name: /Soy público/ });
    assert.ok(!tourDialog());
    fireEvent.click(screen.getByRole('button', { name: /Soy músico o banda/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Tour de bienvenida' }, T);
    within(dlg).getByText('Bienvenido, músico');
    assert.equal((within(dlg).getByRole('button', { name: 'Atrás' }) as HTMLButtonElement).disabled, true);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Siguiente' }));
    within(dlg).getByText('Explorá y filtrá'); within(dlg).getByText(`Paso 2 de ${TOUR.musico.length}`);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Atrás' }));
    within(dlg).getByText('Bienvenido, músico');
    await walkTour('musico', 'Empezar');
    await screen.findByText('Ingresá a SuenaBA', {}, T);                                    // ya puede entrar / crear su perfil
    assert.deepEqual(getPrefs(), { audience: 'musico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() });
    cleanup(); mount();
    await screen.findByText('Ingresá a SuenaBA', {}, T);
    assert.ok(!tourDialog()); assert.ok(!screen.queryByText('¿Cómo vas a usar SuenaBA?'));
  });

  it('el tour de cada tipo de uso es distinto y tiene su último paso', async () => {
    for (const [btn, audience, intro] of [[/Soy anfitrión/, 'anfitrion', 'Bienvenido, anfitrión'], [/Soy músico o banda/, 'musico', 'Bienvenido, músico'], [/Soy público/, 'publico', 'Bienvenido']] as const) {
      localStorage.clear(); mount();
      fireEvent.click(await screen.findByRole('button', { name: btn }, T));
      const dlg = await screen.findByRole('dialog', { name: 'Tour de bienvenida' }, T);
      within(dlg).getByText(intro, { exact: true });
      within(dlg).getByText(`Paso 1 de ${TOUR[audience].length}`);
      cleanup();
    }
  });

  it('saltar el tour lo da por visto pero deja las novedades sin ver', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Soy anfitrión/ }, T));
    const dlg = await screen.findByRole('dialog', { name: 'Tour de bienvenida' }, T);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Saltar tour' }));
    await waitFor(() => assert.ok(!tourDialog()), T);
    const n = unreadNovedades('anfitrion', 0);
    await screen.findByRole('button', { name: `Novedades, ${n} sin ver` }, T);
    assert.equal(getPrefs().tourVersion, TOUR_VERSION);
    assert.equal(getPrefs().whatsNewSeen, 0);
  });

  it('el botón "Tour" lo reabre cuando quieras', async () => {
    setPrefs({ audience: 'musico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() });
    mount(); await screen.findByText('Ingresá a SuenaBA', {}, T);
    assert.ok(!tourDialog());
    click('Ver el tour de bienvenida');
    await screen.findByRole('dialog', { name: 'Tour de bienvenida' }, T);
  });
});

describe('Público: cartelera sin cuenta', () => {
  it('ve los shows confirmados, filtra y puede cambiar su tipo de uso', async () => {
    await A.q(`update venues set neighborhood = 'San Telmo' where id = $1`, [bar2.entityId]);
    await confirmedShow(bar1, m1, 10, ['Jazz']); await confirmedShow(bar2, m2, 11, ['Rock']);
    const open = await A.createListing(bar1, { starts: day(12), ends: plus(day(12), 3 * H), cachet: 5 } as any); await A.request(m1, open.id);   // solicitada: no debe verse
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Soy público/ }, T));
    await walkTour('publico', 'Ver la cartelera');
    await screen.findByText('Cartelera de shows en vivo', {}, T);
    await screen.findByText('Músico 1', {}, T); screen.getByText('Músico 2');
    await screen.findByText('2 shows confirmados');
    assert.ok(!screen.queryByText('Ingresá a SuenaBA'));                                       // sin login
    fireEvent.click(screen.getByRole('button', { name: 'San Telmo' }));
    await screen.findByText('1 show confirmado', {}, T);
    assert.ok(!screen.queryByText('Músico 1')); screen.getByText('Músico 2');
    fireEvent.click(screen.getByRole('button', { name: 'San Telmo' })); fireEvent.click(screen.getByRole('button', { name: 'Jazz' }));
    await screen.findByText('Músico 1', {}, T); assert.ok(!screen.queryByText('Músico 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar mi tipo de uso' }));
    await screen.findByText('¿Cómo vas a usar SuenaBA?', {}, T);
    assert.equal(getPrefs().audience, null);
  });

  it('sin shows confirmados muestra un mensaje claro', async () => {
    setPrefs({ audience: 'publico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() });
    mount(); await screen.findByText(/Todavía no hay shows confirmados/, {}, T);
  });
});

describe('Quien ya tiene perfil: el tour se sincroniza con su cuenta', () => {
  it('lo ve una vez y en otro dispositivo no se repite', async () => {
    setPrefs({ audience: 'anfitrion', tourVersion: 0, whatsNewSeen: 0 });
    mount(); await login(em(bar1));
    await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T);
    const dlg = await screen.findByRole('dialog', { name: 'Tour de bienvenida' }, T);
    within(dlg).getByText('Bienvenido, anfitrión');
    await walkTour('anfitrion', 'Empezar');
    await waitFor(async () => {
      const r = (await A.q('select * from user_prefs where user_id = $1', [bar1.userId]))[0];
      assert.deepEqual([r?.audience, r?.tour_version, r?.whats_new_seen], ['anfitrion', TOUR_VERSION, latestNovedadId()]);
    }, T);
    cleanup();
    setPrefs({ audience: 'anfitrion', tourVersion: 0, whatsNewSeen: 0 });                    // "otro dispositivo": sin nada guardado
    mount(); await login(em(bar1));
    await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T);
    await waitFor(() => assert.ok(!tourDialog(), 'no debería repetir el tour'), T);
    await screen.findByRole('button', { name: 'Novedades' }, T);                             // y sin novedades pendientes
  });

  it('el tipo de uso lo define el perfil, aunque el dispositivo diga otra cosa', async () => {
    setPrefs({ audience: 'publico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() });
    mount(); await screen.findByText('Cartelera de shows en vivo', {}, T);
    cleanup();
    setPrefs({ audience: 'musico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() });
    mount(); await login(em(bar1));
    await screen.findByRole('button', { name: 'Mis fechas' }, T);                            // es un bar: ve el panel del bar
    await waitFor(() => assert.equal(getPrefs().audience, 'anfitrion'), T);
  });
});

describe('Novedades', () => {
  it('cuenta las nuevas, las lista por tipo de uso, las marca como vistas y lleva a probarlas', async () => {
    const latest = latestNovedadId();
    setPrefs({ audience: 'musico', tourVersion: TOUR_VERSION, whatsNewSeen: latest - 2 });
    mount(); await login(em(m1));
    await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T);
    fireEvent.click(await screen.findByRole('button', { name: 'Novedades, 2 sin ver' }, T));
    const dlg = await screen.findByRole('dialog', { name: 'Novedades' }, T);
    const titles = within(dlg).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    assert.deepEqual(titles, novedadesFor('musico').map((n) => n.title));                    // de la más nueva a la más vieja
    assert.equal(within(dlg).getAllByText('Nuevo').length, 2);
    within(dlg).getByText('Alertas de búsqueda');                                              // exclusiva de músicos
    fireEvent.click(within(dlg).getByRole('button', { name: 'Probar ahora: Tour de bienvenida y novedades' }));
    await screen.findByText('Ayuda', {}, T);                                                  // fue a "Cuenta"
    assert.ok(!screen.queryByRole('dialog', { name: 'Novedades' }));
    await screen.findByRole('button', { name: 'Novedades' }, T);                             // contador en cero
    await waitFor(async () => assert.equal((await A.q('select whats_new_seen from user_prefs where user_id = $1', [m1.userId]))[0]?.whats_new_seen, latest), T);
  });

  it('un bar no ve las novedades exclusivas de músicos, y "Probar ahora" abre la pestaña correspondiente', async () => {
    setPrefs({ audience: 'anfitrion', tourVersion: TOUR_VERSION, whatsNewSeen: 0 });
    mount(); await login(em(bar1));
    await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T);
    fireEvent.click(await screen.findByRole('button', { name: /^Novedades/ }, T));
    const dlg = await screen.findByRole('dialog', { name: 'Novedades' }, T);
    assert.ok(!within(dlg).queryByText('Alertas de búsqueda')); assert.ok(!within(dlg).queryByText('Explorá con filtros'));
    within(dlg).getByText('Reservas estilo Airbnb');
    assert.ok(!within(dlg).queryByRole('button', { name: 'Probar ahora: Cartelera pública' }), 'esa pestaña no existe para un bar');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Probar ahora: Favoritos' }));
    await screen.findByText(/Todavía no guardaste favoritos/, {}, T);
  });

  it('desde Cuenta se puede repetir el tour y abrir novedades; quien ya tiene perfil no puede cambiar de tipo de uso', async () => {
    setPrefs({ audience: 'musico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() });
    mount(); await login(em(m1));
    await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T);
    click('Cuenta');
    fireEvent.click(await screen.findByRole('button', { name: 'Ver el tour otra vez' }, T));
    await screen.findByRole('dialog', { name: 'Tour de bienvenida' }, T);
    assert.ok(!screen.queryByRole('button', { name: 'Cambiar mi tipo de uso' }));
  });
});
