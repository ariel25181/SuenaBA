import React, { useState } from 'react';
import {
  Clock,
  Plus,
  Calendar,
  MapPin,
  DollarSign,
  Star,
  Building2,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Send,
  Music,
  Check,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { MusicianAvailability } from '../types/index.ts';
import { formatARS, formatDateBA, filterMusicianAvailabilities } from '../utils/bookingLogic.ts';

interface MusicianAvailabilityViewProps {
  onOpenPublishModal: () => void;
  onOpenDirectOfferModal: (availability: MusicianAvailability) => void;
  onViewMusician: (musicianId: string) => void;
  onViewVenue: (venueId: string) => void;
}

const NEIGHBORHOODS: string[] = [
  'Todos',
  'Palermo Soho',
  'San Telmo',
  'Colegiales',
  'Villa Crespo',
  'Recoleta',
  'Almagro',
];

export const MusicianAvailabilityView: React.FC<MusicianAvailabilityViewProps> = ({
  onOpenPublishModal,
  onOpenDirectOfferModal,
  onViewMusician,
  onViewVenue,
}) => {
  const {
    role,
    setRole,
    musicianAvailabilities,
    currentMusician,
    musicians,
    acceptDirectOffer,
    rejectDirectOffer,
  } = useApp();

  const [selectedNeighborhood, setSelectedNeighborhood] = useState('Todos');
  const [selectedGenre, setSelectedGenre] = useState('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredItems = filterMusicianAvailabilities(musicianAvailabilities, {
    query: searchQuery,
    neighborhood: selectedNeighborhood,
    genre: selectedGenre,
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Banner */}
      <div className="bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            <Clock className="w-3.5 h-3.5 mr-1" />
            Tablón de Disponibilidad • Función 2
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 font-display">
            Músicos Disponibles para Tocar en CABA
          </h1>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            Los músicos publican sus fechas libres para que los bares y restaurantes los contacten y les propongan tocar.
          </p>

          {/* Action based on role */}
          <div className="pt-2">
            {role === 'musico' ? (
              <button
                onClick={onOpenPublishModal}
                className="py-2.5 px-4 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-cyan-500/20 transition-all flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>Publicar Fecha Libre ({currentMusician?.stageName})</span>
              </button>
            ) : (
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400">¿Sos músico?</span>
                <button
                  onClick={() => {
                    setRole('musico');
                    onOpenPublishModal();
                  }}
                  className="text-cyan-400 hover:text-cyan-300 font-bold underline"
                >
                  Cambiar a Modo Músico y Avisar que tenés fecha libre
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Neighborhood Filters */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
          <span>Filtrar por Barrio</span>
          <span className="text-cyan-400">{selectedNeighborhood}</span>
        </div>
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {NEIGHBORHOODS.map((hood) => (
            <button
              key={hood}
              onClick={() => setSelectedNeighborhood(hood)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                selectedNeighborhood === hood
                  ? 'bg-cyan-500 text-slate-950 border-cyan-500'
                  : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              {hood}
            </button>
          ))}
        </div>
      </div>

      {/* Availabilities List */}
      <div className="space-y-4">
        {filteredItems.length === 0 ? (
          <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800 p-6 space-y-2">
            <p className="text-slate-300 font-medium">
              No hay músicos con fecha libre para esos filtros.
            </p>
            <p className="text-xs text-slate-500">Probá seleccionando "Todos" los barrios.</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const musician = musicians.find((m) => m.id === item.musicianId);
            const isOwner = role === 'musico' && item.musicianId === currentMusician?.id;
            const isExpanded = expandedId === item.id;

            return (
              <div
                key={item.id}
                className={`bg-slate-900/90 border rounded-2xl overflow-hidden transition-all ${
                  item.status === 'reservado'
                    ? 'border-emerald-500/30 bg-slate-900/40'
                    : 'border-slate-800 hover:border-cyan-500/40 shadow-md'
                }`}
              >
                {/* Header Card */}
                <div className="p-4 sm:p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <img
                        src={item.musicianAvatar || musician?.avatarUrl}
                        alt={item.musicianName}
                        onClick={() => onViewMusician(item.musicianId)}
                        className="w-12 h-12 rounded-full object-cover border border-cyan-500/40 cursor-pointer hover:scale-105 transition-transform"
                      />
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <h3
                            onClick={() => onViewMusician(item.musicianId)}
                            className="font-bold text-slate-100 text-base font-display hover:text-cyan-400 cursor-pointer transition-colors"
                          >
                            {item.musicianName}
                          </h3>
                          {musician && (
                            <span className="text-xs text-amber-400 font-bold flex items-center">
                              ⭐ {musician.rating.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {item.musicianFormat} • {item.musicianGenres.join(', ')}
                        </div>
                      </div>
                    </div>

                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                      Fecha Disponible
                    </span>
                  </div>

                  {/* Date & Time Slot */}
                  <div className="grid grid-cols-2 gap-2 p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 text-xs">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                          Día Libre
                        </span>
                        <span className="font-bold text-slate-200">
                          {formatDateBA(item.date)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-semibold">
                          Franja
                        </span>
                        <span className="font-bold text-slate-200 capitalize">
                          {item.timeSlot === 'todo_el_dia' ? 'Todo el día' : item.timeSlot}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cachet expectation & Message */}
                  <div className="p-3 bg-slate-950/50 rounded-xl border border-slate-800/80 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Caché pretendido por la banda:</span>
                      <span className="font-bold text-emerald-400 text-sm">
                        {formatARS(item.expectedCachetARS)}
                      </span>
                    </div>

                    <div className="flex items-start space-x-1.5 text-slate-400 text-[11px]">
                      <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                      <span>
                        Zonas preferidas: {item.preferredNeighborhoods.join(', ')}
                      </span>
                    </div>

                    <p className="text-slate-300 italic text-xs pt-1 border-t border-slate-800/80">
                      "{item.message}"
                    </p>
                  </div>

                  {/* Footer & Actions */}
                  <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-800/80">
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                    >
                      <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                      <span>
                        {item.directOffers.length}{' '}
                        {item.directOffers.length === 1 ? 'oferta de bar' : 'ofertas de bares'}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {item.status === 'disponible' ? (
                      <button
                        onClick={() => onOpenDirectOfferModal(item)}
                        className="py-2 px-4 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all flex items-center space-x-1.5"
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Proponer Fecha (Bar)</span>
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-400 flex items-center space-x-1">
                        <Check className="w-4 h-4" />
                        <span>Fecha Reservada</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded Section: Direct Offers from Bars (Musician can accept or reject) */}
                {isExpanded && (
                  <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                      <span>Propuestas recibidas de bares ({item.directOffers.length}):</span>
                      {isOwner && (
                        <span className="text-cyan-400 text-[11px]">
                          Como músico podés aceptar la propuesta
                        </span>
                      )}
                    </div>

                    {item.directOffers.length === 0 ? (
                      <p className="text-xs text-slate-500 py-3 text-center">
                        Todavía no hay ofertas de bares para esta fecha. Los bares de la zona te contactarán pronto.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {item.directOffers.map((offer) => (
                          <div
                            key={offer.id}
                            className={`p-3 rounded-xl border text-xs space-y-2 ${
                              offer.status === 'aceptada'
                                ? 'bg-emerald-950/20 border-emerald-500/40'
                                : offer.status === 'rechazada'
                                ? 'bg-slate-900/40 border-slate-800 opacity-60'
                                : 'bg-slate-900 border-slate-800'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center space-x-2.5">
                                <img
                                  src={offer.venueAvatar}
                                  alt={offer.venueName}
                                  onClick={() => onViewVenue(offer.venueId)}
                                  className="w-9 h-9 rounded-xl object-cover border border-purple-500/40 cursor-pointer hover:border-purple-400"
                                />
                                <div>
                                  <div
                                    onClick={() => onViewVenue(offer.venueId)}
                                    className="font-bold text-slate-100 hover:text-purple-400 cursor-pointer"
                                  >
                                    {offer.venueName}
                                  </div>
                                  <div className="text-[11px] text-slate-400">
                                    {offer.venueNeighborhood}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right">
                                <div className="font-bold text-emerald-400 text-xs">
                                  {formatARS(offer.offeredCachetARS)}
                                </div>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block mt-0.5 ${
                                    offer.status === 'aceptada'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : offer.status === 'rechazada'
                                      ? 'bg-rose-500/20 text-rose-400'
                                      : 'bg-purple-500/20 text-purple-400'
                                  }`}
                                >
                                  {offer.status === 'aceptada'
                                    ? 'Aceptada'
                                    : offer.status === 'rechazada'
                                    ? 'Rechazada'
                                    : 'Pendiente'}
                                </span>
                              </div>
                            </div>

                            <p className="text-slate-300 italic text-[11px] bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                              "{offer.note}"
                            </p>

                            {/* Action to accept offer (for musician) */}
                            {role === 'musico' && offer.status === 'pendiente' && item.status === 'disponible' && (
                              <div className="flex items-center space-x-2 pt-1">
                                <button
                                  onClick={() => acceptDirectOffer(item.id, offer.id)}
                                  className="flex-1 py-1.5 px-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs flex items-center justify-center space-x-1"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  <span>Aceptar Oferta & Confirmar en Cartelera</span>
                                </button>
                                <button
                                  onClick={() => rejectDirectOffer(item.id, offer.id)}
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
