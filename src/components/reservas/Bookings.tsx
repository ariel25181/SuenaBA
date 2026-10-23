import React, { useEffect, useState } from 'react';
import { useSession } from '../../context/SessionContext.tsx';
import type { Booking, EntityLite, Profile } from '../../lib/bookingsApi.ts';
import { STATUS_LABEL, hoursUntil, pricePreview, refundPct, settleAmounts, POLICY_LABEL, POLICY_RULES } from '../../domain/bookingRules.ts';
import { Banner, Btn, Card, Empty, Field, Pill, Sheet, Stars, ars, fmtDateTime, fmtShort, inputCls, useAction, useLoad } from './ui.tsx';
import { goToCheckout, pollConfig, type PaymentReturn } from '../../lib/paymentRedirect.ts';

const tone = (s: string) => (s === 'confirmada' || s === 'realizada' ? 'green' : s === 'solicitada' || s === 'aceptada' ? 'amber' : 'red') as 'green' | 'amber' | 'red';

async function counterparts(api: ReturnType<typeof useSession>['api'], rows: Booking[]) {
  const [v, m] = await Promise.all([api.venues([...new Set(rows.map((b) => b.venueId))]), api.musicians([...new Set(rows.map((b) => b.musicianId))])]);
  return { venues: new Map(v.map((x) => [x.id, x])), musicians: new Map(m.map((x) => [x.id, x])) };
}
const otherName = (b: Booking, p: Profile, c: { venues: Map<string, EntityLite>; musicians: Map<string, EntityLite> }) =>
  (p.role === 'bar' ? c.musicians.get(b.musicianId)?.name : c.venues.get(b.venueId)?.name) ?? '…';

export const BookingsView: React.FC<{ profile: Profile; refreshKey: number; onOpen: (id: string) => void }> = ({ profile, refreshKey, onOpen }) => {
  const { api } = useSession();
  const { data, loading, error } = useLoad(async () => { const rows = await api.myBookings(); return { rows, c: await counterparts(api, rows) }; }, [refreshKey]);
  if (loading) return <Empty>Cargando tus reservas…</Empty>;
  if (error) return <Banner kind="error">{error}</Banner>;
  const { rows, c } = data!;
  if (!rows.length) return <Empty>{profile.role === 'musico' ? 'Todavía no pediste ninguna fecha. Explorá la cartelera y reservá tu próximo show.' : 'Todavía no recibiste solicitudes. Publicá fechas para que los músicos te encuentren.'}</Empty>;
  const needsAction = (b: Booking) => (profile.role === 'bar' ? b.status === 'solicitada' || b.status === 'aceptada' : false);
  const live = (b: Booking) => ['solicitada', 'aceptada', 'confirmada'].includes(b.status) && new Date(b.endsAt) > new Date();
  const groups: [string, Booking[]][] = [
    ['Requieren tu acción', rows.filter(needsAction)],
    ['Próximas y en curso', rows.filter((b) => live(b) && !needsAction(b))],
    ['Historial', rows.filter((b) => !live(b) && !needsAction(b))],
  ];
  return (
    <div className="space-y-4">
      {groups.filter(([, g]) => g.length).map(([title, g]) => (
        <section key={title} className="space-y-2" aria-label={title}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
          {g.map((b) => (
            <Card key={b.id} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-100">{otherName(b, profile, c)}</p>
                <p className="text-xs text-slate-400">{fmtDateTime(b.startsAt)} · {ars(b.cachetArs)}</p>
                <Pill tone={tone(b.status)}>{STATUS_LABEL[b.status]}</Pill>
              </div>
              <Btn kind="ghost" aria-label={`Ver reserva con ${otherName(b, profile, c)}`} onClick={() => onOpen(b.id)}>Ver</Btn>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
};

const EVENT_LABEL: Record<string, string> = {
  solicitada: 'Solicitud enviada', aceptada: 'El bar aceptó', rechazada: 'Solicitud rechazada', confirmada: 'Pago retenido: fecha confirmada', cancelada: 'Reserva cancelada',
  expirada: 'La reserva venció', realizada: 'Show realizado: pago liberado', disputa: 'Problema reportado', disputa_resuelta: 'Disputa resuelta por el equipo', resena: 'Reseña enviada',
};
const CRITERIA = {
  bar: [['punctuality', 'Puntualidad'], ['liveSound', 'Sonido en vivo'], ['crowdDrawing', 'Convocatoria'], ['professionalism', 'Profesionalismo']],
  musico: [['soundQuality', 'Calidad de sonido'], ['paymentReliability', 'Cumplimiento de pago'], ['hospitality', 'Hospitalidad'], ['respect', 'Respeto']],
} as const;

export const BookingSheet: React.FC<{ bookingId: string; profile: Profile; onClose: () => void; onChanged: () => void; returning?: PaymentReturn }> = ({ bookingId, profile, onClose, onChanged, returning }) => {
  const { api } = useSession();
  const act = useAction();
  const [confirm, setConfirm] = useState<null | 'cancel' | 'reject' | 'report'>(null);
  const [reason, setReason] = useState(''), [msg, setMsg] = useState('');
  const { data, loading, reload } = useLoad(async () => {
    const b = await api.booking(bookingId);
    if (!b) return null;
    const [events, payment, reviews, messages, c, fees] = await Promise.all([api.bookingEvents(b.id), api.bookingPayment(b.id), api.bookingReviews(b.id), api.messages(b.id), counterparts(api, [b]), api.fees()]);
    return { b, events, payment, reviews, messages, c, fees };
  }, [bookingId]);

  // Al volver de Mercado Pago el aviso puede demorar unos segundos: consultamos hasta ver la reserva confirmada.
  const [polls, setPolls] = useState(0);
  const waiting = returning?.result === 'ok' && returning.bookingId === bookingId && !!data && data.b.status === 'aceptada' && polls < pollConfig.max;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => { setPolls((n) => n + 1); reload(); onChanged(); }, pollConfig.ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, polls]);
  const after = () => { reload(); onChanged(); setConfirm(null); setReason(''); };
  if (loading && !data) return <Sheet title="Reserva" onClose={onClose}><Empty>Cargando…</Empty></Sheet>;
  if (!data) return <Sheet title="Reserva" onClose={onClose}><Banner kind="error">No encontramos esa reserva.</Banner></Sheet>;
  const { b, events, payment, reviews, messages, c, fees } = data;
  const isBar = profile.role === 'bar', name = otherName(b, profile, c), now = new Date();
  const started = new Date(b.startsAt) <= now, ended = new Date(b.endsAt) <= now, hrs = hoursUntil(b.startsAt);
  const price = pricePreview(b.cachetArs, fees.venueFeeBps, fees.musicianFeeBps);
  const isReturn = returning?.bookingId === b.id ? returning.result : null;
  const payWithMp = async () => { const r = await act.run(() => api.startPayment(b.id)); if (!r) return; if (r.status === 'aprobado' || !r.initPoint) after(); else goToCheckout(r.initPoint); };
  const myReview = reviews.find((r) => r.authorRole === profile.role);
  const chatOpen = !['rechazada', 'expirada'].includes(b.status);
  const send = async () => { if (await act.run(() => api.sendMessage(b.id, msg))) { setMsg(''); reload(); } };

  let refundNote = 'Cancelar es gratis: todavía no hay dinero retenido.';
  if (b.status === 'confirmada' && payment) {
    if (isBar) { const pct = refundPct(b.cancellationPolicy, hrs); const rf = settleAmounts(payment.cachetArs, payment.venueFeeArs, 0, pct).refunded; refundNote = `Con la política ${POLICY_LABEL[b.cancellationPolicy]} y ${Math.max(0, Math.round(hrs))} h de anticipación te reembolsamos ${pct}% (${ars(rf)}).`; }
    else refundNote = `El bar recibe el reembolso total.${hrs < 24 ? ' Cancelar con menos de 24 h cuenta como cancelación tardía en tu perfil.' : ''}`;
  }

  return (
    <Sheet title={`Reserva con ${name}`} onClose={onClose}>
      <div className="flex items-center gap-2"><Pill tone={tone(b.status)}>{STATUS_LABEL[b.status]}</Pill>{b.disputedAt && <Pill tone="red">Problema en revisión</Pill>}</div>
      <p className="text-sm text-amber-300">{fmtDateTime(b.startsAt)}</p>
      <p className="text-sm text-slate-300">Cachet acordado: <strong>{ars(b.cachetArs)}</strong> · Política {POLICY_LABEL[b.cancellationPolicy]}</p>
      <p className="text-[11px] text-slate-500">{POLICY_RULES[b.cancellationPolicy]}</p>
      {payment && <Card className="text-xs text-slate-300 space-y-0.5">
        <p><strong>Pago:</strong> {payment.status === 'held' ? 'retenido por SuenaBA' : payment.status === 'released' ? 'liberado al músico' : payment.status === 'refunded' ? 'reembolsado al bar' : 'reembolsado en parte'} ({payment.provider})</p>
        <p>{isBar ? `Total cobrado: ${ars(payment.chargedArs)}${payment.venueFeeArs ? ` (incluye comisión ${ars(payment.venueFeeArs)})` : ' (sin comisión)'}` : `Cachet a cobrar: ${ars(payment.cachetArs)}`}</p>
        {payment.status !== 'held' && <p>{isBar ? `Reembolsado: ${ars(payment.refundedArs)}` : `Te pagaron: ${ars(payment.payoutArs)}`}</p>}
      </Card>}
      {isReturn === 'ok' && b.status === 'aceptada' && <Banner kind="info">Estamos confirmando tu pago… Esto puede tardar unos segundos.</Banner>}
      {isReturn === 'ok' && b.status === 'confirmada' && <Banner kind="ok">¡Pago confirmado! La fecha quedó reservada.</Banner>}
      {isReturn === 'error' && b.status === 'aceptada' && <Banner kind="error">El pago no se completó. Podés intentarlo de nuevo.</Banner>}
      {isReturn === 'pendiente' && b.status === 'aceptada' && <Banner kind="info">Tu pago está pendiente de acreditación. Te avisamos apenas se confirme.</Banner>}
      {b.status === 'aceptada' && b.fundBy && <Banner kind="info">{isBar ? `Pagá antes del ${fmtDateTime(b.fundBy)} para confirmar la fecha.` : 'El bar tiene que pagar para confirmar. Te avisamos cuando lo haga.'}</Banner>}
      {act.error && <Banner kind="error">{act.error}</Banner>}
      {act.ok && <Banner kind="ok">{act.ok}</Banner>}

      <div className="space-y-2">
        {isBar && b.status === 'solicitada' && confirm !== 'reject' && <div className="flex gap-2"><Btn className="flex-1" disabled={act.busy} onClick={async () => { if (await act.run(() => api.respond(b.id, true), 'Solicitud aceptada.')) after(); }}>Aceptar solicitud</Btn><Btn kind="ghost" onClick={() => setConfirm('reject')}>Rechazar</Btn></div>}
        {isBar && b.status === 'solicitada' && confirm === 'reject' && <Card className="space-y-2"><Field label="Motivo (opcional)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div className="flex gap-2"><Btn kind="danger" disabled={act.busy} onClick={async () => { if (await act.run(() => api.respond(b.id, false, reason), 'Solicitud rechazada.')) after(); }}>Confirmar rechazo</Btn><Btn kind="ghost" onClick={() => setConfirm(null)}>Volver</Btn></div></Card>}
        {isBar && b.status === 'aceptada' && fees.paymentMode === 'simulado' && <Btn className="w-full" disabled={act.busy} onClick={async () => { if (await act.run(() => api.fund(b.id), 'Pago retenido: la fecha quedó confirmada.')) after(); }}>Pagar y confirmar ({ars(price.barPays)})</Btn>}
        {isBar && b.status === 'aceptada' && fees.paymentMode === 'mercadopago' && <div className="space-y-1"><Btn className="w-full" disabled={act.busy} onClick={payWithMp}>Pagar con Mercado Pago ({ars(price.barPays)})</Btn><p className="text-[11px] text-slate-500">Te llevamos a Mercado Pago. Al volver confirmamos tu pago automáticamente; el dinero queda retenido hasta el show.</p></div>}
        {['solicitada', 'aceptada', 'confirmada'].includes(b.status) && !started && confirm !== 'cancel' && <Btn kind="ghost" className="w-full" onClick={() => setConfirm('cancel')}>Cancelar reserva</Btn>}
        {confirm === 'cancel' && <Card className="space-y-2"><p className="text-sm text-slate-200">{refundNote}</p><Field label="Motivo (opcional)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div className="flex gap-2"><Btn kind="danger" disabled={act.busy} onClick={async () => { if (await act.run(() => api.cancel(b.id, reason), 'Reserva cancelada.')) after(); }}>Sí, cancelar</Btn><Btn kind="ghost" onClick={() => setConfirm(null)}>Volver</Btn></div></Card>}
        {b.status === 'confirmada' && ended && !b.disputedAt && <Btn className="w-full" disabled={act.busy} onClick={async () => { if (await act.run(() => api.complete(b.id), 'Show realizado. El pago fue liberado.')) after(); }}>Marcar show como realizado</Btn>}
        {b.status === 'confirmada' && started && !b.disputedAt && confirm !== 'report' && <Btn kind="ghost" className="w-full" onClick={() => setConfirm('report')}>Reportar un problema</Btn>}
        {confirm === 'report' && <Card className="space-y-2"><Field label="Contanos qué pasó"><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field><div className="flex gap-2"><Btn kind="danger" disabled={act.busy || !reason.trim()} onClick={async () => { if (await act.run(() => api.reportProblem(b.id, reason), 'Reporte enviado: el pago queda retenido hasta que lo revisemos.')) after(); }}>Enviar reporte</Btn><Btn kind="ghost" onClick={() => setConfirm(null)}>Volver</Btn></div></Card>}
      </div>

      {b.status === 'realizada' && (myReview ? <Banner kind="ok">Ya dejaste tu reseña{myReview.publishedAt ? ' (publicada).' : '. Se publica cuando la otra parte también reseñe o a los 14 días.'}</Banner>
        : <ReviewForm role={profile.role} name={name} onSubmit={async (rating, breakdown, comment) => { if (await act.run(() => api.review(b.id, rating, breakdown, comment), 'Reseña enviada. Se publica cuando ambos reseñan o a los 14 días.')) after(); }} busy={act.busy} />)}
      {reviews.filter((r) => r.publishedAt).map((r) => <Card key={r.id} className="text-xs text-slate-300"><Stars value={r.rating} label={`Reseña de ${r.authorRole === 'bar' ? 'el bar' : 'el músico'}`} /><p>{r.comment}</p></Card>)}

      <section aria-label="Historial" className="space-y-1">
        <h3 className="text-xs font-bold uppercase text-slate-500">Historial</h3>
        <ol className="space-y-1 text-xs text-slate-400">{events.filter((e) => EVENT_LABEL[e.event]).map((e) => <li key={e.id}>{fmtShort(e.at)} · {EVENT_LABEL[e.event]}</li>)}</ol>
      </section>

      {chatOpen && <section aria-label="Chat" className="space-y-2">
        <h3 className="text-xs font-bold uppercase text-slate-500">Mensajes</h3>
        <div className="space-y-1">{messages.length === 0 && <p className="text-xs text-slate-500">Todavía no hay mensajes.</p>}{messages.map((m) => <p key={m.id} className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs ${m.senderRole === profile.role ? 'ml-auto bg-amber-500/20 text-amber-100' : 'bg-slate-800 text-slate-200'}`}>{m.body}</p>)}</div>
        <div className="flex gap-2"><input aria-label="Escribí un mensaje" className={inputCls} maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} /><Btn disabled={act.busy || !msg.trim()} onClick={send}>Enviar</Btn></div>
      </section>}
    </Sheet>
  );
};

const ReviewForm: React.FC<{ role: 'bar' | 'musico'; name: string; busy: boolean; onSubmit: (rating: number, breakdown: Record<string, number>, comment: string) => void }> = ({ role, name, busy, onSubmit }) => {
  const [rating, setRating] = useState(0), [comment, setComment] = useState('');
  const [crit, setCrit] = useState<Record<string, number>>({});
  const keys = CRITERIA[role];
  const ready = rating > 0 && keys.every(([k]) => crit[k] > 0);
  return (
    <Card className="space-y-2">
      <h3 className="text-sm font-bold text-slate-100">¿Cómo fue con {name}?</h3>
      <Field label="Calificación general"><Stars value={rating} onChange={setRating} label="Calificación general" /></Field>
      {keys.map(([k, label]) => <Field key={k} label={label}><Stars value={crit[k] ?? 0} onChange={(n) => setCrit({ ...crit, [k]: n })} label={label} /></Field>)}
      <Field label="Comentario (opcional)"><textarea className={inputCls} rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <Btn className="w-full" disabled={!ready || busy} onClick={() => onSubmit(rating, Object.fromEntries(keys.map(([k]) => [k, crit[k]])), comment)}>Enviar reseña</Btn>
    </Card>
  );
};
