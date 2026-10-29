import React, { useCallback, useState } from 'react';
import { BookingError } from '../../lib/bookingsApi.ts';

export const ars = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const TZ = 'America/Argentina/Buenos_Aires';
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtShort = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' });

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = '', ...p }) => (
  <div className={`rounded-2xl border border-slate-800 bg-slate-900/70 p-3 ${className}`} {...p} />
);
export const Pill: React.FC<{ tone?: 'amber' | 'green' | 'red' | 'slate' | 'cyan'; children: React.ReactNode }> = ({ tone = 'slate', children }) => {
  const t = { amber: 'bg-amber-500/15 text-amber-300', green: 'bg-emerald-500/15 text-emerald-300', red: 'bg-red-500/15 text-red-300', slate: 'bg-slate-700/50 text-slate-300', cyan: 'bg-cyan-500/15 text-cyan-300' }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
};
export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' }> = ({ kind = 'primary', className = '', ...p }) => {
  const k = { primary: 'bg-amber-500 text-slate-950 hover:bg-amber-400', ghost: 'border border-slate-700 text-slate-200 hover:bg-slate-800', danger: 'bg-red-600 text-white hover:bg-red-500' }[kind];
  return <button type="button" className={`rounded-xl px-3 py-2 text-sm font-bold transition disabled:opacity-50 ${k} ${className}`} {...p} />;
};
export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block text-xs text-slate-400 space-y-1"><span className="font-semibold text-slate-300">{label}</span>{children}{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</label>
);
export const inputCls = 'w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-amber-500 outline-none';

export const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" role="dialog" aria-modal="true" aria-label={title}>
    <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl border border-slate-800 bg-slate-950 p-4 space-y-3">
      <div className="flex items-center justify-between"><h2 className="text-base font-bold text-slate-100">{title}</h2><button aria-label="Cerrar" onClick={onClose} className="text-slate-400 text-xl px-2">×</button></div>
      {children}
    </div>
  </div>
);
export const Banner: React.FC<{ kind: 'error' | 'ok' | 'info'; children: React.ReactNode }> = ({ kind, children }) => (
  <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-xl px-3 py-2 text-sm ${kind === 'error' ? 'bg-red-500/15 text-red-200 border border-red-500/30' : kind === 'ok' ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30' : 'bg-slate-800 text-slate-300'}`}>{children}</div>
);
export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="text-center text-sm text-slate-500 py-8">{children}</p>;

/** Ejecuta una acción async mostrando errores de negocio en español. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true); setError(null); setOk(null);
    try { const r = await fn(); if (success) setOk(success); return r; }
    catch (e) { setError(e instanceof BookingError ? e.message : 'Ocurrió un error inesperado. Probá de nuevo.'); return undefined; }
    finally { setBusy(false); }
  }, []);
  return { run, busy, error, ok, clear: () => { setError(null); setOk(null); } };
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  React.useEffect(() => {
    let alive = true; setLoading(true);
    fn().then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => { if (alive) setError(e instanceof BookingError ? e.message : 'No pudimos cargar los datos.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1), setData };
}

export const Stars: React.FC<{ value: number; onChange?: (n: number) => void; label?: string }> = ({ value, onChange, label = 'Calificación' }) => (
  <div role="radiogroup" aria-label={label} className="flex gap-1">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} estrellas`} disabled={!onChange}
        onClick={() => onChange?.(n)} className={`text-2xl ${n <= value ? 'text-amber-400' : 'text-slate-700'}`}>★</button>
    ))}
  </div>
);
