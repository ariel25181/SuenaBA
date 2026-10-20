import React, { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../context/SessionContext.tsx';
import type { Profile } from '../../lib/bookingsApi.ts';
import { AuthGate } from './AuthGate.tsx';
import { ExploreView } from './Explore.tsx';
import { BookingSheet, BookingsView } from './Bookings.tsx';
import { AccountView, FavoritesView, HostPanel, NotificationsView } from './More.tsx';

type Tab = 'explorar' | 'fechas' | 'reservas' | 'favoritos' | 'avisos' | 'cuenta';

const Home: React.FC<{ profile: Profile }> = ({ profile }) => {
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

export const ReservasApp: React.FC = () => (
  <AuthGate><Ready /></AuthGate>
);
const Ready: React.FC = () => {
  const { state } = useSession();
  return state.status === 'ready' ? <Home profile={state.profile} /> : null;
};
