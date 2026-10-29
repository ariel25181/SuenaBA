import './setup.ts';
import React from 'react';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, checkInvariants, type Actor, type Api } from '../db/helpers.ts';
import { createPgClient } from './pgClient.ts';
import { SessionProvider } from '../../src/context/SessionContext.tsx';
import { ReservasApp } from '../../src/components/reservas/ReservasApp.tsx';
import { TOUR_VERSION } from '../../src/content/tour.ts';
import { latestNovedadId } from '../../src/content/novedades.ts';
import { setPushEnv, type PushEnv, type PushSub } from '../../src/lib/push.ts';

const DB = 'suenaba_avisosui';
let pool: pg.Pool, A: Api;
let bar1: Actor, m1: Actor;
const T = { timeout: 5000 };
const em = (a: Actor) => `${a.entityId}@t.com`;

function fakeEnv(o: { permission?: 'default' | 'granted' | 'denied' | 'unsupported'; key?: string; ask?: 'granted' | 'denied'; keys?: { p256dh: string; auth: string } } = {}) {
  let perm = o.permission ?? 'default', sub: PushSub | null = null; const log = { unsubscribed: 0, asked: 0 };
  const keys = o.keys ?? { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) };
  const env: PushEnv = {
    vapidKey: o.key ?? 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', userAgent: 'jsdom-test',
    permission: () => perm, requestPermission: async () => { log.asked++; perm = o.ask ?? 'granted'; return perm as any; },
    registration: async () => ({ pushManager: { getSubscription: async () => sub, subscribe: async () => { sub = { endpoint: 'https://push.example.com/device-1', toJSON: () => ({ endpoint: 'https://push.example.com/device-1', keys }), unsubscribe: async () => { log.unsubscribed++; sub = null; return true; } }; return sub; } } }),
  };
  return { env, log };
}
async function open(who: Actor) {
  localStorage.setItem('suenaba:prefs:v1', JSON.stringify({ audience: who.role === 'bar' ? 'anfitrion' : 'musico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() }));
  const session: { userId: string | null; email?: string } = { userId: null };
  render(<SessionProvider client={createPgClient(pool, session)}><ReservasApp /></SessionProvider>);
  fireEvent.change(await screen.findByLabelText('Email', {}, T), { target: { value: em(who) } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
  await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T);
  fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  return await screen.findByLabelText('Avisos', {}, T);
}
const dbPrefs = async (u: string) => (await A.q('select * from notification_prefs where user_id = $1', [u]))[0];

before(async () => { pool = await createTestDb(DB, 15); A = api(pool); });
after(async () => { cleanup(); (globalThis as any).window?.close?.(); setPushEnv(null); await dropTestDb(pool, DB); });
beforeEach(async () => { localStorage.clear(); await resetData(pool); const w = await seedActors(pool, 1, 1); [bar1] = w.bars; [m1] = w.mus; setPushEnv(fakeEnv().env); });
afterEach(async () => { cleanup(); const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Preferencias de avisos (email, chat y alertas)', () => {
  it('por defecto todo activo; se guardan los cambios en la cuenta', async () => {
    const card = await open(m1);
    const email = within(card).getByLabelText('Recibir avisos por email') as HTMLInputElement, chat = within(card).getByLabelText('Avisar cuando me escriben en un chat') as HTMLInputElement, alerts = within(card).getByLabelText('Avisar de fechas nuevas de mis alertas') as HTMLInputElement;
    assert.deepEqual([email.checked, chat.checked, alerts.checked], [true, true, true]);
    fireEvent.click(email);
    await waitFor(async () => assert.equal((await dbPrefs(m1.userId))?.email_enabled, false), T);
    fireEvent.click(within(card).getByLabelText('Avisar cuando me escriben en un chat'));
    await waitFor(async () => assert.deepEqual((await dbPrefs(m1.userId)).muted_kinds, ['message']), T);
    fireEvent.click(within(card).getByLabelText('Avisar de fechas nuevas de mis alertas'));
    await waitFor(async () => assert.deepEqual((await dbPrefs(m1.userId)).muted_kinds.sort(), ['message', 'search_match']), T);
    fireEvent.click(within(card).getByLabelText('Avisar cuando me escriben en un chat'));
    await waitFor(async () => assert.deepEqual((await dbPrefs(m1.userId)).muted_kinds, ['search_match']), T);
    assert.equal((await dbPrefs(m1.userId)).email_enabled, false);                                    // no pisa lo anterior
  });
  it('un bar no ve la opción de alertas de búsqueda', async () => {
    const card = await open(bar1);
    within(card).getByLabelText('Recibir avisos por email');
    assert.ok(!within(card).queryByLabelText('Avisar de fechas nuevas de mis alertas'));
  });
});

describe('Avisos en este dispositivo (push)', () => {
  it('activar registra el dispositivo en la cuenta y desactivar lo elimina', async () => {
    const f = fakeEnv(); setPushEnv(f.env);
    const card = await open(m1);
    await within(card).findByText('Desactivadas en este dispositivo.', {}, T);
    fireEvent.click(within(card).getByRole('button', { name: 'Activar avisos en este dispositivo' }));
    await within(card).findByText('Activadas en este dispositivo.', {}, T);
    assert.equal(f.log.asked, 1);
    const sub = (await A.q('select * from push_subscriptions'))[0];
    assert.deepEqual([sub.user_id, sub.endpoint, sub.user_agent], [m1.userId, 'https://push.example.com/device-1', 'jsdom-test']);
    fireEvent.click(within(card).getByRole('button', { name: 'Desactivar en este dispositivo' }));
    await within(card).findByText('Desactivadas en este dispositivo.', {}, T);
    assert.equal((await A.q('select count(*)::int n from push_subscriptions'))[0].n, 0);
    assert.equal(f.log.unsubscribed, 1);
  });
  it('si el usuario no da permiso, lo explica y no registra nada', async () => {
    const f = fakeEnv({ ask: 'denied' }); setPushEnv(f.env);
    const card = await open(m1);
    fireEvent.click(await within(card).findByRole('button', { name: 'Activar avisos en este dispositivo' }, T));
    await within(card).findByText(/Bloqueaste las notificaciones/, {}, T);
    assert.ok(!within(card).queryByRole('button', { name: 'Activar avisos en este dispositivo' }));
    assert.equal((await A.q('select count(*)::int n from push_subscriptions'))[0].n, 0);
  });
  it('mensajes claros cuando el navegador no soporta push o falta la clave del servidor', async () => {
    setPushEnv(fakeEnv({ permission: 'unsupported' }).env);
    let card = await open(m1); await within(card).findByText(/no permite notificaciones/, {}, T); assert.ok(!within(card).queryByRole('button', { name: /Activar avisos/ }));
    cleanup();
    setPushEnv(fakeEnv({ key: '' }).env);
    card = await open(m1); await within(card).findByText(/todavía no están habilitadas/, {}, T);
  });
  it('si el servidor rechaza el dispositivo, muestra el error y no deja una suscripción huérfana', async () => {
    const f = fakeEnv({ keys: { p256dh: 'corta', auth: 'x' } }); setPushEnv(f.env);
    const card = await open(m1);
    fireEvent.click(await within(card).findByRole('button', { name: 'Activar avisos en este dispositivo' }, T));
    assert.match((await within(card).findByRole('alert', {}, T)).textContent!, /No pudimos registrar este dispositivo/);
    assert.equal(f.log.unsubscribed, 1);
    assert.equal((await A.q('select count(*)::int n from push_subscriptions'))[0].n, 0);
    await within(card).findByText('Desactivadas en este dispositivo.', {}, T);
  });
});
