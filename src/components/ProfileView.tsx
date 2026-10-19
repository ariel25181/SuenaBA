import React, { useState } from 'react';
import {
  Star,
  MapPin,
  Music,
  Wine,
  ShieldCheck,
  CheckCircle,
  Speaker,
  UtensilsCrossed,
  DollarSign,
  RotateCcw,
  Users,
  Instagram,
  Disc3,
  Calendar,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { formatARS } from '../utils/bookingLogic.ts';

interface ProfileViewProps {
  viewingTarget?: { type: 'musician' | 'venue'; id: string } | null;
  onClearTarget?: () => void;
  onOpenReviewModal?: (params: any) => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  viewingTarget,
  onClearTarget,
  onOpenReviewModal,
}) => {
  const {
    role,
    setRole,
    venues,
    musicians,
    currentMusician,
    currentVenue,
    setActiveMusicianId,
    setActiveVenueId,
    resetAllData,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'reviews' | 'backline' | 'switch_demo'>('reviews');

  // Determine which profile to display
  let isVenue = false;
  let venueProfile = currentVenue;
  let musicianProfile = currentMusician;

  if (viewingTarget) {
    if (viewingTarget.type === 'venue') {
      isVenue = true;
      venueProfile = venues.find((v) => v.id === viewingTarget.id) || currentVenue;
    } else {
      isVenue = false;
      musicianProfile = musicians.find((m) => m.id === viewingTarget.id) || currentMusician;
    }
  } else {
    isVenue = role === 'bar';
  }

  return (
    <div className="space-y-5 pb-24">
      {/* If viewing external profile, show back button */}
      {viewingTarget && onClearTarget && (
        <button
          onClick={onClearTarget}
          className="text-xs text-amber-400 hover:text-amber-300 flex items-center space-x-1 font-semibold"
        >
          <span>← Volver a mi perfil ({isVenue ? 'Bar' : 'Músico'})</span>
        </button>
      )}

      {/* Main Profile Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        {/* Cover Photo */}
        <div className="relative h-44 sm:h-52 w-full bg-slate-950">
          <img
            src={
              isVenue
                ? venueProfile?.coverPhoto || ''
                : musicianProfile?.photos[0] || musicianProfile?.avatarUrl || ''
            }
            alt={isVenue ? venueProfile?.name : musicianProfile?.stageName}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />

          {/* Type Tag */}
          <div className="absolute top-4 left-4">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-950/80 text-amber-400 border border-amber-500/30 backdrop-blur-md">
              {isVenue ? `🍸 ${venueProfile?.type}` : `🎸 ${musicianProfile?.format}`}
            </span>
          </div>

          {/* Verified Badge */}
          <div className="absolute top-4 right-4 flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 backdrop-blur-md">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Perfil Verificado</span>
          </div>
        </div>

        {/* Profile Info & Bio */}
        <div className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-100 font-display">
                {isVenue ? venueProfile?.name : musicianProfile?.stageName}
              </h1>
              <div className="flex items-center space-x-2 text-xs text-slate-400 mt-1">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  {isVenue
                    ? `${venueProfile?.address}, ${venueProfile?.neighborhood}`
                    : `Buenos Aires (${musicianProfile?.genres.join(', ')})`}
                </span>
              </div>
            </div>

            {/* Overall Rating Score Card */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 flex items-center space-x-3 shrink-0">
              <div className="text-3xl font-black text-amber-400 font-display">
                {isVenue
                  ? venueProfile?.rating.toFixed(2)
                  : musicianProfile?.rating.toFixed(2)}
              </div>
              <div className="text-xs">
                <div className="flex items-center text-amber-400 font-bold">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} className="w-3.5 h-3.5 fill-amber-400" />
                  ))}
                </div>
                <div className="text-slate-400 mt-0.5">
                  {isVenue ? venueProfile?.reviewCount : musicianProfile?.reviewCount} reseñas de la contraparte
                </div>
              </div>
            </div>
          </div>

          {/* Bio */}
          <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-3.5 rounded-xl border border-slate-800">
            {isVenue ? venueProfile?.bio : musicianProfile?.bio}
          </p>

          {/* Social and quick meta */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 pt-1">
            {!isVenue && musicianProfile?.instagramHandle && (
              <span className="flex items-center space-x-1 text-slate-300">
                <Instagram className="w-3.5 h-3.5 text-pink-400" />
                <span>{musicianProfile.instagramHandle}</span>
              </span>
            )}
            {!isVenue && musicianProfile?.spotifyDemoTitle && (
              <span className="flex items-center space-x-1 text-slate-300">
                <Disc3 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Demo: {musicianProfile.spotifyDemoTitle}</span>
              </span>
            )}
            {isVenue && venueProfile?.capacity && (
              <span className="flex items-center space-x-1 text-slate-300">
                <Users className="w-3.5 h-3.5 text-amber-400" />
                <span>Capacidad: {venueProfile.capacity} personas</span>
              </span>
            )}
            {!isVenue && musicianProfile?.minCachetDefault && (
              <span className="flex items-center space-x-1 text-slate-300">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span>Caché base: {formatARS(musicianProfile.minCachetDefault)}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs: Reseñas / Backline / Cambiar de Demo */}
      <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-800 text-xs">
        <button
          onClick={() => setActiveTab('reviews')}
          className={`flex-1 py-2 px-3 rounded-xl font-bold transition-all ${
            activeTab === 'reviews'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Reputación & Reseñas ({isVenue ? venueProfile?.reviews.length : musicianProfile?.reviews.length})
        </button>

        <button
          onClick={() => setActiveTab('backline')}
          className={`flex-1 py-2 px-3 rounded-xl font-bold transition-all ${
            activeTab === 'backline'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {isVenue ? 'Equipamiento & Sala' : 'Rider Técnico'}
        </button>

        <button
          onClick={() => setActiveTab('switch_demo')}
          className={`py-2 px-3 rounded-xl font-bold transition-all ${
            activeTab === 'switch_demo'
              ? 'bg-amber-500 text-slate-950 shadow-md'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Probar Otros Perfiles
        </button>
      </div>

      {/* Tab Content: Reseñas & Reputación Airbnb */}
      {activeTab === 'reviews' && (
        <div className="space-y-5">
          {/* Detailed Criteria Progress Bars (Airbnb Style) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-xs uppercase font-semibold tracking-wider text-slate-400">
              Evaluación detallada de la contraparte (Estilo Airbnb)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {isVenue ? (
                <>
                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Calidad de Sonido & Acústica</span>
                      <span className="font-bold text-amber-400">
                        {venueProfile?.ratingBreakdown.soundQuality.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((venueProfile?.ratingBreakdown.soundQuality || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Puntualidad en el Pago</span>
                      <span className="font-bold text-amber-400">
                        {venueProfile?.ratingBreakdown.paymentReliability.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((venueProfile?.ratingBreakdown.paymentReliability || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Hospitalidad & Comida</span>
                      <span className="font-bold text-amber-400">
                        {venueProfile?.ratingBreakdown.hospitality.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((venueProfile?.ratingBreakdown.hospitality || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Trato & Respeto al Artista</span>
                      <span className="font-bold text-amber-400">
                        {venueProfile?.ratingBreakdown.respect.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((venueProfile?.ratingBreakdown.respect || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Puntualidad (Prueba y Show)</span>
                      <span className="font-bold text-amber-400">
                        {musicianProfile?.ratingBreakdown.punctuality.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((musicianProfile?.ratingBreakdown.punctuality || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Calidad de Sonido en Vivo</span>
                      <span className="font-bold text-amber-400">
                        {musicianProfile?.ratingBreakdown.liveSound.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((musicianProfile?.ratingBreakdown.liveSound || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Convocatoria de Público</span>
                      <span className="font-bold text-amber-400">
                        {musicianProfile?.ratingBreakdown.crowdDrawing.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((musicianProfile?.ratingBreakdown.crowdDrawing || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Profesionalismo & Cuidado</span>
                      <span className="font-bold text-amber-400">
                        {musicianProfile?.ratingBreakdown.professionalism.toFixed(1)} / 5.0
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{
                          width: `${((musicianProfile?.ratingBreakdown.professionalism || 5) / 5) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* List of Reviews written by Counterpart */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-100 font-display">
              Reseñas Públicas de la Escena ({isVenue ? venueProfile?.reviews.length : musicianProfile?.reviews.length})
            </h3>

            {((isVenue ? venueProfile?.reviews : musicianProfile?.reviews) || []).length === 0 ? (
              <div className="text-center py-8 bg-slate-900/40 rounded-2xl border border-slate-800 p-4 text-xs text-slate-400">
                Aún no tiene reseñas registradas. Al finalizar una fecha acordada, la contraparte dejará su calificación.
              </div>
            ) : (
              ((isVenue ? venueProfile?.reviews : musicianProfile?.reviews) || []).map((rev) => (
                <div
                  key={rev.id}
                  className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center space-x-2.5">
                      <img
                        src={rev.authorAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80'}
                        alt={rev.authorName}
                        className="w-10 h-10 rounded-full object-cover border border-amber-500/30"
                      />
                      <div>
                        <div className="font-bold text-slate-100">{rev.authorName}</div>
                        <div className="text-[11px] text-slate-400">
                          {rev.authorType === 'venue' ? 'Dueño / Programador de Bar' : 'Músico que tocó en vivo'} • {rev.showDate}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1 text-amber-400 font-bold">
                      <Star className="w-3.5 h-3.5 fill-amber-400" />
                      <span>{rev.rating.toFixed(1)}</span>
                    </div>
                  </div>

                  <p className="text-slate-300 leading-relaxed italic bg-slate-950/50 p-3 rounded-xl border border-slate-800/80">
                    "{rev.comment}"
                  </p>

                  {/* Tags */}
                  {rev.tags && rev.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {rev.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30"
                        >
                          ✓ {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Backline / Technical */}
      {activeTab === 'backline' && (
        <div className="space-y-4">
          {isVenue ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 text-xs">
              <h3 className="font-bold text-slate-100 text-sm font-display flex items-center space-x-2">
                <Speaker className="w-4 h-4 text-amber-400" />
                <span>Equipamiento y Condiciones de Sala</span>
              </h3>

              <div className="space-y-2">
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                  Backline Provisto por el Bar:
                </span>
                <ul className="space-y-1.5 text-slate-300">
                  {venueProfile?.backline.map((item, idx) => (
                    <li key={idx} className="flex items-center space-x-2">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                  Condiciones Acústicas:
                </span>
                <p className="text-slate-300 mt-1">{venueProfile?.acousticCharacteristics}</p>
              </div>

              <div className="pt-3 border-t border-slate-800">
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                  Hospitalidad para Músicos:
                </span>
                <p className="text-slate-300 mt-1">{venueProfile?.hospitality}</p>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 text-xs">
              <h3 className="font-bold text-slate-100 text-sm font-display flex items-center space-x-2">
                <Music className="w-4 h-4 text-amber-400" />
                <span>Rider Técnico y Requerimientos de la Banda</span>
              </h3>

              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                  Rider para prueba de sonido:
                </span>
                <p className="text-slate-300 mt-1 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  {musicianProfile?.technicalRider}
                </p>
              </div>

              <div className="pt-2">
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                  Integrantes:
                </span>
                <p className="text-slate-300 mt-1 font-bold">
                  {musicianProfile?.membersCount} músicos en escenario ({musicianProfile?.format})
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Switch Demo Profile (Super easy for evaluation!) */}
      {activeTab === 'switch_demo' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5 text-xs">
          <div>
            <h3 className="font-bold text-slate-100 text-sm font-display mb-1">
              Cambiar de Identidad Demo
            </h3>
            <p className="text-slate-400">
              Elegí con qué músico o bar querés operar la app para probar la postulación cruzada y las calificaciones bilaterales:
            </p>
          </div>

          {/* Venues Selector */}
          <div className="space-y-2">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">
              Bares & Restaurantes Porteños
            </span>
            <div className="grid grid-cols-1 gap-2">
              {venues.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setActiveVenueId(v.id);
                    setRole('bar');
                    setActiveTab('reviews');
                  }}
                  className={`p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
                    currentVenue?.id === v.id && role === 'bar'
                      ? 'bg-amber-500/20 border-amber-500/80 text-amber-300'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <img
                      src={v.photos[0]}
                      alt={v.name}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <div>
                      <div className="font-bold text-slate-100">{v.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {v.neighborhood} • {v.type}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-amber-400">⭐ {v.rating.toFixed(2)}</span>
                    <span className="block text-[10px] text-slate-500">{v.reviewCount} reseñas</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Musicians Selector */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">
              Músicos & Bandas
            </span>
            <div className="grid grid-cols-1 gap-2">
              {musicians.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setActiveMusicianId(m.id);
                    setRole('musico');
                    setActiveTab('reviews');
                  }}
                  className={`p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
                    currentMusician?.id === m.id && role === 'musico'
                      ? 'bg-amber-500/20 border-amber-500/80 text-amber-300'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <img
                      src={m.avatarUrl}
                      alt={m.stageName}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                    <div>
                      <div className="font-bold text-slate-100">{m.stageName}</div>
                      <div className="text-[11px] text-slate-400">
                        {m.format} • {m.genres.join(', ')}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-amber-400">⭐ {m.rating.toFixed(2)}</span>
                    <span className="block text-[10px] text-slate-500">{m.reviewCount} reseñas</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Reset button */}
          <div className="pt-3 border-t border-slate-800 text-center">
            <button
              onClick={resetAllData}
              className="text-xs text-rose-400 hover:text-rose-300 font-semibold flex items-center justify-center space-x-1.5 mx-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restablecer Datos Iniciales de Buenos Aires</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
