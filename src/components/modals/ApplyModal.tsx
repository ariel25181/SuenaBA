import React, { useState } from 'react';
import { X, Send, Music2, CheckCircle, DollarSign, Disc3 } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { VenueOpenCall } from '../../types/index.ts';
import { formatARS, formatDateBA } from '../../utils/bookingLogic.ts';

interface ApplyModalProps {
  isOpen: boolean;
  onClose: () => void;
  openCall: VenueOpenCall | null;
}

export const ApplyModal: React.FC<ApplyModalProps> = ({ isOpen, onClose, openCall }) => {
  const { currentMusician, applyToOpenCall } = useApp();

  const [proposedCachet, setProposedCachet] = useState<number>(
    openCall?.cachetAmountARS || currentMusician?.minCachetDefault || 120000
  );
  const [note, setNote] = useState<string>('');
  const [demoTrack, setDemoTrack] = useState<string>(
    currentMusician?.spotifyDemoTitle || 'Demo en Vivo (Set 2026)'
  );

  if (!isOpen || !openCall || !currentMusician) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    applyToOpenCall(openCall.id, {
      musicianId: currentMusician.id,
      musicianName: currentMusician.stageName,
      musicianAvatar: currentMusician.avatarUrl,
      genres: currentMusician.genres,
      format: currentMusician.format,
      proposedCachetARS: Number(proposedCachet),
      note:
        note.trim() ||
        `¡Hola! Nos encanta la propuesta de ${openCall.venueName}. Tenemos el repertorio listo y podemos adaptarnos a los horarios indicados.`,
      demoTrackTitle: demoTrack,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-emerald-950/30 via-slate-900 to-slate-900">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
              <Music2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-display">
                Postularse a la Fecha
              </h3>
              <p className="text-xs text-slate-400">
                {openCall.venueName} • {formatDateBA(openCall.date)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar modal de postulación"
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5 flex-1 text-slate-200">
          {/* Summary Box */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2.5 text-xs">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-0.5">
              <span className="text-slate-400">Lugar & Barrio:</span>
              <span className="font-semibold text-slate-200">
                {openCall.venueName} ({openCall.venueNeighborhood})
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-0.5">
              <span className="text-slate-400">Horarios:</span>
              <span className="text-amber-400 font-medium">
                Prueba {openCall.soundcheckTime} hs • Show {openCall.showTime}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-0.5">
              <span className="text-slate-400">Caché Ofrecido por Bar:</span>
              <span className="font-bold text-emerald-400">
                {formatARS(openCall.cachetAmountARS)}{' '}
                <span className="text-[11px] font-normal text-slate-400">
                  ({openCall.cachetType === 'fijo_mas_consumo' ? 'Fijo + Cena/Consumo' : 'Caché Fijo'})
                </span>
              </span>
            </div>
          </div>

          {/* Current Musician Info */}
          <div className="flex items-center space-x-3 p-3 bg-slate-800/40 rounded-xl border border-slate-800">
            <img
              src={currentMusician.avatarUrl}
              alt={currentMusician.stageName}
              className="w-12 h-12 rounded-full object-cover border border-amber-500/40"
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-400">Postulando como:</div>
              <div className="font-bold text-slate-100 truncate">{currentMusician.stageName}</div>
              <div className="text-xs text-amber-400">
                ⭐ {currentMusician.rating.toFixed(1)} ({currentMusician.reviewCount} shows) • {currentMusician.format}
              </div>
            </div>
          </div>

          {/* Proposed Cachet */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Caché pretendido por el show (ARS)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                min={20000}
                step={5000}
                value={proposedCachet}
                onChange={(e) => setProposedCachet(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Podés mantener el ofrecido ({formatARS(openCall.cachetAmountARS)}) o proponer un ajuste razonable.
            </p>
          </div>

          {/* Demo track / Sample */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Muestra o Tema de Referencia
            </label>
            <div className="relative">
              <Disc3 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={demoTrack}
                onChange={(e) => setDemoTrack(e.target.value)}
                placeholder="Nombre del tema, link a Spotify o YouTube"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Proposal Note */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Mensaje al programador del bar
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contales sobre tu formato, cuántos temas tocan, si llevan instrumentos propios o si tienen público en la zona..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center space-x-2"
            >
              <Send className="w-4 h-4" />
              <span>Enviar Postulación a {openCall.venueName}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
