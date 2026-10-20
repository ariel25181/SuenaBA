import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSession } from './SessionContext.tsx';
import type { Audience } from '../content/novedades.ts';

export interface Prefs { audience: Audience | null; tourVersion: number; whatsNewSeen: number }
const KEY = 'suenaba:prefs:v1';
const EMPTY: Prefs = { audience: null, tourVersion: 0, whatsNewSeen: 0 };

function readLocal(): Prefs {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { audience: ['anfitrion', 'musico', 'publico'].includes(v.audience) ? v.audience : null, tourVersion: Number(v.tourVersion) || 0, whatsNewSeen: Number(v.whatsNewSeen) || 0 };
  } catch { /* storage no disponible o corrupto */ }
  return EMPTY;
}
function writeLocal(p: Prefs) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* ignorar */ } }

/** Une preferencias: los contadores solo avanzan; el tipo de uso lo define `a` si existe. */
export const mergePrefs = (a: Prefs, b: Prefs): Prefs => ({ audience: a.audience ?? b.audience, tourVersion: Math.max(a.tourVersion, b.tourVersion), whatsNewSeen: Math.max(a.whatsNewSeen, b.whatsNewSeen) });

interface Ctx { prefs: Prefs; loaded: boolean; update: (patch: Partial<Prefs>, opts?: { replaceAudience?: boolean }) => void }
const PrefsCtx = createContext<Ctx | null>(null);

/** Guarda en el dispositivo (siempre) y en la cuenta (si hay sesión) para no repetir el tour en otro dispositivo. */
export const PrefsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, api } = useSession();
  const [prefs, setPrefs] = useState<Prefs>(readLocal);
  const [loaded, setLoaded] = useState(false);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const userId = state.status === 'ready' || state.status === 'no_profile' ? state.userId : null;

  const persist = useCallback((p: Prefs) => {
    writeLocal(p);
    if (userId) api.savePrefs({ audience: p.audience, tourVersion: p.tourVersion, whatsNewSeen: p.whatsNewSeen }).catch(() => {});
  }, [api, userId]);

  useEffect(() => {
    if (state.status === 'loading') return;
    if (!userId) { setLoaded(true); return; }
    let alive = true;
    api.getPrefs().then((server) => {
      if (!alive) return;
      const local = prefsRef.current;
      const merged = server ? mergePrefs({ audience: server.audience, tourVersion: server.tourVersion, whatsNewSeen: server.whatsNewSeen }, local) : local;
      setPrefs(merged); writeLocal(merged);
      const changed = !server || server.audience !== merged.audience || server.tourVersion !== merged.tourVersion || server.whatsNewSeen !== merged.whatsNewSeen;
      if (changed && (merged.audience || merged.tourVersion || merged.whatsNewSeen)) api.savePrefs({ audience: merged.audience, tourVersion: merged.tourVersion, whatsNewSeen: merged.whatsNewSeen }).catch(() => {});
    }).catch(() => {}).finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [state.status, userId, api]);

  const update = useCallback((patch: Partial<Prefs>, opts?: { replaceAudience?: boolean }) => {
    const cur = prefsRef.current;
    const next: Prefs = {
      audience: 'audience' in patch ? (patch.audience ?? null) : cur.audience,
      tourVersion: Math.max(cur.tourVersion, patch.tourVersion ?? 0),
      whatsNewSeen: Math.max(cur.whatsNewSeen, patch.whatsNewSeen ?? 0),
    };
    if (opts?.replaceAudience === false && cur.audience) next.audience = cur.audience;
    setPrefs(next); prefsRef.current = next; persist(next);
  }, [persist]);

  return <PrefsCtx.Provider value={{ prefs, loaded, update }}>{children}</PrefsCtx.Provider>;
};

export function usePrefs(): Ctx {
  const v = useContext(PrefsCtx);
  if (!v) throw new Error('usePrefs debe usarse dentro de <PrefsProvider>');
  return v;
}

export interface HelpCtx { openTour: () => void; openNovedades: () => void; unread: number; changeUse: (() => void) | null }
export const HelpContext = createContext<HelpCtx>({ openTour: () => {}, openNovedades: () => {}, unread: 0, changeUse: null });
export const useHelp = () => useContext(HelpContext);
