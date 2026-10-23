import './setup.ts';
import React from 'react';
import crypto from 'node:crypto';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import type pg from 'pg';
import { createTestDb, dropTestDb, resetData, seedActors, api, asUser, asSystem, checkInvariants, H, D, type Actor, type Api } from '../db/helpers.ts';
import { createPgClient } from './pgClient.ts';
import { startFake, type Fake } from '../delivery/fakes.ts';
import { mp, mpHandler, setPayment, resetMp } from '../delivery/fakeMp.ts';
import { handleCreatePayment, handleWebhook, type PayDeps } from '../../supabase/functions/_shared/payments.ts';
import { supabasePayDeps } from '../../supabase/functions/_shared/paymentsSupabase.ts';
import { SessionProvider } from '../../src/context/SessionContext.tsx';
import { ReservasApp } from '../../src/components/reservas/ReservasApp.tsx';
import { TOUR_VERSION } from '../../src/content/tour.ts';
import { latestNovedadId } from '../../src/content/novedades.ts';
import { pollConfig, setRedirect } from '../../src/lib/paymentRedirect.ts';

const DB = 'suenaba_pagosui';
const SECRET = 'webhook-secret-de-prueba-1234567890';
let pool: pg.Pool, A: Api, mpServer: Fake;
let bar1: Actor, m1: Actor;
const T = { timeout: 6000 };
const day = (n: number) => new Date(Date.now() + n * D);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
const em = (a: Actor) => `${a.entityId}@t.com`;
const redirects: string[] = [];

const rpcAs = (userId: string | null, role: 'authenticated' | 'postgres' = 'postgres') => ({
  async rpc(fn: string, args: Record<string, unknown> = {}) {
    const keys = Object.keys(args);
    try {
      const rows = await asUser(pool, userId, async (c) => (await c.query(`select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map((k) => args[k]))).rows, { role });
      if (rows.length === 1 && Object.keys(rows[0]).length === 1 && fn in rows[0]) return { data: rows[0][fn], error: null };
      return { data: rows, error: null };
    } catch (e: any) { return { data: null, error: { message: e.message } }; }
  },
});
const payDeps = (): PayDeps => ({ mp: { accessToken: 'APP_USR-test-token', baseUrl: mpServer.url }, appUrl: 'https://suenaba.test', functionsUrl: 'https://proj.supabase.co/functions/v1', webhookSecret: SECRET, ...supabasePayDeps(rpcAs(null), (jwt) => rpcAs(jwt, 'authenticated')) });
const sign = (id: string) => { const ts = Math.floor(Date.now() / 1000); return `ts=${ts},v1=${crypto.createHmac('sha256', SECRET).update(`id:${id};request-id:r1;ts:${ts};`).digest('hex')}`; };
const pay = (id: string, ref: string, amount: number) => { setPayment(id, { ref, amount }); return handleWebhook(new Request(`https://f.test/mp-webhook?data.id=${id}&type=payment`, { method: 'POST', headers: { 'x-signature': sign(id), 'x-request-id': 'r1' }, body: '{}' }), payDeps()); };

/** Cliente de la app con `functions.invoke` conectado al código real de create-payment. */
function mount(who: Actor, search = '') {
  localStorage.setItem('suenaba:prefs:v1', JSON.stringify({ audience: who.role === 'bar' ? 'anfitrion' : 'musico', tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() }));
  window.history.replaceState({}, '', '/' + search);
  const session: { userId: string | null; email?: string } = { userId: null };
  const client: any = createPgClient(pool, session);
  client.functions = { invoke: async (_n: string, { body }: any) => {
    const res = await handleCreatePayment(new Request('https://f.test/create-payment', { method: 'POST', headers: { authorization: `Bearer ${session.userId}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), payDeps());
    const j = await res.json(); return res.ok ? { data: j, error: null } : { data: null, error: { message: 'non-2xx', context: { json: async () => j } } };
  } };
  render(<SessionProvider client={client}><ReservasApp /></SessionProvider>);
  return session;
}
async function login(who: Actor) {
  fireEvent.change(await screen.findByLabelText('Email', {}, T), { target: { value: em(who) } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
  await screen.findByRole('navigation', { name: 'Secciones de reservas' }, T);
}
async function accepted(days: number, extra: Record<string, unknown> = {}) {
  const starts = day(days), l = await A.createListing(bar1, { starts, ends: plus(starts, 3 * H), cachet: 100000, ...extra } as any);
  const b = await A.request(m1, l.id); await A.respond(bar1, b.id, true); return { id: b.id as string, starts };
}
async function openBooking(name: string) { fireEvent.click(await screen.findByRole('button', { name: 'Reservas' }, T)); fireEvent.click(await screen.findByRole('button', { name }, T)); return await screen.findByRole('dialog', { name: /Reserva con/ }, T); }
const intent = async (id: string) => (await A.q('select * from payment_intents where booking_id = $1', [id]))[0];

before(async () => { pool = await createTestDb(DB, 20); A = api(pool); });
after(async () => { cleanup(); (globalThis as any).window?.close?.(); setRedirect(null); await mpServer?.close(); await dropTestDb(pool, DB); });
beforeEach(async () => {
  localStorage.clear(); await resetData(pool); const w = await seedActors(pool, 1, 1); [bar1] = w.bars; [m1] = w.mus; resetMp(); redirects.length = 0;
  setRedirect((u) => redirects.push(u)); pollConfig.ms = 40; pollConfig.max = 60;
  await A.q(`update app_settings set payment_mode = 'mercadopago', venue_fee_bps = 500`);
  mpServer = await startFake((req, body) => mpHandler(req, body));
});
afterEach(async () => { cleanup(); await mpServer.close(); const bad = await checkInvariants(pool, { singlePublishedAllowed: true }); assert.deepEqual(bad, [], bad.join('\n')); });

describe('Pagar con Mercado Pago (bar)', () => {
  it('muestra el total con comisión, crea el pago y redirige al checkout (sin ofrecer el pago simulado)', async () => {
    const b = await accepted(10);
    mount(bar1); await login(bar1);
    const sheet = await openBooking('Ver reserva con Músico 1');
    const btn = await within(sheet).findByRole('button', { name: 'Pagar con Mercado Pago ($105.000)' }, T);   // $100.000 + 5% de comisión
    assert.ok(!within(sheet).queryByRole('button', { name: /Pagar y confirmar/ }));
    fireEvent.click(btn);
    await waitFor(() => assert.equal(redirects.length, 1), T);
    assert.match(redirects[0], /^https:\/\/www\.mercadopago\.com\.ar\/checkout\/v1\/redirect\?pref_id=pref-1$/);
    const i = await intent(b.id); assert.deepEqual([i.status, Number(i.amount_ars), i.init_point], ['pendiente', 105000, redirects[0]]);
    assert.equal(JSON.parse(mpServer.hits[0].body).items[0].unit_price, 105000);
    assert.equal((await A.q('select status from bookings where id = $1', [b.id]))[0].status, 'aceptada');      // todavía no está paga
  });
  it('si Mercado Pago no responde muestra un error claro y permite reintentar', async () => {
    await accepted(10); mp.prefFail = 1;
    mount(bar1); await login(bar1);
    const sheet = await openBooking('Ver reserva con Músico 1');
    fireEvent.click(await within(sheet).findByRole('button', { name: /Pagar con Mercado Pago/ }, T));
    assert.match((await within(sheet).findByRole('alert', {}, T)).textContent!, /Mercado Pago no está disponible/);
    assert.equal(redirects.length, 0);
    fireEvent.click(within(sheet).getByRole('button', { name: /Pagar con Mercado Pago/ }));
    await waitFor(() => assert.equal(redirects.length, 1), T);
    assert.equal((await A.q('select count(*)::int n from payment_intents'))[0].n, 1);
  });
  it('una reserva gratuita se confirma sin salir de la app', async () => {
    await A.q(`update app_settings set venue_fee_bps = 0`);
    const b = await accepted(10, { cachet: 0 });
    mount(bar1); await login(bar1);
    const sheet = await openBooking('Ver reserva con Músico 1');
    fireEvent.click(await within(sheet).findByRole('button', { name: /Pagar con Mercado Pago/ }, T));
    await within(sheet).findByText('Confirmada', {}, T);
    assert.equal(redirects.length, 0); assert.equal(mp.prefs, 0);
    assert.equal((await A.q('select provider from payments where booking_id = $1', [b.id]))[0].provider, 'gratis');
  });
  it('en modo simulado sigue el botón de siempre', async () => {
    await A.q(`update app_settings set payment_mode = 'simulado'`);
    await accepted(10);
    mount(bar1); await login(bar1);
    const sheet = await openBooking('Ver reserva con Músico 1');
    await within(sheet).findByRole('button', { name: /Pagar y confirmar \(\$105\.000\)/ }, T);
    assert.ok(!within(sheet).queryByRole('button', { name: /Mercado Pago/ }));
  });
});

describe('Regreso del checkout', () => {
  it('?pago=ok: abre la reserva, espera el aviso de Mercado Pago y muestra la confirmación', async () => {
    const b = await accepted(10);
    await fetch0(b.id);                                                                                         // el bar ya generó el link de pago
    const i = await intent(b.id);
    mount(bar1, `?pago=ok&reserva=${b.id}`); await login(bar1);
    const sheet = await screen.findByRole('dialog', { name: 'Reserva con Músico 1' }, T);
    await within(sheet).findByText(/Estamos confirmando tu pago/, {}, T);                                       // el bar volvió y todavía no llegó el aviso
    assert.equal((await pay('445566', i.id, 105000)).status, 200);                                              // recién ahora llega el webhook
    await within(sheet).findByText('¡Pago confirmado! La fecha quedó reservada.', {}, T);
    within(sheet).getByText('Confirmada');
    assert.equal(window.location.search, '', 'la URL se limpia');
    assert.equal((await A.q('select provider, provider_ref from payments where booking_id = $1', [b.id]))[0].provider_ref, '445566');
  });
  it('?pago=error: avisa que no se completó y deja volver a pagar', async () => {
    const b = await accepted(10); await fetch0(b.id);
    mount(bar1, `?pago=error&reserva=${b.id}`); await login(bar1);
    const sheet = await screen.findByRole('dialog', { name: 'Reserva con Músico 1' }, T);
    await within(sheet).findByText('El pago no se completó. Podés intentarlo de nuevo.', {}, T);
    within(sheet).getByRole('button', { name: /Pagar con Mercado Pago/ });
  });
  it('?pago=pendiente y parámetros inválidos', async () => {
    const b = await accepted(10);
    mount(bar1, `?pago=pendiente&reserva=${b.id}`); await login(bar1);
    await within(await screen.findByRole('dialog', { name: 'Reserva con Músico 1' }, T)).findByText(/pendiente de acreditación/, {}, T);
    cleanup();
    mount(bar1, `?pago=ok&reserva=no-es-un-id`); await login(bar1);
    assert.ok(!screen.queryByRole('dialog', { name: /Reserva con/ }), 'no abre nada con un id inválido');
  });
  async function fetch0(bookingId: string) { await handleCreatePayment(new Request('https://f.test/create-payment', { method: 'POST', headers: { authorization: `Bearer ${bar1.userId}`, 'content-type': 'application/json' }, body: JSON.stringify({ booking_id: bookingId }) }), payDeps()); }
});

describe('Cobros del músico', () => {
  it('guarda el alias (con validación), lo usa en los cobros pendientes y muestra el estado de cada pago', async () => {
    const b = await accepted(10);
    const i = (await (async () => { await handleCreatePayment(new Request('https://f.test/c', { method: 'POST', headers: { authorization: `Bearer ${bar1.userId}`, 'content-type': 'application/json' }, body: JSON.stringify({ booking_id: b.id }) }), payDeps()); return intent(b.id); })());
    await pay('990011', i.id, 105000);
    await A.complete(m1, b.id, { now: plus(b.starts, 4 * H) });
    mount(m1); await login(m1);
    fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
    const card = await screen.findByLabelText('Cobros', {}, T);
    await within(card).findByText(/Tenés cobros pendientes: cargá tu alias/, {}, T);
    await within(card).findByText(/pendiente de transferencia/, {}, T);
    fireEvent.change(within(card).getByLabelText(/Alias o CBU\/CVU/), { target: { value: '123456' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Guardar alias' }));
    assert.match((await within(card).findByRole('alert', {}, T)).textContent!, /al menos una letra/);                  // solo dígitos y no son 22
    fireEvent.change(within(card).getByLabelText(/Alias o CBU\/CVU/), { target: { value: 'ariel.musica' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Guardar alias' }));
    await within(card).findByText('Alias guardado.', {}, T);
    assert.equal((await A.q('select payout_alias from profiles where user_id = $1', [m1.userId]))[0].payout_alias, 'ariel.musica');
    assert.equal((await A.q('select alias_snapshot from payouts'))[0].alias_snapshot, 'ariel.musica');
    await waitFor(() => assert.ok(!within(card).queryByText(/Tenés cobros pendientes/)), T);
    await asSystem(pool, (c) => c.query(`select public.admin_mark_payout_paid((select id from payouts), 'transf-777')`));
    cleanup(); mount(m1); await login(m1); fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
    await within(await screen.findByLabelText('Cobros', {}, T)).findByText(/transferido \(ref\. transf-777\)/, {}, T);
  });
});
