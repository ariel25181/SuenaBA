import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createBookingsApi, bookingsApi as defaultApi, type AppClient, type Profile, type ProfileRequest } from '../lib/bookingsApi.ts';
import { supabase } from '../lib/supabaseClient.ts';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'no_profile'; userId: string; email?: string; request: ProfileRequest | null }
  | { status: 'ready'; userId: string; email?: string; profile: Profile };

type Api = ReturnType<typeof createBookingsApi>;
interface Ctx {
  state: SessionState;
  api: Api;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}
const SessionCtx = createContext<Ctx | null>(null);

export const SessionProvider: React.FC<{ client?: AppClient; children: React.ReactNode }> = ({ client, children }) => {
  const c = (client ?? (supabase as unknown as AppClient));
  const api = useMemo(() => (client ? createBookingsApi(client) : defaultApi), [client]);
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const load = useCallback(async (user: { id: string; email?: string } | null) => {
    if (!user) { setState({ status: 'anon' }); return; }
    try {
      const profile = await api.myProfile();
      if (profile) { setState({ status: 'ready', userId: user.id, email: user.email, profile }); return; }
      const request = await api.myProfileRequest();
      setState({ status: 'no_profile', userId: user.id, email: user.email, request });
    } catch {
      setState({ status: 'no_profile', userId: user.id, email: user.email, request: null });
    }
  }, [api]);

  const refresh = useCallback(async () => {
    const { data } = await c.auth.getSession();
    await load(data.session?.user ?? null);
  }, [c, load]);

  useEffect(() => {
    let alive = true;
    c.auth.getSession().then(({ data }) => { if (alive) load(data.session?.user ?? null); });
    const { data } = c.auth.onAuthStateChange((_e, session) => { if (alive) load(session?.user ?? null); });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [c, load]);

  const value: Ctx = {
    state, api, refresh,
    signIn: async (email, password) => { const { error } = await c.auth.signInWithPassword({ email, password }); if (!error) await refresh(); return error ? 'Email o contraseña incorrectos.' : null; },
    signUp: async (email, password) => {
      const { error, data } = await c.auth.signUp({ email, password });
      if (error) return error.message.includes('registered') ? 'Ese email ya tiene una cuenta. Probá iniciar sesión.' : 'No pudimos crear la cuenta. Revisá el email y usá una contraseña de 6+ caracteres.';
      if (data && !data.session) return 'Te enviamos un email para confirmar la cuenta. Después iniciá sesión.';
      await refresh(); return null;
    },
    signOut: async () => { await c.auth.signOut(); setState({ status: 'anon' }); },
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
};

export function useSession(): Ctx {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession debe usarse dentro de <SessionProvider>');
  return v;
}
