import test from 'node:test';
import assert from 'node:assert/strict';
import { NOVEDADES, TABS_BY_AUDIENCE, latestNovedadId, novedadesFor, tabFor, unreadNovedades, type Audience } from './novedades.ts';
import { AUDIENCE_INFO, TOUR, TOUR_VERSION } from './tour.ts';

const AUDS: Audience[] = ['anfitrion', 'musico', 'publico'];
const TABS = ['explorar', 'fechas', 'reservas', 'favoritos', 'avisos', 'cuenta', 'cartelera'];

test('novedades: ids únicos y crecientes, fechas válidas y ordenadas, textos completos', () => {
  const ids = NOVEDADES.map((n) => n.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(latestNovedadId(), Math.max(...ids));
  let prev = '';
  for (const n of NOVEDADES) {
    assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(!Number.isNaN(Date.parse(n.date)), n.date);
    assert.ok(n.date >= prev, `fecha desordenada en ${n.id}`); prev = n.date;
    assert.ok(n.title.trim().length >= 5 && n.body.trim().length >= 20, `texto corto en ${n.id}`);
    assert.ok(n.audiences.length > 0 && n.audiences.every((a) => AUDS.includes(a)));
    if (n.tab) assert.ok(TABS.includes(n.tab), `pestaña inválida ${n.tab}`);
    assert.ok(['nuevo', 'mejora'].includes(n.tag));
  }
});

test('novedades: cada tipo de uso tiene contenido en orden descendente y "Probar ahora" solo apunta a pestañas que existen', () => {
  for (const a of AUDS) {
    const list = novedadesFor(a);
    assert.ok(list.length > 0, `sin novedades para ${a}`);
    assert.deepEqual(list.map((n) => n.id), list.map((n) => n.id).sort((x, y) => y - x));
    for (const n of list) { const t = tabFor(n, a); assert.ok(t === undefined || TABS_BY_AUDIENCE[a].includes(t)); }
    assert.ok(list.some((n) => tabFor(n, a)), `ninguna novedad de ${a} se puede probar`);
  }
  // el caso que motivó la regla: la cartelera pública no existe como pestaña para anfitriones/músicos
  const cartelera = NOVEDADES.find((n) => n.tab === 'cartelera')!;
  assert.equal(tabFor(cartelera, 'anfitrion'), undefined); assert.equal(tabFor(cartelera, 'musico'), undefined); assert.equal(tabFor(cartelera, 'publico'), 'cartelera');
  assert.ok(novedadesFor(null).length === NOVEDADES.length);
});

test('contador de novedades sin ver', () => {
  const all = novedadesFor('musico').length;
  assert.equal(unreadNovedades('musico', 0), all);
  assert.equal(unreadNovedades('musico', latestNovedadId()), 0);
  assert.equal(unreadNovedades('musico', latestNovedadId() - 1), 1);
  assert.equal(unreadNovedades('musico', 9999), 0);
});

test('tour: pasos completos para cada tipo de uso y opciones de bienvenida coherentes', () => {
  assert.ok(Number.isInteger(TOUR_VERSION) && TOUR_VERSION >= 1);
  assert.deepEqual(AUDIENCE_INFO.map((a) => a.id).sort(), [...AUDS].sort());
  for (const a of AUDS) {
    assert.ok(TOUR[a].length >= 4, `tour de ${a} muy corto`);
    for (const s of TOUR[a]) { assert.ok(s.title.length > 3 && s.body.length > 20 && s.emoji); if (s.tab) assert.ok(TABS.includes(s.tab)); }
    assert.equal(new Set(TOUR[a].map((s) => s.title)).size, TOUR[a].length, `títulos repetidos en ${a}`);
  }
});
