import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../../context/SessionContext.tsx';
import { HelpContext, PrefsProvider, usePrefs } from '../../context/PrefsContext.tsx';
import type { Profile } from '../../lib/bookingsApi.ts';
import { TOUR_VERSION } from '../../content/tour.ts';
import { latestNovedadId, unreadNovedades, type Audience, type ReservasTab } from '../../content/novedades.ts';
import { AuthGate } from './AuthGate.tsx';
import { ExploreView } from './Explore.tsx';
import { BookingSheet, BookingsView } from './Bookings.tsx';
import { AccountView, FavoritesView, HostPanel, NotificationsView } from './More.tsx';
import { AudiencePicker, NovedadesSheet, TourSheet } from './Welcome.tsx';
import { PublicHome } from './PublicHome.tsx';

type Tab = Exclude<ReservasTab, 'cartelera'>;

const Home: React.FC<{ profile: Profile; requestedTab: { tab: ReservasTab; n: number } | null }> = ({ profile, requestedTab }) => {
  const { api } = useSession();
  const isBar = profile.role === 'bar';
  const tabs: [Tab, string][] = isBar
    ? [['fechas', 'Mis fechas'], ['reservas', 'Reservas'], ['favoritos', 'Favoritos'], ['avisos', 'Avisos'], ['cuenta', 'Cuenta']]
    : [['explorar', 'Explorar'], ['reservas', 'Reservas'], ['favoritos', 'Favoritos'], ['avisos', 'Avisos'], ['cuenta', 'Cuenta']];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [unread, setUnread] = useState(0);
  const bump = useCallback(() => setKey((k) => k + 1), []);

  // Pedido de cambio de pestaña desde "Novedades" o el tour (solo si existe para este perfil)
  useEffect(() => { if (requestedTab && tabs.some(([id]) => id === requestedTab.tab)) setTab(requestedTab.tab as Tab); /* eslint-disable-next-line */ }, [requestedTab?.n]);

  const loadUnread = useCallback(() => { api.notifications(100).then((n) => setUnread(n.filter((x) => !x.readAt).length)).catch(() => {}); }, [api]);
  useEffect(() => { loadUnread(); }, [loadUnread, key]);
  useEffect(() => { const t = setInterval(loadUnread, 30_000); return () => clearInterval(t); }, [loadUnread]);

  return (
    <div className="space-y-3">
      <nav aria-label="Secciones de reservas" className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-900/70 p-1">
        {tabs.map(([id, label]) => (
          <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}
            className={`relative shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold ${tab === id ? 'bg-amber-500 text-slate-950' : 'text-slate-300'}`}>
            {label}{id === 'avisos' && unread > 0 && <span aria-label={`${unread} avisos sin leer`} className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{unread}</span>}
          </button>
        ))}
      </nav>
      {tab === 'explorar' && <ExploreView profile={profile} onBooked={(id) => { bump(); setTab('reservas'); setOpenId(id); }} />}
      {tab === 'fechas' && <HostPanel profile={profile} />}
      {tab === 'reservas' && <BookingsView profile={profile} refreshKey={key} onOpen={setOpenId} />}
      {tab === 'favoritos' && <FavoritesView profile={profile} />}
      {tab === 'avisos' && <NotificationsView refreshKey={key} onChanged={bump} onOpenBooking={(id) => { setTab('reservas'); setOpenId(id); }} />}
      {tab === 'cuenta' && <AccountView profile={profile} />}
      {openId && <BookingSheet bookingId={openId} profile={profile} onClose={() => setOpenId(null)} onChanged={bump} />}
    </div>
  );
};

const Ready: React.FC<{ requestedTab: { tab: ReservasTab; n: number } | null }> = ({ requestedTab }) => {
  const { state } = useSession();
  return state.status === 'ready' ? <Home profile={state.profile} requestedTab={requestedTab} /> : null;
};

const Flow: React.FC = () => {
  const { state } = useSession();
  const { prefs, loaded, update } = usePrefs();
  const [tourOpen, setTourOpen] = useState(false), [tourSkipped, setTourSkipped] = useState(false), [novOpen, setNovOpen] = useState(false);
  const [requestedTab, setRequestedTab] = useState<{ tab: ReservasTab; n: number } | null>(null);

  // Quien ya tiene perfil usa SIEMPRE ese tipo de uso
  const derived: Audience | null = state.status === 'ready' ? (state.profile.role === 'bar' ? 'anfitrion' : 'musico') : null;
  const audience: Audience | null = derived ?? prefs.audience;
  useEffect(() => { if (derived && prefs.audience !== derived) update({ audience: derived }); /* eslint-disable-next-line */ }, [derived, prefs.audience]);

  const unread = unreadNovedades(audience, prefs.whatsNewSeen);
  const help = useMemo(() => ({
    openTour: () => setTourOpen(true), openNovedades: () => setNovOpen(true), unread,
    changeUse: state.status === 'ready' ? null : () => update({ audience: null }),
  }), [unread, state.status, update]);

  if (state.status === 'loading' || !loaded) return <p className="text-center text-sm text-slate-400 py-10">Cargando…</p>;
  if (!audience) return <AudiencePicker onPick={(a) => update({ audience: a })} />;

  const autoTour = prefs.tourVersion < TOUR_VERSION && !tourSkipped;
  const finishTour = () => { update({ tourVersion: TOUR_VERSION, whatsNewSeen: latestNovedadId() }); setTourOpen(false); setTourSkipped(true); };
  const skipTour = () => { update({ tourVersion: TOUR_VERSION }); setTourOpen(false); setTourSkipped(true); };
  const openNov = () => { setNovOpen(true); };
  const closeNov = () => { update({ whatsNewSeen: latestNovedadId() }); setNovOpen(false); };

  const content = audience === 'publico' && state.status !== 'ready'
    ? <PublicHome onSwitchUse={() => update({ audience: null })} />
    : <AuthGate><Ready requestedTab={requestedTab} /></AuthGate>;

  return (
    <HelpContext.Provider value={help}>
      <div className="space-y-3">
        <div className="flex justify-end gap-2">
          <button onClick={openNov} className="relative rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200" aria-label={unread > 0 ? `Novedades, ${unread} sin ver` : 'Novedades'}>
            ✨ Novedades{unread > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-950">{unread}</span>}
          </button>
          <button onClick={() => setTourOpen(true)} className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200" aria-label="Ver el tour de bienvenida">❓ Tour</button>
        </div>
        {content}
      </div>
      {(autoTour || tourOpen) && <TourSheet audience={audience} onDone={finishTour} onSkip={skipTour} />}
      {novOpen && <NovedadesSheet audience={audience} seen={prefs.whatsNewSeen} onClose={closeNov} onGo={(tab) => setRequestedTab({ tab, n: Date.now() })} />}
    </HelpContext.Provider>
  );
};

export const ReservasApp: React.FC = () => (
  <PrefsProvider><Flow /></PrefsProvider>
);
