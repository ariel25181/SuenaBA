import React, { useState } from 'react';
import { X, Send, DollarSign, Calendar, MapPin, Building2 } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { MusicianAvailability } from '../../types/index.ts';
import { formatARS, formatDateBA } from '../../utils/bookingLogic.ts';

interface DirectOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  availability: MusicianAvailability | null;
}

export const DirectOfferModal: React.FC<DirectOfferModalProps> = ({
  isOpen,
  onClose,
  availability,
}) => {
  const { currentVenue, sendDirectOffer } = useApp();

  const [offeredCachet, setOfferedCachet] = useState<number>(
    availability?.expectedCachetARS || 110000
  );
  const [note, setNote] = useState<string>('');

  if (!isOpen || !availability || !currentVenue) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    sendDirectOffer(availability.id, {
      venueId: currentVenue.id,
      venueName: currentVenue.name,
      venueNeighborhood: currentVenue.neighborhood,
      venueAvatar: currentVenue.photos[0] || '',
      date: availability.date,
      offeredCachetARS: Number(offeredCachet),
      note:
        note.trim() ||
        `¡Hola! Vimos que tienen libre el ${formatDateBA(availability.date)}. Nos gustaría que toquen en ${currentVenue.name}. Les ofrecemos ${formatARS(Number(offeredCachet))} en mano al finalizar el show + cena completa. ¿Les sirve?`,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-display">
                Hacer Oferta Directa
              </h3>
              <p className="text-xs text-slate-400">
                A {availability.musicianName} • Fecha: {formatDateBA(availability.date)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar modal de oferta directa"
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5 flex-1 text-slate-200">
          {/* Target Musician preview */}
          <div className="flex items-center space-x-3 p-3 bg-slate-950/70 rounded-xl border border-slate-800">
            <img
              src={availability.musicianAvatar}
              alt={availability.musicianName}
              className="w-12 h-12 rounded-full object-cover border border-purple-500/40"
            />
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-bold text-slate-100 text-sm truncate">
                {availability.musicianName}
              </div>
              <div className="text-slate-400">{availability.musicianFormat}</div>
              <div className="text-emerald-400 font-medium">
                Caché pretendido por el artista: {formatARS(availability.expectedCachetARS)}
              </div>
            </div>
          </div>

          {/* Sending Venue */}
          <div className="text-xs text-slate-400 flex items-center space-x-2">
            <span>Enviando como:</span>
            <span className="font-bold text-slate-200">
              {currentVenue.name} ({currentVenue.neighborhood})
            </span>
          </div>

          {/* Offered Cachet */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Caché que le ofrecés al artista (ARS)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
              <input
                type="number"
                min={20000}
                step={5000}
                value={offeredCachet}
                onChange={(e) => setOfferedCachet(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-emerald-400 font-bold focus:outline-none focus:border-purple-500"
                required
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Podés igualar o mejorar el caché pretendido por la banda.
            </p>
          </div>

          {/* Message / Conditions */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Mensaje y propuesta
            </label>
            <textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contales sobre el horario de prueba de sonido, qué backline tenés armado, si incluye cena/bebida y detalles del público..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-purple-500/20 transition-all flex items-center justify-center space-x-2"
            >
              <Send className="w-4 h-4" />
              <span>Enviar Propuesta Directa de Fecha</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
