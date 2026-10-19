import React, { useState } from 'react';
import {
  X,
  Calendar,
  Clock,
  MapPin,
  Star,
  Users,
  Ticket,
  UtensilsCrossed,
  Share2,
  Check,
  Music,
} from 'lucide-react';
import { LiveShowConfirmed } from '../../types/index.ts';
import { useApp } from '../../context/AppContext.tsx';
import { formatARS, formatDateBA } from '../../utils/bookingLogic.ts';

interface ShowDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  show: LiveShowConfirmed | null;
  onViewVenueProfile?: (venueId: string) => void;
  onViewMusicianProfile?: (musicianId: string) => void;
}

export const ShowDetailModal: React.FC<ShowDetailModalProps> = ({
  isOpen,
  onClose,
  show,
  onViewVenueProfile,
  onViewMusicianProfile,
}) => {
  const { venues, musicians } = useApp();
  const [reserved, setReserved] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !show) return null;

  const venue = venues.find((v) => v.id === show.venueId);
  const musician = musicians.find((m) => m.id === show.musicianId);

  const handleReserve = (e: React.FormEvent) => {
    e.preventDefault();
    setReserved(true);
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(
        `¡Vamos a ver a ${show.musicianName} en ${show.venueName} el ${formatDateBA(show.date)}! Entradas y reservas en SuenaBA.`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Cover Photo */}
        <div className="relative h-48 sm:h-56 w-full overflow-hidden bg-slate-950">
          <img
            src={show.venuePhoto}
            alt={show.venueName}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Cerrar detalle del show"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-slate-950/70 border border-slate-700/80 flex items-center justify-center text-slate-200 hover:bg-slate-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Share button */}
          <button
            onClick={handleShare}
            aria-label="Compartir show"
            className="absolute top-4 right-15 w-9 h-9 rounded-full bg-slate-950/70 border border-slate-700/80 flex items-center justify-center text-slate-200 hover:bg-slate-900 transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
          </button>

          {/* Date & Genre Tag */}
          <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500 text-slate-950 shadow-md">
              {formatDateBA(show.date)} • {show.time}
            </span>
            <div className="flex gap-1.5">
              {show.musicianGenres.slice(0, 2).map((g) => (
                <span
                  key={g}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-900/80 text-amber-300 border border-amber-500/30 backdrop-blur-md"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1 text-slate-200">
          {/* Title & Artist */}
          <div>
            <div className="text-xs uppercase tracking-wider text-amber-400 font-semibold mb-1">
              Cartelera en Vivo • CABA
            </div>
            <h2 className="text-2xl font-extrabold text-slate-100 font-display">
              {show.musicianName}
            </h2>
            <div className="flex items-center space-x-2 text-sm text-slate-400 mt-1">
              <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>{show.venueName}</strong> — {show.venueAddress}, {show.venueNeighborhood}
              </span>
            </div>
          </div>

          {/* Airbnb-style Counterpart Reputation Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Musician Card */}
            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center space-x-2 mb-2">
                <img
                  src={show.musicianAvatar}
                  alt={show.musicianName}
                  className="w-8 h-8 rounded-full object-cover border border-amber-500/40"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate text-slate-200">
                    {show.musicianName}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {show.musicianFormat}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
                <span className="text-amber-400 font-bold flex items-center">
                  <Star className="w-3.5 h-3.5 fill-amber-400 mr-1" />
                  {musician ? musician.rating.toFixed(2) : '4.9'}
                </span>
                <span className="text-slate-500">
                  {musician?.reviewCount || 18} shows
                </span>
              </div>
            </div>

            {/* Venue Card */}
            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center space-x-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-amber-400 font-bold text-xs">
                  🍸
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold truncate text-slate-200">
                    {show.venueName}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {show.venueNeighborhood}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800">
                <span className="text-amber-400 font-bold flex items-center">
                  <Star className="w-3.5 h-3.5 fill-amber-400 mr-1" />
                  {venue ? venue.rating.toFixed(2) : '4.9'}
                </span>
                <span className="text-slate-500">
                  {venue?.reviewCount || 30} reseñas
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="text-sm text-slate-300 leading-relaxed bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/80">
            {show.description}
          </div>

          {/* Ticket / Cover Condition */}
          <div className="flex items-center justify-between p-3.5 bg-gradient-to-r from-amber-950/20 to-slate-900 rounded-xl border border-amber-900/30">
            <div className="flex items-center space-x-3">
              <Ticket className="w-5 h-5 text-amber-400" />
              <div>
                <div className="text-xs text-slate-400 uppercase font-semibold">
                  Acceso al Show
                </div>
                <div className="text-sm font-bold text-slate-100">
                  {show.ticketType === 'entrada_libre'
                    ? 'Entrada Libre (Reserva sugerida)'
                    : show.ticketType === 'consumicion_minima'
                    ? `Consumición Mínima (${formatARS(show.ticketPriceARS)})`
                    : `Ticket / Entrada (${formatARS(show.ticketPriceARS)})`}
                </div>
              </div>
            </div>
            {venue?.hospitality && (
              <UtensilsCrossed className="w-4 h-4 text-slate-500" />
            )}
          </div>

          {/* Reservation Form */}
          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3">
            <h4 className="text-xs uppercase font-semibold tracking-wider text-slate-300">
              Reservar Mesa para el Show
            </h4>
            {reserved ? (
              <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-3.5 text-center text-xs text-emerald-300 space-y-1">
                <Check className="w-5 h-5 mx-auto text-emerald-400 mb-1" />
                <p className="font-bold">¡Mesa reservada para {partySize} personas!</p>
                <p className="text-slate-400">
                  Te esperamos en {show.venueName} ({show.venueAddress}) a las {show.time}.
                </p>
              </div>
            ) : (
              <form onSubmit={handleReserve} className="space-y-3">
                <div className="flex items-center space-x-3">
                  <label className="text-xs text-slate-400">Comensales:</label>
                  <div className="flex items-center space-x-2">
                    {[1, 2, 4, 6].map((num) => (
                      <button
                        type="button"
                        key={num}
                        onClick={() => setPartySize(num)}
                        className={`px-3 py-1 text-xs rounded-lg border font-semibold transition-colors ${
                          partySize === num
                            ? 'bg-amber-500 text-slate-950 border-amber-500'
                            : 'bg-slate-900 text-slate-400 border-slate-800'
                        }`}
                      >
                        {num} pers.
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 text-sm"
                >
                  <UtensilsCrossed className="w-4 h-4" />
                  <span>Confirmar Reserva de Mesa</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
