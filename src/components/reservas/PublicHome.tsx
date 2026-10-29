import React, { useEffect, useState } from 'react';
import { useSession } from '../../context/SessionContext.tsx';
import type { PublicShow } from '../../lib/bookingsApi.ts';
import { Banner, Btn, Card, Empty, Pill, fmtDateTime, fmtTime, useAction } from './ui.tsx';

const BARRIOS = ['Palermo Soho', 'Palermo Hollywood', 'San Telmo', 'Villa Crespo', 'Recoleta', 'Almagro', 'Colegiales', 'Chacarita', 'Boedo', 'Belgrano'];
const GENEROS = ['Jazz', 'Rock', 'Blues', 'Folklore', 'Tango', 'Indie', 'Pop', 'Cumbia'];
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

/** Cartelera para el público: shows confirmados por venir. No requiere cuenta. */
export const PublicHome: React.FC<{ onSwitchUse: () => void }> = ({ onSwitchUse }) => {
  const { api } = useSession();
  const act = useAction();
  const [barrios, setBarrios] = useState<string[]>([]), [generos, setGeneros] = useState<string[]>([]);
  const [shows, setShows] = useState<PublicShow[]>([]), [total, setTotal] = useState(0), [loading, setLoading] = useState(true);

  const load = async (append = false) => {
    setLoading(true);
    const r = await act.run(() => api.upcomingShows({ neighborhoods: barrios, genres: generos, limit: 10, offset: append ? shows.length : 0 }));
    if (r) { setShows(append ? [...shows, ...r] : r); setTotal(r[0]?.totalCount ?? (append ? total : 0)); }
    setLoading(false);
  };
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, [barrios, generos]);

  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <h2 className="text-base font-bold text-slate-100">Cartelera de shows en vivo</h2>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Barrios">
          {BARRIOS.map((b) => <button key={b} aria-pressed={barrios.includes(b)} onClick={() => setBarrios(toggle(barrios, b))} className={`rounded-full px-2 py-1 text-[11px] ${barrios.includes(b) ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>{b}</button>)}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Géneros">
          {GENEROS.map((g) => <button key={g} aria-pressed={generos.includes(g)} onClick={() => setGeneros(toggle(generos, g))} className={`rounded-full px-2 py-1 text-[11px] ${generos.includes(g) ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-300'}`}>{g}</button>)}
        </div>
      </Card>
      {act.error && <Banner kind="error">{act.error}</Banner>}
      {loading && shows.length === 0 ? <Empty>Buscando shows…</Empty> : shows.length === 0 ? <Empty>Todavía no hay shows confirmados con esos filtros.</Empty> : (
        <>
          <p className="text-xs text-slate-500">{total} {total === 1 ? 'show confirmado' : 'shows confirmados'}</p>
          {shows.map((s) => (
            <Card key={s.bookingId} className="flex gap-3">
              {s.coverPhoto ? <img src={s.coverPhoto} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="h-20 w-20 rounded-xl bg-slate-800" />}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold text-slate-100">{s.musicianName}</h3>
                <p className="text-xs text-slate-300">en {s.venueName} · {s.neighborhood}</p>
                <p className="text-xs text-amber-300">{fmtDateTime(s.startsAt)} – {fmtTime(s.endsAt)}</p>
                <div className="mt-1 flex flex-wrap gap-1">{s.genres.slice(0, 4).map((g) => <Pill key={g} tone="cyan">{g}</Pill>)}</div>
              </div>
            </Card>
          ))}
          {shows.length < total && <Btn kind="ghost" className="w-full" onClick={() => load(true)}>Cargar más</Btn>}
        </>
      )}
      <Card className="space-y-2 text-center">
        <p className="text-sm text-slate-200">¿Tenés un bar o tocás en vivo?</p>
        <Btn onClick={onSwitchUse}>Cambiar mi tipo de uso</Btn>
      </Card>
    </div>
  );
};
