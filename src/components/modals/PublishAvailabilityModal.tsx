import React, { useState } from 'react';
import { X, Calendar, MapPin, DollarSign, Clock, Plus, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { NeighborhoodBA } from '../../types/index.ts';

interface PublishAvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMMON_NEIGHBORHOODS: NeighborhoodBA[] = [
  'Palermo Soho',
  'Palermo Hollywood',
  'San Telmo',
  'Colegiales',
  'Villa Crespo',
  'Almagro',
  'Recoleta',
  'Chacarita',
  'Belgrano',
  'San Nicolás (Centro)',
];

export const PublishAvailabilityModal: React.FC<PublishAvailabilityModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { currentMusician, publishAvailability } = useApp();

  const [date, setDate] = useState<string>('2026-10-31');
  const [timeSlot, setTimeSlot] = useState<'tarde' | 'noche' | 'trasnoche' | 'todo_el_dia'>('noche');
  const [expectedCachet, setExpectedCachet] = useState<number>(
    currentMusician?.minCachetDefault || 100000
  );
  const [selectedHoods, setSelectedHoods] = useState<NeighborhoodBA[]>([
    'Palermo Soho',
    'San Telmo',
    'Colegiales',
  ]);
  const [message, setMessage] = useState<string>('');

  if (!isOpen || !currentMusician) return null;

  const toggleHood = (hood: NeighborhoodBA) => {
    setSelectedHoods((prev) =>
      prev.includes(hood) ? prev.filter((h) => h !== hood) : [...prev, hood]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    publishAvailability({
      musicianId: currentMusician.id,
      musicianName: currentMusician.stageName,
      musicianAvatar: currentMusician.avatarUrl,
      musicianFormat: currentMusician.format,
      musicianGenres: currentMusician.genres,
      date,
      timeSlot,
      preferredNeighborhoods: selectedHoods.length > 0 ? selectedHoods : ['Palermo Soho'],
      expectedCachetARS: Number(expectedCachet),
      message:
        message.trim() ||
        `Tenemos libre esta fecha para tocar en formato ${currentMusician.format}. Repertorio completo de ${currentMusician.genres.join(', ')}. ¡Contáctennos para coordinar!`,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 via-slate-900 to-slate-900">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-display">
                Publicar Fecha Disponible
              </h3>
              <p className="text-xs text-slate-400">
                {currentMusician.stageName} • Para que te contacten bares
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar modal de fecha disponible"
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5 flex-1 text-slate-200">
          {/* Date & Time Slot */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
                Día que tenés libre
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
                Franja horaria preferida
              </label>
              <select
                value={timeSlot}
                onChange={(e) => setTimeSlot(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                <option value="tarde">Tarde / Atardecer (17:00 a 20:30)</option>
                <option value="noche">Noche (21:00 a 00:00)</option>
                <option value="trasnoche">Trasnoche (00:00 en adelante)</option>
                <option value="todo_el_dia">Disponible todo el día</option>
              </select>
            </div>
          </div>

          {/* Expected Cachet */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Caché estimado que pretendés (ARS)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
              <input
                type="number"
                min={20000}
                step={5000}
                value={expectedCachet}
                onChange={(e) => setExpectedCachet(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-emerald-400 font-bold focus:outline-none focus:border-cyan-500"
                required
              />
            </div>
          </div>

          {/* Preferred Neighborhoods */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Barrios de Buenos Aires donde podés tocar
            </label>
            <div className="flex flex-wrap gap-2">
              {COMMON_NEIGHBORHOODS.map((hood) => {
                const isSelected = selectedHoods.includes(hood);
                return (
                  <button
                    type="button"
                    key={hood}
                    onClick={() => toggleHood(hood)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center space-x-1 ${
                      isSelected
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-300'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-cyan-400" />}
                    <span>{hood}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pitch Message */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Mensaje o propuesta para los bares
            </label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ej: 'Tenemos libre este viernes. Llevamos show de jazz vocal íntimo ideal para cenas o vermut...'"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Publicar Fecha Libre en el Tablón</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
