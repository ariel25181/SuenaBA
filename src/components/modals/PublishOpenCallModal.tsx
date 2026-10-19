import React, { useState } from 'react';
import { X, Calendar, Clock, DollarSign, Speaker, Music, Plus, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { MusicGenre } from '../../types/index.ts';

interface PublishOpenCallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ALL_GENRES: MusicGenre[] = [
  'Jazz',
  'Rock',
  'Acústico',
  'Tango & Fusión',
  'Indie',
  'Bossa & MPB',
  'Blues & Soul',
  'Folklore',
  'Funk & Groove',
  'Pop',
];

const COMMON_BACKLINE = [
  'Batería acústica armada',
  'Piano / Teclado 88 teclas',
  'Amplificador de guitarra valvular',
  'Amplificador de bajo',
  'Consola digital con sonidista en sala',
  '3+ Micrófonos Shure SM58',
  'Monitores de piso x2',
  'Luces escénicas cálidas',
];

export const PublishOpenCallModal: React.FC<PublishOpenCallModalProps> = ({ isOpen, onClose }) => {
  const { currentVenue, publishOpenCall } = useApp();

  const [date, setDate] = useState<string>('2026-10-31');
  const [soundcheckTime, setSoundcheckTime] = useState<string>('19:00');
  const [showTime, setShowTime] = useState<string>('21:30 a 23:00 (2 sets)');
  const [cachetAmount, setCachetAmount] = useState<number>(120000);
  const [cachetType, setCachetType] = useState<'fijo' | 'fijo_mas_consumo' | 'taquilla' | 'a_convenir'>('fijo_mas_consumo');
  const [cachetDetails, setCachetDetails] = useState<string>('En efectivo al finalizar + cena de cortesía');
  const [selectedGenres, setSelectedGenres] = useState<MusicGenre[]>(['Jazz', 'Bossa & MPB']);
  const [selectedBackline, setSelectedBackline] = useState<string[]>([
    'Batería acústica armada',
    'Consola digital con sonidista en sala',
    '3+ Micrófonos Shure SM58',
  ]);
  const [specialNotes, setSpecialNotes] = useState<string>('');

  if (!isOpen || !currentVenue) return null;

  const toggleGenre = (genre: MusicGenre) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  const toggleBackline = (item: string) => {
    setSelectedBackline((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    publishOpenCall({
      venueId: currentVenue.id,
      venueName: currentVenue.name,
      venueNeighborhood: currentVenue.neighborhood,
      venueAvatar: currentVenue.photos[0] || '',
      date,
      soundcheckTime,
      showTime,
      targetGenres: selectedGenres.length > 0 ? selectedGenres : ['Acústico'],
      targetFormats: ['Dúo', 'Trío', 'Cuarteto'],
      cachetType,
      cachetAmountARS: Number(cachetAmount),
      cachetDetails: cachetDetails || 'Caché en mano al finalizar el show.',
      providedBackline: selectedBackline,
      specialNotes:
        specialNotes.trim() ||
        `Buscamos músicos para fecha en vivo en ${currentVenue.name}. Buen trato, comida rica y respeto a los artistas.`,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-display">
                Publicar Convocatoria para Músicos
              </h3>
              <p className="text-xs text-slate-400">
                {currentVenue.name} ({currentVenue.neighborhood})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar modal de convocatoria"
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-5 flex-1 text-slate-200">
          {/* Date & Soundcheck */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
                Fecha del Show
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
                Horario de Prueba de Sonido
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={soundcheckTime}
                  onChange={(e) => setSoundcheckTime(e.target.value)}
                  placeholder="ej. 19:00 hs"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-10 pr-3 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Show Schedule */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Horario del Show en Vivo
            </label>
            <input
              type="text"
              value={showTime}
              onChange={(e) => setShowTime(e.target.value)}
              placeholder="ej. 21:30 a 23:00 (2 sets)"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          {/* Cachet Offer */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-3">
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-300">
              Remuneración / Caché Ofrecido a los Músicos
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setCachetType('fijo_mas_consumo')}
                className={`py-2 px-3 rounded-lg border text-left font-medium transition-colors ${
                  cachetType === 'fijo_mas_consumo'
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                💵 Fijo + Cena/Consumo
              </button>
              <button
                type="button"
                onClick={() => setCachetType('fijo')}
                className={`py-2 px-3 rounded-lg border text-left font-medium transition-colors ${
                  cachetType === 'fijo'
                    ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                    : 'border-slate-800 bg-slate-900 text-slate-400'
                }`}
              >
                💵 Fijo exclusivamente
              </button>
            </div>

            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
              <input
                type="number"
                min={10000}
                step={5000}
                value={cachetAmount}
                onChange={(e) => setCachetAmount(Number(e.target.value))}
                placeholder="Monto en ARS"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 pr-3 text-sm text-emerald-400 font-bold focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <input
              type="text"
              value={cachetDetails}
              onChange={(e) => setCachetDetails(e.target.value)}
              placeholder="Detalle: cena incluida, 2 pintas por persona, pago en mano al finalizar..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Genres Sought */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Géneros musicales buscados
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_GENRES.map((genre) => {
                const isSelected = selectedGenres.includes(genre);
                return (
                  <button
                    type="button"
                    key={genre}
                    onClick={() => toggleGenre(genre)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center space-x-1 ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-300'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3 text-amber-400" />}
                    <span>{genre}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Backline / Equipment */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Equipamiento técnico que provee el local
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {COMMON_BACKLINE.map((item) => {
                const isSelected = selectedBackline.includes(item);
                return (
                  <button
                    type="button"
                    key={item}
                    onClick={() => toggleBackline(item)}
                    className={`p-2 rounded-lg border text-left flex items-center space-x-2 transition-colors ${
                      isSelected
                        ? 'bg-slate-800 text-slate-100 border-amber-500/40'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-amber-500 text-slate-950 font-bold' : 'border border-slate-700'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3" />}
                    </div>
                    <span className="truncate">{item}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Special Notes */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Descripción o requisitos especiales
            </label>
            <textarea
              rows={2}
              value={specialNotes}
              onChange={(e) => setSpecialNotes(e.target.value)}
              placeholder="Describí la onda del lugar, tipo de público (familiar, parejas, melómano), volumen permitido, etc."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Submit */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Publicar Convocatoria en SuenaBA</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
