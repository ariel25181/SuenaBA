import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../context/SessionContext.tsx';
import type { Fees, Profile, SearchFilters, SearchResult } from '../../lib/bookingsApi.ts';
import { POLICY_LABEL, POLICY_RULES, pricePreview } from '../../domain/bookingRules.ts';
import { Banner, Btn, Card, Empty, Field, Pill, Sheet, ars, fmtDateTime, fmtTime, inputCls, useAction } from './ui.tsx';

const BARRIOS = ['Palermo Soho', 'Palermo Hollywood', 'San Telmo', 'Villa Crespo', 'Recoleta', 'Almagro', 'Colegiales', 'Chacarita', 'Boedo', 'Belgrano'];
const GENEROS = ['Jazz', 'Rock', 'Blues', 'Folklore', 'Tango', 'Indie', 'Pop', 'Cumbia'];

const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

export const ListingCard: React.FC<{ r: SearchResult; fav: boolean; onFav: () => void; onOpen: () => void }> = ({ r, fav, onFav, onOpen }) => (
  <Card className="space-y-2">
    <div className="flex gap-3">
      {r.coverPhoto ? <img src={r.coverPhoto} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="h-20 w-20 rounded-xl bg-slate-800" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-bold text-slate-100">{r.venueName}</h3>
          <button aria-label={fav ? `Quitar ${r.venueName} de favoritos` : `Guardar ${r.venueName} en favoritos`} aria-pressed={fav} onClick={onFav} className={`text-xl leading-none ${fav ? 'text-red-400' : 'text-slate-500'}`}>{fav ? '♥' : '♡'}</button>
        </div>
        <p className="text-xs text-slate-400">{r.neighborhood} · ★ {r.venueRating.toFixed(2)} ({r.venueReviewCount})</p>
        <p className="text-xs text-amber-300">{fmtDateTime(r.startsAt)} – {fmtTime(r.endsAt)}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {r.venueSuperhost && <Pill tone="amber">Superanfitrión</Pill>}
          <Pill tone={r.bookingMode === 'instant' ? 'green' : 'slate'}>{r.bookingMode === 'instant' ? 'Reserva instantánea' : 'Con aprobación'}</Pill>
          {r.genres.slice(0, 3).map((g) => <Pill key={g} tone="cyan">{g}</Pill>)}
        </div>
      </div>
    </div>
    <div className="flex items-center justify-between">
      <p className="text-base font-black text-slate-100">{ars(r.cachetArs)} <span className="text-[11px] font-normal text-slate-500">cachet</span></p>
      <Btn kind="ghost" aria-label={`Ver detalle de ${r.venueName}`} onClick={onOpen}>Ver detalle</Btn>
    </div>
  </Card>
);

export const ExploreView: React.FC<{ profile: Profile; onBooked: (bookingId: string) => void }> = ({ profile, onBooked }) => {
  const { api } = useSession();
  const isMusician = profile.role === 'musico';
  const [text, setText] = useState(''), [barrios, setBarrios] = useState<string[]>([]), [generos, setGeneros] = useState<string[]>([]);
  const [minC, setMinC] = useState(''), [maxC, setMaxC] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [mode, setMode] = useState<'' | 'instant' | 'approval'>(''), [sort, setSort] = useState<'date' | 'cachet_desc' | 'rating_desc'>('date'), [hideBusy, setHideBusy] = useState(isMusician);
  const [results, setResults] = useState<SearchResult[]>([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true), [favs, setFavs] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<SearchResult | null>(null), [naming, setNaming] = useState(false), [alertName, setAlertName] = useState('');
  const act = useAction();

  const filters = useCallback((offset = 0): SearchFilters => ({
    text, neighborhoods: barrios, genres: generos, minCachet: minC ? Number(minC) : undefined, maxCachet: maxC ? Number(maxC) : undefined,
    from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to + 'T23:59:59').toISOString() : undefined, mode: mode || undefined, sort, hideBusy: isMusician && hideBusy, limit: 10, offset,
  }), [text, barrios, generos, minC, maxC, from, to, mode, sort, hideBusy, isMusician]);

  const search = async (append = false) => {
    setLoading(true);
    const r = await act.run(() => api.search(filters(append ? results.length : 0)));
    if (r) { setResults(append ? [...results, ...r] : r); setTotal(r[0]?.totalCount ?? (append ? total : 0)); }
    setLoading(false);
  };
  useEffect(() => { search(false); api.favorites().then((f) => setFavs(new Set(f.filter((x) => x.kind === 'listing').map((x) => x.targetId)))).catch(() => {}); /* eslint-disable-next-line */ }, []);

  const toggleFav = async (r: SearchResult) => {
    const now = await act.run(() => api.toggleFavorite('listing', r.id));
    if (now !== undefined) setFavs((s) => { const n = new Set(s); now ? n.add(r.id) : n.delete(r.id); return n; });
  };
  const saveAlert = async () => {
    const f: Record<string, unknown> = {};
    if (barrios.length) f.neighborhoods = barrios; if (generos.length) f.genres = generos;
    if (minC) f.minCachet = Number(minC); if (maxC) f.maxCachet = Number(maxC); if (mode) f.mode = mode;
    if (from) f.from = new Date(from).toISOString(); if (to) f.to = new Date(to + 'T23:59:59').toISOString();
    const r = await act.run(() => api.saveSearch(alertName || 'Mi búsqueda', f), 'Búsqueda guardada: te avisamos cuando haya fechas nuevas.');
    if (r) { setNaming(false); setAlertName(''); }
  };

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <Field label="Buscar"><input className={inputCls} placeholder="Bar, barrio o palabra" value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Barrios">
          {BARRIOS.map((b) => <button key={b} aria-pressed={barrios.includes(b)} onClick={() => setBarrios(toggle(barrios, b))} className={`rounded-full px-2 py-1 text-[11px] ${barrios.includes(b) ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>{b}</button>)}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Géneros">
          {GENEROS.map((g) => <button key={g} aria-pressed={generos.includes(g)} onClick={() => setGeneros(toggle(generos, g))} className={`rounded-full px-2 py-1 text-[11px] ${generos.includes(g) ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>{g}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Cachet mínimo"><input className={inputCls} inputMode="numeric" value={minC} onChange={(e) => setMinC(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Cachet máximo"><input className={inputCls} inputMode="numeric" value={maxC} onChange={(e) => setMaxC(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Desde"><input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input className={inputCls} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Modo de reserva"><select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="">Todos</option><option value="instant">Reserva instantánea</option><option value="approval">Con aprobación</option></select></Field>
          <Field label="Ordenar por"><select className={inputCls} value={sort} onChange={(e) => setSort(e.target.value as any)}><option value="date">Fecha</option><option value="cachet_desc">Mayor cachet</option><option value="rating_desc">Mejor calificados</option></select></Field>
        </div>
        {isMusician && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={hideBusy} onChange={(e) => setHideBusy(e.target.checked)} /> Ocultar fechas que se pisan con mis shows</label>}
        <div className="flex gap-2">
          <Btn className="flex-1" onClick={() => search(false)}>Buscar</Btn>
          {isMusician && <Btn kind="ghost" onClick={() => setNaming(!naming)}>Guardar búsqueda</Btn>}
        </div>
        {naming && <div className="flex gap-2"><input aria-label="Nombre de la búsqueda" className={inputCls} placeholder="Ej: Jazz en Palermo" value={alertName} onChange={(e) => setAlertName(e.target.value)} /><Btn onClick={saveAlert}>Guardar alerta</Btn></div>}
      </Card>
      {act.error && <Banner kind="error">{act.error}</Banner>}
      {act.ok && <Banner kind="ok">{act.ok}</Banner>}
      {loading ? <Empty>Buscando fechas…</Empty> : results.length === 0 ? <Empty>No hay fechas con esos filtros. Probá ampliar la búsqueda o guardala para recibir un aviso.</Empty> : (
        <>
          <p className="text-xs text-slate-500">{total} {total === 1 ? 'fecha disponible' : 'fechas disponibles'}</p>
          {results.map((r) => <ListingCard key={r.id} r={r} fav={favs.has(r.id)} onFav={() => toggleFav(r)} onOpen={() => setOpen(r)} />)}
          {results.length < total && <Btn kind="ghost" className="w-full" onClick={() => search(true)}>Cargar más</Btn>}
        </>
      )}
      {open && <ListingSheet r={open} profile={profile} onClose={() => setOpen(null)} onBooked={(id) => { setOpen(null); onBooked(id); }} />}
    </div>
  );
};

export const ListingSheet: React.FC<{ r: SearchResult; profile: Profile; onClose: () => void; onBooked: (id: string) => void }> = ({ r, profile, onClose, onBooked }) => {
  const { api } = useSession();
  const act = useAction();
  const [fees, setFees] = useState<Fees>({ venueFeeBps: 0, musicianFeeBps: 0, paymentMode: 'simulado' });
  const [cachet, setCachet] = useState(String(r.cachetArs)), [note, setNote] = useState('');
  useEffect(() => { api.fees().then(setFees).catch(() => {}); }, [api]);
  const isMusician = profile.role === 'musico', instant = r.bookingMode === 'instant';
  const price = pricePreview(Number(cachet) || 0, fees.venueFeeBps, fees.musicianFeeBps);
  const book = async () => {
    const b = await act.run(() => api.request(r.id, instant ? undefined : Number(cachet), note));
    if (b) onBooked(b.id);
  };
  return (
    <Sheet title={r.venueName} onClose={onClose}>
      <p className="text-sm text-amber-300">{fmtDateTime(r.startsAt)} – {fmtTime(r.endsAt)}</p>
      <p className="text-xs text-slate-400">{r.address} · {r.neighborhood} · capacidad {r.capacity}</p>
      <div className="flex flex-wrap gap-1">{r.venueSuperhost && <Pill tone="amber">Superanfitrión</Pill>}<Pill tone={instant ? 'green' : 'slate'}>{instant ? 'Reserva instantánea' : 'Con aprobación del bar'}</Pill>{r.genres.map((g) => <Pill key={g} tone="cyan">{g}</Pill>)}</div>
      {r.backline.length > 0 && <p className="text-xs text-slate-300"><strong>Backline:</strong> {r.backline.join(', ')}</p>}
      {r.notes && <p className="text-xs text-slate-300">{r.notes}</p>}
      <Card className="space-y-1 text-xs text-slate-300">
        <p className="font-bold text-slate-100">Política de cancelación: {POLICY_LABEL[r.cancellationPolicy]}</p>
        <p>{POLICY_RULES[r.cancellationPolicy]}</p>
        <p className="text-slate-500">Si cancela el músico, el bar recibe reembolso total.</p>
      </Card>
      {isMusician ? (
        <>
          {!instant && <Field label="Tu propuesta de cachet (ARS)" hint="Podés proponer otro monto; el bar decide si lo acepta."><input className={inputCls} inputMode="numeric" value={cachet} onChange={(e) => setCachet(e.target.value.replace(/\D/g, ''))} /></Field>}
          <Card className="space-y-0.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Cachet</span><span>{ars(price.cachet)}</span></div>
            {fees.musicianFeeBps > 0 ? <div className="flex justify-between"><span className="text-slate-400">Comisión SuenaBA ({fees.musicianFeeBps / 100}%)</span><span>−{ars(price.musicianFee)}</span></div> : <div className="text-[11px] text-emerald-300">Sin comisión para vos</div>}
            <div className="flex justify-between font-bold"><span>Vas a recibir</span><span>{ars(price.musicianReceives)}</span></div>
            <p className="pt-1 text-[11px] text-slate-500">El pago queda retenido por SuenaBA y se libera cuando el show se realiza.</p>
          </Card>
          <Field label="Mensaje para el bar (opcional)"><textarea className={inputCls} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {act.error && <Banner kind="error">{act.error}</Banner>}
          <Btn className="w-full" disabled={act.busy} onClick={book}>{instant ? 'Reservar ahora' : 'Enviar solicitud'}</Btn>
        </>
      ) : <Banner kind="info">Estás viendo esta fecha como bar: solo los músicos pueden reservar.</Banner>}
    </Sheet>
  );
};
