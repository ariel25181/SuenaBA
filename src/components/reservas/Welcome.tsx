import React, { useState } from 'react';
import { AUDIENCE_INFO, TOUR } from '../../content/tour.ts';
import { NOVEDADES, novedadesFor, tabFor, type Audience, type ReservasTab } from '../../content/novedades.ts';
import { Btn, Card, Pill, Sheet } from './ui.tsx';

export const AudiencePicker: React.FC<{ onPick: (a: Audience) => void }> = ({ onPick }) => (
  <div className="space-y-3 mt-2">
    <div className="text-center space-y-1">
      <p className="text-3xl" aria-hidden>🎶</p>
      <h2 className="text-lg font-bold text-slate-100">¿Cómo vas a usar SuenaBA?</h2>
      <p className="text-xs text-slate-400">Elegí una opción y te mostramos un recorrido corto hecho a tu medida. Podés cambiarlo después.</p>
    </div>
    <div className="space-y-2" role="group" aria-label="Tipo de uso">
      {AUDIENCE_INFO.map((a) => (
        <button key={a.id} onClick={() => onPick(a.id)} aria-label={`${a.label}: ${a.desc}`} className="w-full text-left rounded-2xl border border-slate-800 bg-slate-900/70 p-4 hover:border-amber-500/60">
          <span className="text-2xl mr-3" aria-hidden>{a.emoji}</span>
          <span className="text-sm font-bold text-slate-100">{a.label}</span>
          <span className="block text-xs text-slate-400 mt-1 ml-9">{a.desc}</span>
        </button>
      ))}
    </div>
  </div>
);

export const TourSheet: React.FC<{ audience: Audience; onDone: () => void; onSkip: () => void; onGo?: (tab: ReservasTab) => void }> = ({ audience, onDone, onSkip }) => {
  const steps = TOUR[audience];
  const [i, setI] = useState(0);
  const step = steps[i], last = i === steps.length - 1;
  return (
    <Sheet title="Tour de bienvenida" onClose={onSkip}>
      <p className="text-xs text-slate-500" aria-live="polite">Paso {i + 1} de {steps.length}</p>
      <div className="flex gap-1" aria-hidden>{steps.map((_, k) => <span key={k} className={`h-1 flex-1 rounded-full ${k <= i ? 'bg-amber-500' : 'bg-slate-800'}`} />)}</div>
      <Card className="space-y-2 text-center py-5">
        <p className="text-4xl" aria-hidden>{step.emoji}</p>
        <h3 className="text-base font-bold text-slate-100">{step.title}</h3>
        <p className="text-sm text-slate-300">{step.body}</p>
      </Card>
      <div className="flex gap-2">
        <Btn kind="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Atrás</Btn>
        {last ? <Btn className="flex-1" onClick={onDone}>{audience === 'publico' ? 'Ver la cartelera' : 'Empezar'}</Btn> : <Btn className="flex-1" onClick={() => setI(i + 1)}>Siguiente</Btn>}
      </div>
      {!last && <button className="w-full text-xs text-slate-500" onClick={onSkip}>Saltar tour</button>}
    </Sheet>
  );
};

export const NovedadesSheet: React.FC<{ audience: Audience | null; seen: number; onClose: () => void; onGo: (tab: ReservasTab) => void }> = ({ audience, seen, onClose, onGo }) => {
  const list = novedadesFor(audience);
  return (
    <Sheet title="Novedades" onClose={onClose}>
      <p className="text-xs text-slate-400">Cada función nueva de SuenaBA, de la más reciente a la más antigua.</p>
      {list.length === 0 && <p className="text-sm text-slate-500">Todavía no hay novedades.</p>}
      <ol className="space-y-2">
        {list.map((n) => (
          <li key={n.id}>
            <Card className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100">{n.title}</h3>
                {n.id > seen && <Pill tone="amber">Nuevo</Pill>}
              </div>
              <p className="text-[11px] text-slate-500">{new Date(n.date + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <p className="text-xs text-slate-300">{n.body}</p>
              {tabFor(n, audience) && <Btn kind="ghost" aria-label={`Probar ahora: ${n.title}`} onClick={() => { onGo(tabFor(n, audience)!); onClose(); }}>Probar ahora</Btn>}
            </Card>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-slate-600">{NOVEDADES.length} novedades en total</p>
    </Sheet>
  );
};
