import React, { useState } from 'react';
import {
  Handshake,
  Star,
  CheckCircle,
  Calendar,
  Clock,
  MapPin,
  Music,
  Wine,
  MessageSquare,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { LiveShowConfirmed } from '../types/index.ts';
import { formatARS, formatDateBA } from '../utils/bookingLogic.ts';

interface AgreementsAndReviewsViewProps {
  onOpenReviewModal: (params: {
    targetType: 'musician' | 'venue';
    targetId: string;
    targetName: string;
    showDate: string;
    showVenueName: string;
    showIdToComplete?: string;
  }) => void;
  onViewVenue: (venueId: string) => void;
  onViewMusician: (musicianId: string) => void;
}

export const AgreementsAndReviewsView: React.FC<AgreementsAndReviewsViewProps> = ({
  onOpenReviewModal,
  onViewVenue,
  onViewMusician,
}) => {
  const {
    role,
    currentMusician,
    currentVenue,
    liveShows,
    openCalls,
    musicianAvailabilities,
  } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'pending_reviews' | 'upcoming' | 'applications'>('pending_reviews');

  // Past shows that require review (either musician reviewing venue or venue reviewing musician)
  const pastShowsNeedingReview = liveShows.filter((show) => {
    if (role === 'musico') {
      return show.isCompleted && !show.venueReviewed;
    } else if (role === 'bar') {
      return show.isCompleted && !show.musicianReviewed;
    }
    return show.isCompleted && (!show.venueReviewed || !show.musicianReviewed);
  });

  // Upcoming confirmed shows
  const upcomingShows = liveShows.filter((show) => !show.isCompleted);

  // Musician's submitted applications across all calls
  const myApplications = openCalls.flatMap((call) =>
    call.applications
      .filter((app) => app.musicianId === currentMusician?.id)
      .map((app) => ({ ...app, callVenue: call.venueName, callDate: call.date, callNeighborhood: call.venueNeighborhood }))
  );

  return (
    <div className="space-y-5 pb-24">
      {/* Banner */}
      <div className="bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Handshake className="w-3.5 h-3.5 mr-1" />
            Gestión de Acuerdos & Feedback Bilateral
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 font-display">
            Mis Fechas & Reputación Bilateral
          </h1>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            Al estilo Airbnb, tras finalizar cada show, bares y músicos dejan calificaciones y comentarios honestos para nutrir la reputación mutua.
          </p>
        </div>
      </div>

      {/* Sub tabs switcher */}
      <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 text-xs">
        <button
          onClick={() => setActiveSubTab('pending_reviews')}
          className={`flex-1 py-2 px-1 sm:px-2 rounded-xl font-bold flex items-center justify-center space-x-1 transition-all ${
            activeSubTab === 'pending_reviews'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Star className="w-3.5 h-3.5 shrink-0" />
          <span>Por Calificar</span>
          {pastShowsNeedingReview.length > 0 && (
            <span
              className={`w-4 h-4 rounded-full text-[10px] font-black flex items-center justify-center shrink-0 ${
                activeSubTab === 'pending_reviews' ? 'bg-slate-950 text-amber-400' : 'bg-amber-500 text-slate-950'
              }`}
            >
              {pastShowsNeedingReview.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('upcoming')}
          className={`flex-1 py-2 px-1 sm:px-2 rounded-xl font-bold flex items-center justify-center space-x-1 transition-all ${
            activeSubTab === 'upcoming'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>Confirmadas</span>
          <span className="text-[10px] text-slate-400">({upcomingShows.length})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('applications')}
          className={`flex-1 py-2 px-1 sm:px-2 rounded-xl font-bold flex items-center justify-center space-x-1 transition-all ${
            activeSubTab === 'applications'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5 shrink-0" />
          <span>Postulaciones</span>
        </button>
      </div>

      {/* SubTab 1: Calificaciones Pendientes Post-Show (Airbnb-style) */}
      {activeSubTab === 'pending_reviews' && (
        <div className="space-y-4">
          <div className="bg-amber-950/20 border border-amber-900/40 rounded-2xl p-4 flex items-start space-x-3 text-xs text-amber-200/90 leading-relaxed">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-300 mb-0.5">
                Sistema de Reputación Bilateral Cerrado
              </p>
              <p className="text-slate-300">
                Solo quienes hayan acordado y finalizado una fecha en SuenaBA pueden calificarse mutuamente (puntualidad en el pago, sonido, camarín, trato y convocatoria).
              </p>
            </div>
          </div>

          {pastShowsNeedingReview.length === 0 ? (
            <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800 p-6 space-y-2">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-1" />
              <p className="text-slate-200 font-bold">¡Estás al día con todas las calificaciones!</p>
              <p className="text-xs text-slate-400">
                Cuando finalice tu próximo show, aparecerá aquí para que puedas darle feedback a la contraparte.
              </p>
            </div>
          ) : (
            pastShowsNeedingReview.map((show) => {
              const targetIsVenue = role === 'musico';
              const targetName = targetIsVenue ? show.venueName : show.musicianName;
              const targetId = targetIsVenue ? show.venueId : show.musicianId;

              return (
                <div
                  key={show.id}
                  className="bg-slate-900 border-2 border-amber-500/40 rounded-2xl p-5 shadow-lg space-y-4 relative overflow-hidden"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">
                        ⭐ Show Finalizado • Calificación Pendiente
                      </div>
                      <h3 className="text-lg font-bold text-slate-100 font-display">
                        Fecha del {formatDateBA(show.date)} en {show.venueName}
                      </h3>
                      <p className="text-xs text-slate-400">
                        Artista: <strong>{show.musicianName}</strong> ({show.musicianFormat})
                      </p>
                    </div>

                    <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-slate-700">
                      <img
                        src={show.venuePhoto}
                        alt={show.venueName}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 text-xs space-y-1 text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Bar Anfitrión:</span>
                      <span className="font-semibold text-slate-200">
                        {show.venueName} ({show.venueNeighborhood})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Banda / Músico:</span>
                      <span className="font-semibold text-slate-200">{show.musicianName}</span>
                    </div>
                  </div>

                  <div className="pt-1 flex items-center gap-2">
                    <button
                      onClick={() =>
                        onOpenReviewModal({
                          targetType: targetIsVenue ? 'venue' : 'musician',
                          targetId,
                          targetName,
                          showDate: show.date,
                          showVenueName: show.venueName,
                          showIdToComplete: show.id,
                        })
                      }
                      className="flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all flex items-center justify-center space-x-2"
                    >
                      <Star className="w-4 h-4 fill-slate-950" />
                      <span>Calificar a {targetName} estilo Airbnb</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* SubTab 2: Próximas Fechas Confirmadas */}
      {activeSubTab === 'upcoming' && (
        <div className="space-y-4">
          {upcomingShows.length === 0 ? (
            <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800 p-6 space-y-2">
              <p className="text-slate-300 font-medium">No tenés fechas próximas acordadas.</p>
              <p className="text-xs text-slate-500">
                Revisá las convocatorias abiertas de bares o publicá tu disponibilidad.
              </p>
            </div>
          ) : (
            upcomingShows.map((show) => (
              <div
                key={show.id}
                className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-md space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <img
                      src={show.venuePhoto}
                      alt={show.venueName}
                      className="w-12 h-12 rounded-xl object-cover border border-slate-700"
                    />
                    <div>
                      <h3 className="font-bold text-slate-100 text-base font-display">
                        {show.musicianName} en {show.venueName}
                      </h3>
                      <div className="text-xs text-slate-400 flex items-center space-x-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        <span>{show.venueAddress}, {show.venueNeighborhood}</span>
                      </div>
                    </div>
                  </div>

                  <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                    Confirmado en Cartelera
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-950/70 rounded-xl border border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Fecha del Show</span>
                    <span className="font-bold text-slate-200">{formatDateBA(show.date)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Horario</span>
                    <span className="font-bold text-amber-400">{show.time}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>Géneros: {show.musicianGenres.join(', ')}</span>
                  <button
                    onClick={() => onViewVenue(show.venueId)}
                    className="text-amber-400 hover:text-amber-300 font-semibold underline"
                  >
                    Ver info del Bar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* SubTab 3: Postulaciones Enviadas */}
      {activeSubTab === 'applications' && (
        <div className="space-y-4">
          <div className="text-xs text-slate-400">
            Seguimiento de las propuestas de fecha que enviaste a bares de Buenos Aires:
          </div>

          {myApplications.length === 0 ? (
            <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800 p-6 space-y-2">
              <p className="text-slate-300 font-medium">No enviaste postulaciones todavía.</p>
              <p className="text-xs text-slate-500">
                Mirá la pestaña de "Convocatorias" y postulate a las fechas que te interesen.
              </p>
            </div>
          ) : (
            myApplications.map((app) => (
              <div
                key={app.id}
                className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2.5 text-xs"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-slate-100 text-sm">{app.callVenue}</div>
                    <div className="text-slate-400">
                      Fecha: {formatDateBA(app.callDate)} ({app.callNeighborhood})
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                      app.status === 'aceptada'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : app.status === 'rechazada'
                        ? 'bg-rose-500/20 text-rose-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {app.status === 'aceptada'
                      ? 'Aceptada & Confirmada'
                      : app.status === 'rechazada'
                      ? 'No seleccionada'
                      : 'En evaluación por el bar'}
                  </span>
                </div>

                <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80 text-slate-300 italic">
                  "{app.note}"
                </div>

                <div className="flex justify-between items-center text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                  <span>Caché propuesto: <strong className="text-emerald-400">{formatARS(app.proposedCachetARS)}</strong></span>
                  <span>Demo: {app.demoTrackTitle}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
