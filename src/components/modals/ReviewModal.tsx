import React, { useState } from 'react';
import { Star, CheckCircle, MessageSquare, ShieldCheck, X } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';
import { Review } from '../../types/index.ts';
import { formatDateBA } from '../../utils/bookingLogic.ts';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'musician' | 'venue';
  targetId: string;
  targetName: string;
  showDate: string;
  showVenueName: string;
  showIdToComplete?: string;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetName,
  showDate,
  showVenueName,
  showIdToComplete,
}) => {
  const { currentMusician, currentVenue, submitReview } = useApp();

  const [overallRating, setOverallRating] = useState<number>(5);
  const [comment, setComment] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Criteria for Venue (reviewed by Musician)
  const [soundQuality, setSoundQuality] = useState<number>(5);
  const [paymentReliability, setPaymentReliability] = useState<number>(5);
  const [hospitality, setHospitality] = useState<number>(5);
  const [respect, setRespect] = useState<number>(5);

  // Criteria for Musician (reviewed by Venue)
  const [punctuality, setPunctuality] = useState<number>(5);
  const [liveSound, setLiveSound] = useState<number>(5);
  const [crowdDrawing, setCrowdDrawing] = useState<number>(5);
  const [professionalism, setProfessionalism] = useState<number>(5);

  if (!isOpen) return null;

  const availableTags =
    targetType === 'venue'
      ? [
          'Sonido impecable',
          'Pago en mano al toque',
          'Cena riquísima',
          'Camarín cómodo',
          'Sonidista dedicado',
          'Público atento',
          'Trato súper respetuoso',
        ]
      : [
          'Puntualidad británica',
          'Sonido sublime',
          'Llenaron la sala',
          'Cuidaron los equipos',
          'Repertorio de primera',
          'Muy buena onda',
          'Volveríamos a convocarlos',
        ];

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const authorType = targetType === 'venue' ? 'musician' : 'venue';
    const authorId = authorType === 'musician' ? currentMusician?.id || 'mus-1' : currentVenue?.id || 'venue-1';
    const authorName = authorType === 'musician' ? currentMusician?.stageName || 'Músico' : currentVenue?.name || 'Bar';
    const authorAvatar =
      authorType === 'musician'
        ? currentMusician?.avatarUrl || ''
        : currentVenue?.photos[0] || '';

    const criteriaBreakdown: Record<string, number> =
      targetType === 'venue'
        ? {
            soundQuality,
            paymentReliability,
            hospitality,
            respect,
          }
        : {
            punctuality,
            liveSound,
            crowdDrawing,
            professionalism,
          };

    submitReview(
      {
        targetType,
        targetId,
        authorType,
        authorId,
        authorName,
        authorAvatar,
        showDate,
        showVenueName,
        rating: overallRating,
        criteriaBreakdown,
        comment:
          comment.trim() ||
          (targetType === 'venue'
            ? 'Excelente experiencia tocando en este lugar. Muy profesionales.'
            : 'Gran presentación musical, con buena convocatoria y respeto a los horarios.'),
        tags: selectedTags.length > 0 ? selectedTags : ['Recomendado'],
      },
      showIdToComplete
    );

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-900">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <Star className="w-5 h-5 fill-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 font-display">
                Calificar a {targetName}
              </h3>
              <p className="text-xs text-slate-400">
                Feedback bilateral estilo Airbnb • Fecha: {formatDateBA(showDate)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar modal de reseña"
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {/* Reputation badge note */}
          <div className="bg-amber-950/20 border border-amber-900/40 rounded-xl p-3.5 flex items-start space-x-3 text-xs text-amber-200/90 leading-relaxed">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <p>
              Tu calificación impacta directamente en la reputación pública de <strong>{targetName}</strong> en el ecosistema musical de Buenos Aires.
            </p>
          </div>

          {/* Overall Rating */}
          <div className="text-center py-2 bg-slate-950/60 rounded-xl border border-slate-800/80 p-4">
            <label className="block text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">
              Calificación General
            </label>
            <div className="flex items-center justify-center space-x-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  onClick={() => setOverallRating(star)}
                  aria-label={`Calificar con ${star} estrellas`}
                  className="p-1 focus:outline-none transition-transform hover:scale-125"
                >
                  <Star
                    className={`w-8 h-8 transition-colors ${
                      star <= overallRating
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-slate-700 hover:text-slate-500'
                    }`}
                  />
                </button>
              ))}
            </div>
            <span className="text-sm font-bold text-amber-400 mt-1 block">
              {overallRating === 5
                ? '⭐ 5.0 - Experiencia Excelente'
                : overallRating === 4
                ? '⭐ 4.0 - Muy buena experiencia'
                : overallRating === 3
                ? '⭐ 3.0 - Aceptable / Regular'
                : '⭐ Regular o con puntos a mejorar'}
            </span>
          </div>

          {/* Breakdown Criteria */}
          <div className="space-y-4">
            <h4 className="text-xs uppercase font-semibold tracking-wider text-slate-400">
              Desglose detallado de criterios (1 a 5)
            </h4>

            {targetType === 'venue' ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>Calidad de Sonido & Acústica</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setSoundQuality(val)}
                        aria-label={`Sonido: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= soundQuality
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Puntualidad en el Pago del Caché</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setPaymentReliability(val)}
                        aria-label={`Pago: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= paymentReliability
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Hospitalidad, Comida & Camarín</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setHospitality(val)}
                        aria-label={`Hospitalidad: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= hospitality
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Trato y Respeto a los Artistas</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setRespect(val)}
                        aria-label={`Trato: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= respect
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span>Puntualidad (Prueba y Show)</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setPunctuality(val)}
                        aria-label={`Puntualidad: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= punctuality
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Nivel de Sonido en Vivo</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setLiveSound(val)}
                        aria-label={`Sonido: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= liveSound
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Convocatoria de Público & Consumo</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setCrowdDrawing(val)}
                        aria-label={`Convocatoria: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= crowdDrawing
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span>Profesionalismo & Cuidado de Equipos</span>
                  <div className="flex items-center space-x-1">
                    {[1, 2, 3, 4, 5].map((val) => (
                      <button
                        type="button"
                        key={val}
                        onClick={() => setProfessionalism(val)}
                        aria-label={`Profesionalismo: ${val} puntos`}
                        className={`w-7 h-7 text-xs rounded font-bold transition-colors ${
                          val <= professionalism
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Highlights / Badges */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Destacados rápidos (Etiquetas de reputación)
            </label>
            <div className="flex flex-wrap gap-2">
              {availableTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center space-x-1 ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    {isSelected && <CheckCircle className="w-3 h-3 text-amber-400" />}
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className="block text-xs uppercase font-semibold tracking-wider text-slate-400 mb-2">
              Comentario público sincero
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={`Contá cómo fue la experiencia con ${targetName}: cumplimiento de acuerdos, sonido, comida, onda del lugar...`}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-2">
            <button
              type="submit"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
            >
              <Star className="w-4 h-4 fill-slate-950" />
              <span>Publicar Calificación & Reseña</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
