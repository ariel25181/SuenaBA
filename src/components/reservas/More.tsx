import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext.tsx';
import type { Profile } from '../../lib/bookingsApi.ts';
import { POLICY_LABEL } from '../../domain/bookingRules.ts';
import { Banner, Btn, Card, Empty, Field, Pill, ars, fmtDateTime, fmtShort, inputCls, useAction, useLoad } from './ui.tsx';

export const NotificationsView: React.FC<{ onOpenBooking: (id: string) => void; onChanged: () => void; refreshKey: number }> = ({ onOpenBooking, onChanged, refreshKey }) => {
  const { api } = useSession();
  const { data, loading, reload } = useLoad(() => api.notifications(), [refreshKey]);
  const act = useAction();
  if (loading && !data) return <Empty>Cargando avisos…</Empty>;
  const items = data ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  const open = async (id: string, bookingId: string | null) => { await act.run(() => api.markRead([id])); reload(); onChanged(); if (bookingId) onOpenBooking(bookingId); };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between"><p className="text-xs text-slate-500">{unread} sin leer</p>{unread > 0 && <Btn kind="ghost" onClick={async () => { await act.run(() => api.markRead()); reload(); onChanged(); }}>Marcar todas como leídas</Btn>}</div>
      {items.length === 0 && <Empty>No tenés avisos todavía.</Empty>}
      {items.map((n) => (
        <button key={n.id} onClick={() => open(n.id, n.bookingId)} className={`w-full text-left rounded-2xl border p-3 ${n.readAt ? 'border-slate-800 bg-slate-900/40' : 'border-amber-500/40 bg-amber-500/5'}`}>
          <p className="text-sm font-bold text-slate-100">{!n.readAt && <span aria-label="sin leer" className="mr-1 text-amber-400">●</span>}{n.title}</p>
          <p className="text-xs text-slate-400">{n.body}</p><p className="text-[10px] text-slate-600">{fmtDateTime(n.createdAt)}</p>
        </button>
      ))}
    </div>
  );
};

export const FavoritesView: React.FC<{ profile: Profile }> = ({ profile }) => {
  const { api } = useSession();
  const act = useAction();
  const { data, loading, reload } = useLoad(async () => {
    const favs = await api.favorites();
    const ls = await api.listingsByIds(favs.filter((f) => f.kind === 'listing').map((f) => f.targetId));
    const venueIds = [...new Set([...favs.filter((f) => f.kind === 'venue').map((f) => f.targetId), ...ls.map((l) => l.venueId)])];
    const [venues, musicians] = await Promise.all([api.venues(venueIds), api.musicians(favs.filter((f) => f.kind === 'musician').map((f) => f.targetId))]);
    return favs.map((f) => {
      const l = ls.find((x) => x.id === f.targetId);
      const title = f.kind === 'venue' ? venues.find((v) => v.id === f.targetId)?.name : f.kind === 'musician' ? musicians.find((m) => m.id === f.targetId)?.name : `${venues.find((v) => v.id === l?.venueId)?.name ?? 'Fecha'} · ${l ? fmtDateTime(l.startsAt) : 'ya no disponible'}`;
      return { ...f, title: title ?? 'Ya no disponible', sub: f.kind === 'listing' ? (l ? `${ars(l.cachetArs)} · ${l.status}` : '') : f.kind === 'venue' ? 'Bar' : 'Músico' };
    });
  }, [profile.userId]);
  if (loading && !data) return <Empty>Cargando favoritos…</Empty>;
  const items = data ?? [];
  if (!items.length) return <Empty>Todavía no guardaste favoritos. Tocá el corazón de una fecha para encontrarla acá.</Empty>;
  return (
    <div className="space-y-2">
      {act.error && <Banner kind="error">{act.error}</Banner>}
      {items.map((f) => (
        <Card key={f.kind + f.targetId} className="flex items-center justify-between gap-2">
          <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-100">{f.title}</p><p className="text-xs text-slate-400">{f.sub}</p></div>
          <Btn kind="ghost" aria-label={`Quitar ${f.title} de favoritos`} onClick={async () => { await act.run(() => api.toggleFavorite(f.kind, f.targetId)); reload(); }}>Quitar</Btn>
        </Card>
      ))}
    </div>
  );
};

const toLocalIso = (v: string) => new Date(v).toISOString();

export const HostPanel: React.FC<{ profile: Profile }> = ({ profile }) => {
  const { api } = useSession();
  const act = useAction();
  const { data, loading, reload } = useLoad(() => api.myListings(profile.venueId!), [profile.venueId]);
  const [start, setStart] = useState(''), [end, setEnd] = useState(''), [cachet, setCachet] = useState(''), [genres, setGenres] = useState('');
  const [mode, setMode] = useState<'approval' | 'instant'>('approval'), [policy, setPolicy] = useState<'flexible' | 'moderada' | 'estricta'>('moderada'), [notes, setNotes] = useState('');
  const publish = async () => {
    const l = await act.run(() => api.createListing({ startsAt: new Date(start), endsAt: new Date(end), cachetArs: Number(cachet), genres: genres.split(',').map((g) => g.trim()).filter(Boolean), notes, bookingMode: mode, policy }), 'Fecha publicada.');
    if (l) { setStart(''); setEnd(''); setCachet(''); setGenres(''); setNotes(''); reload(); }
  };
  return (
    <div className="space-y-3">
      <Card className="space-y-2">
        <h3 className="text-sm font-bold text-slate-100">Publicar una fecha</h3>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Inicio"><input className={inputCls} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Fin"><input className={inputCls} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Cachet (ARS)"><input className={inputCls} inputMode="numeric" value={cachet} onChange={(e) => setCachet(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Géneros (separados por coma)"><input className={inputCls} value={genres} onChange={(e) => setGenres(e.target.value)} /></Field>
          <Field label="Modo de reserva"><select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="approval">Con aprobación</option><option value="instant">Reserva instantánea</option></select></Field>
          <Field label="Política de cancelación"><select className={inputCls} value={policy} onChange={(e) => setPolicy(e.target.value as any)}><option value="flexible">Flexible</option><option value="moderada">Moderada</option><option value="estricta">Estricta</option></select></Field>
        </div>
        <Field label="Notas (backline, condiciones)"><textarea className={inputCls} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {act.error && <Banner kind="error">{act.error}</Banner>}{act.ok && <Banner kind="ok">{act.ok}</Banner>}
        <Btn className="w-full" disabled={act.busy || !start || !end || !cachet} onClick={publish}>Publicar fecha</Btn>
      </Card>
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Mis fechas</h3>
      {loading && !data ? <Empty>Cargando…</Empty> : (data ?? []).length === 0 ? <Empty>No tenés fechas publicadas.</Empty> : (data ?? []).map((l) => (
        <Card key={l.id} className="flex items-center justify-between gap-2">
          <div><p className="text-sm font-bold text-slate-100">{fmtDateTime(l.startsAt)}</p><p className="text-xs text-slate-400">{ars(l.cachetArs)} · {POLICY_LABEL[l.cancellationPolicy]}</p><Pill tone={l.status === 'abierta' ? 'green' : l.status === 'reservada' ? 'amber' : 'slate'}>{l.status}</Pill></div>
          {l.status === 'abierta' && <Btn kind="ghost" aria-label={`Cancelar fecha del ${fmtShort(l.startsAt)}`} onClick={async () => { await act.run(() => api.cancelListing(l.id), 'Fecha cancelada.'); reload(); }}>Cancelar fecha</Btn>}
        </Card>
      ))}
    </div>
  );
};

export const AccountView: React.FC<{ profile: Profile }> = ({ profile }) => {
  const { api, signOut, state } = useSession();
  const act = useAction();
  const { data, loading, reload } = useLoad(async () => ({
    earnings: await api.earnings(),
    stats: await api.stats(profile.role === 'bar' ? 'venue' : 'musician', (profile.venueId ?? profile.musicianId)!),
    searches: profile.role === 'musico' ? await api.savedSearches() : [],
  }), [profile.userId]);
  if (loading && !data) return <Empty>Cargando…</Empty>;
  const { earnings, stats, searches } = data!;
  const isBar = profile.role === 'bar';
  return (
    <div className="space-y-3">
      <Card className="space-y-1"><p className="text-sm text-slate-300">{state.status === 'ready' ? state.email : ''}</p>
        <div className="flex flex-wrap gap-1">{profile.verified ? <Pill tone="green">Perfil verificado</Pill> : <Pill tone="slate">Sin verificar</Pill>}{stats?.isSuperhost && <Pill tone="amber">{isBar ? 'Superanfitrión' : 'Superartista'}</Pill>}</div>
        {!isBar && profile.lateCancellations > 0 && <p className="text-xs text-red-300">Cancelaciones tardías: {profile.lateCancellations}</p>}</Card>
      <Card className="space-y-1" aria-label="Ganancias">
        <h3 className="text-sm font-bold text-slate-100">{isBar ? 'Tus pagos' : 'Tus ganancias'}</h3>
        <div className="flex justify-between text-sm"><span className="text-slate-400">{isBar ? 'Retenido (shows por realizarse)' : 'Por cobrar (retenido)'}</span><strong>{ars(earnings.pendingArs)}</strong></div>
        <div className="flex justify-between text-sm"><span className="text-slate-400">{isBar ? 'Pagado en shows' : 'Cobrado'}</span><strong>{ars(earnings.settledArs)}</strong></div>
        {isBar && <div className="flex justify-between text-sm"><span className="text-slate-400">Reembolsado</span><strong>{ars(earnings.refundedArs)}</strong></div>}
        <p className="text-xs text-slate-500">Shows realizados: {earnings.showsCompleted}</p>
      </Card>
      {stats && <Card className="space-y-1 text-xs text-slate-300"><h3 className="text-sm font-bold text-slate-100">Tu reputación</h3>
        <p>★ {stats.rating.toFixed(2)} · {stats.reviewCount} reseñas · {stats.completed} shows en el último año</p>
        <p>Cancelaciones tras confirmar: {stats.cancelledAfterConfirm} ({stats.cancelRate}%)</p>
        {stats.responseRate !== null && <p>Respuesta a solicitudes: {stats.responseRate}%{stats.avgResponseHours !== null ? ` · ${stats.avgResponseHours} h en promedio` : ''}</p>}</Card>}
      {!isBar && <Card className="space-y-2"><h3 className="text-sm font-bold text-slate-100">Alertas de búsqueda</h3>
        {searches.length === 0 && <p className="text-xs text-slate-500">Guardá una búsqueda en Explorar y te avisamos cuando se publique una fecha que coincida.</p>}
        {searches.map((s) => <div key={s.id} className="flex items-center justify-between text-sm text-slate-200"><span>{s.name}</span><Btn kind="ghost" aria-label={`Borrar alerta ${s.name}`} onClick={async () => { await act.run(() => api.deleteSearch(s.id)); reload(); }}>Borrar</Btn></div>)}</Card>}
      {act.error && <Banner kind="error">{act.error}</Banner>}
      <Btn kind="ghost" className="w-full" onClick={signOut}>Cerrar sesión</Btn>
    </div>
  );
};
