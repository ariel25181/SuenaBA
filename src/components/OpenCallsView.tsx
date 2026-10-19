import React, { useState } from 'react';
import {
  Radio,
  Plus,
  MapPin,
  Calendar,
  Clock,
  DollarSign,
  Speaker,
  Users,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
  Music,
  Star,
  Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { VenueOpenCall } from '../types/index.ts';
import { formatARS, formatDateBA, filterOpenCalls } from '../utils/bookingLogic.ts';

interface OpenCallsViewProps {
  onOpenPublishModal: () => void;
  onOpenApplyModal: (call: VenueOpenCall) => void;
  onViewVenue: (venueId: string) => void;
  onViewMusician: (musicianId: string) => void;
}

const NEIGHBORHOODS: string[] = [
  'Todos',
  'Palermo Hollywood',
  'Palermo Soho',
  'San Telmo',
  'Colegiales',
  'Villa Crespo',
  'Recoleta',
  'Almagro',
];

export const OpenCallsView: React.FC<OpenCallsViewProps> = ({
  onOpenPublishModal,
  onOpenApplyModal,
  onViewVenue,
  onViewMusician,
}) => {
  const { role, setRole, openCalls, currentVenue, acceptApplication, rejectApplication, venues } =
    useApp();

  const [selectedNeighborhood, setSelectedNeighborhood] = useState('Todos');
  const [selectedGenre, setSelectedGenre] = useState('Todos');
  const [minCachetFilter, setMinCachetFilter] = useState<number>(0);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);

  const filteredCalls = filterOpenCalls(openCalls, {
    neighborhood: selectedNeighborhood,
    genre: selectedGenre,
    minCachet: minCachetFilter,
  });

  const toggleExpand = (id: string) => {
    setExpandedCallId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Banner */}
      <div className="bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Radio className="w-3.5 h-3.5 mr-1 animate-pulse" />
            Convocatorias de Bares • Función 1
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 font-display">
            Fechas Abiertas de Restaurantes & Bares
          </h1>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            Los locales porteños publican fechas con caché garantizado y backline para recibir propuestas de músicos.
          </p>

          {/* Action based on role */}
          <div className="pt-2">
            {role === 'bar' ? (
              <button
                onClick={onOpenPublishModal}
                className="py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-amber-500/20 transition-all flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>Publicar Nueva Convocatoria ({currentVenue?.name})</span>
              </button>
            ) : (
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400">¿Sos dueño de un bar?</span>
                <button
                  onClick={() => {
                    setRole('bar');
                    onOpenPublishModal();
                  }}
                  className="text-amber-400 hover:text-amber-300 font-bold underline"
                >
                  Cambiar a Modo Bar y Publicar Fecha
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
          <span>Filtrar por Barrio</span>
          <span className="text-amber-400">{selectedNeighborhood}</span>
        </div>
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {NEIGHBORHOODS.map((hood) => (
            <button
              key={hood}
              onClick={() => setSelectedNeighborhood(hood)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                selectedNeighborhood === hood
                  ? 'bg-amber-500 text-slate-950 border-amber-500'
                  : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              {hood}
            </button>
          ))}
        </div>
      </div>

      {/* Open Calls List */}
      <div className="space-y-4">
        {filteredCalls.length === 0 ? (
          <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800 p-6 space-y-2">
            <p className="text-slate-300 font-medium">No hay convocatorias con esos filtros.</p>
            <p className="text-xs text-slate-500">Probá seleccionando otro barrio o restableciendo filtros.</p>
          </div>
        ) : (
          filteredCalls.map((call) => {
            const venue = venues.find((v) => v.id === call.venueId);
            const isOwner = role === 'bar' && call.venueId === currentVenue?.id;
            const isExpanded = expandedCallId === call.id;

            return (
              <div
                key={call.id}
                className={`bg-slate-900/90 border rounded-2xl overflow-hidden transition-all ${
                  call.status === 'cerrada_confirmada'
                    ? 'border-emerald-500/30 bg-slate-900/40'
                    : 'border-slate-800 hover:border-amber-500/40 shadow-md'
                }`}
              >
                {/* Header */}
                <div className="p-4 sm:p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <img
                        src={call.venueAvatar || venue?.coverPhoto}
                        alt={call.venueName}
                        onClick={() => onViewVenue(call.venueId)}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-700 cursor-pointer hover:border-amber-500 transition-colors"
                      />
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <h3
                            onClick={() => onViewVenue(call.venueId)}
                            className="font-bold text-slate-100 text-base font-display hover:text-amber-400 cursor-pointer transition-colors"
                          >
                            {call.venueName}
                          </h3>
                          {venue && (
                            <span className="text-xs text-amber-400 font-bold flex items-center">
                              ⭐ {venue.rating.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center text-xs text-slate-400 space-x-1 mt-0.5">
                          <MapPin className="w-3.5 h-3.5 text-amber-400" />
                          <span>{call.venueNeighborhood}</span>
                        </div>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="shrink-0">
                      {call.status === 'cerrada_confirmada' ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 whitespace-nowrap">
                          ✓ Fecha Cerrada
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 whitespace-nowrap">
                          Abierta a Propuestas
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Date & Schedule Bar */}
                  <div className="grid grid-cols-2 gap-2 p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 text-xs">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                          Fecha
                        </span>
                        <span className="font-bold text-slate-200">
                          {formatDateBA(call.date)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                          Horario
                        </span>
                        <span className="font-bold text-slate-200 truncate">
                          Prueba {call.soundcheckTime} hs
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cachet Offer Banner */}
                  <div className="p-3 bg-gradient-to-r from-emerald-950/20 via-slate-950/60 to-slate-950/60 rounded-xl border border-emerald-900/30 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                        <DollarSign className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-semibold block">
                          Caché Ofrecido
                        </span>
                        <span className="font-extrabold text-emerald-400 text-sm">
                          {formatARS(call.cachetAmountARS)}
                        </span>
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-400 max-w-[50%] text-right truncate">
                      {call.cachetDetails}
                    </span>
                  </div>

                  {/* Target Genres & Backline */}
                  <div className="space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-slate-400 text-[11px]">Buscan:</span>
                      {call.targetGenres.map((g) => (
                        <span
                          key={g}
                          className="px-2 py-0.5 rounded-md bg-slate-800 text-amber-300 font-medium text-[11px] border border-slate-700"
                        >
                          {g}
                        </span>
                      ))}
                    </div>

                    <div className="text-slate-300 text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/80 leading-relaxed">
                      <span className="text-slate-400 font-semibold mr-1">Backline provisto:</span>
                      {call.providedBackline.join(' • ')}
                    </div>
                  </div>

                  {/* Footer & Actions */}
                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-800/80">
                    <button
                      onClick={() => toggleExpand(call.id)}
                      className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                    >
                      <Users className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        {call.applications.length}{' '}
                        {call.applications.length === 1 ? 'postulación' : 'postulaciones'}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {call.status === 'abierta' ? (
                      <button
                        onClick={() => onOpenApplyModal(call)}
                        className="py-2 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all flex items-center space-x-1.5"
                      >
                        <Music className="w-3.5 h-3.5" />
                        <span>Postular Propuesta</span>
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-400 flex items-center space-x-1">
                        <Check className="w-4 h-4" />
                        <span>Confirmado: {call.confirmedMusicianName}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded Section: Postulaciones Recibidas (Review & Accept for Venue) */}
                {isExpanded && (
                  <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                      <span>Músicos postulados a esta fecha ({call.applications.length}):</span>
                      {isOwner && (
                        <span className="text-amber-400 text-[11px]">
                          Como bar, podés aceptar y confirmar la fecha
                        </span>
                      )}
                    </div>

                    {call.applications.length === 0 ? (
                      <p className="text-xs text-slate-500 py-3 text-center">
                        Aún no hay postulaciones para esta fecha. ¡Sé el primero en postularte!
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {call.applications.map((app) => (
                          <div
                            key={app.id}
                            className={`p-3 rounded-xl border text-xs space-y-2 ${
                              app.status === 'aceptada'
                                ? 'bg-emerald-950/20 border-emerald-500/40'
                                : app.status === 'rechazada'
                                ? 'bg-slate-900/40 border-slate-800 opacity-60'
                                : 'bg-slate-900 border-slate-800'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center space-x-2.5">
                                <img
                                  src={app.musicianAvatar}
                                  alt={app.musicianName}
                                  onClick={() => onViewMusician(app.musicianId)}
                                  className="w-9 h-9 rounded-full object-cover border border-amber-500/40 cursor-pointer hover:scale-105 transition-transform"
                                />
                                <div>
                                  <div
                                    onClick={() => onViewMusician(app.musicianId)}
                                    className="font-bold text-slate-100 hover:text-amber-400 cursor-pointer"
                                  >
                                    {app.musicianName}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {app.format} • {app.genres.join(', ')}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="font-bold text-emerald-400 text-xs">
                                  {formatARS(app.proposedCachetARS)}
                                </div>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block mt-0.5 ${
                                    app.status === 'aceptada'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : app.status === 'rechazada'
                                      ? 'bg-rose-500/20 text-rose-400'
                                      : 'bg-amber-500/20 text-amber-400'
                                  }`}
                                >
                                  {app.status === 'aceptada'
                                    ? 'Aceptada'
                                    : app.status === 'rechazada'
                                    ? 'Rechazada'
                                    : 'Pendiente'}
                                </span>
                              </div>
                            </div>

                            <p className="text-slate-300 italic text-[11px] bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                              "{app.note}"
                            </p>

                            {/* Action to accept / reject (Available for Bar owner or in Bar Mode) */}
                            {role === 'bar' && app.status === 'pendiente' && call.status === 'abierta' && (
                              <div className="flex items-center space-x-2 pt-1">
                                <button
                                  onClick={() => acceptApplication(call.id, app.id)}
                                  className="flex-1 py-1.5 px-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs flex items-center justify-center space-x-1"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  <span>Aceptar & Confirmar Fecha en Cartelera</span>
                                </button>
                                <button
                                  onClick={() => rejectApplication(call.id, app.id)}
                                  className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-rose-400 rounded-lg text-xs font-semibold"
                                >
                                  Rechazar
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
