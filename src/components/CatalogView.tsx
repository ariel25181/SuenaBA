import React, { useState } from 'react';
import {
  Search,
  MapPin,
  Calendar,
  Clock,
  Star,
  Ticket,
  Filter,
  Sparkles,
  ChevronRight,
  UtensilsCrossed,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';
import { LiveShowConfirmed, NeighborhoodBA, MusicGenre } from '../types/index.ts';
import { formatARS, formatDateBA, filterCatalogShows } from '../utils/bookingLogic.ts';

interface CatalogViewProps {
  onSelectShow: (show: LiveShowConfirmed) => void;
  onViewVenue: (venueId: string) => void;
  onViewMusician: (musicianId: string) => void;
}

const NEIGHBORHOODS: string[] = [
  'Todos',
  'Palermo Hollywood',
  'Palermo Soho',
  'San Telmo',
  'Colegiales',
  'Recoleta',
  'Villa Crespo',
  'Almagro',
  'Chacarita',
];

const GENRES: string[] = [
  'Todos',
  'Jazz',
  'Rock',
  'Acústico',
  'Tango & Fusión',
  'Indie',
  'Bossa & MPB',
  'Blues & Soul',
  'Folklore',
];

export const CatalogView: React.FC<CatalogViewProps> = ({
  onSelectShow,
  onViewVenue,
  onViewMusician,
}) => {
  const { liveShows, venues, musicians } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNeighborhood, setSelectedNeighborhood] = useState('Todos');
  const [selectedGenre, setSelectedGenre] = useState('Todos');
  const [activeDateTab, setActiveDateTab] = useState<'all' | 'today' | 'weekend'>('all');

  const filteredShows = filterCatalogShows(liveShows, {
    query: searchQuery,
    neighborhood: selectedNeighborhood,
    genre: selectedGenre,
    filterPeriod: activeDateTab === 'today' ? 'today' : 'all',
  });

  return (
    <div className="space-y-5 pb-24">
      {/* Hero Banner with Buenos Aires Nightlife Mood */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-950 border border-slate-800 p-5 shadow-xl">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Sparkles className="w-3 h-3 mr-1" />
            Cartelera Porteña • Función 3
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100 font-display tracking-tight">
            Música en Vivo en Bares & Restaurantes de Buenos Aires
          </h1>
          <p className="text-xs text-slate-400 max-w-md leading-relaxed">
            Descubrí quién toca hoy, reservá mesa o entrada y conocé la reputación verificada tanto de los locales como de los artistas.
          </p>
        </div>

        {/* Ambient glow */}
        <div className="absolute -right-8 -bottom-8 w-44 h-44 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por bar, banda, barrio o estilo..."
          className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500 shadow-sm transition-colors"
        />
      </div>

      {/* Neighborhood Pills Slider */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center justify-between">
          <span>Barrios de CABA</span>
          <span className="text-amber-400">{selectedNeighborhood}</span>
        </div>
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {NEIGHBORHOODS.map((hood) => {
            const isSelected = selectedNeighborhood === hood;
            return (
              <button
                key={hood}
                onClick={() => setSelectedNeighborhood(hood)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                  isSelected
                    ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-md shadow-amber-500/20'
                    : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                {hood}
              </button>
            );
          })}
        </div>
      </div>

      {/* Genres Pills Slider */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center justify-between">
          <span>Géneros Musicales</span>
          <span className="text-amber-400">{selectedGenre}</span>
        </div>
        <div className="flex space-x-2 overflow-x-auto pb-1 scrollbar-none">
          {GENRES.map((genre) => {
            const isSelected = selectedGenre === genre;
            return (
              <button
                key={genre}
                onClick={() => setSelectedGenre(genre)}
                className={`px-3 py-1 rounded-xl text-xs font-medium whitespace-nowrap transition-all border ${
                  isSelected
                    ? 'bg-slate-800 text-amber-300 border-amber-500/60'
                    : 'bg-slate-900/50 text-slate-400 border-slate-800/80 hover:text-slate-300'
                }`}
              >
                {genre}
              </button>
            );
          })}
        </div>
      </div>

      {/* Shows List Header */}
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-base font-bold text-slate-100 font-display">
          Próximos Shows Confirmados ({filteredShows.length})
        </h2>
        <span className="text-xs text-slate-400">Buenos Aires</span>
      </div>

      {/* Show Cards Grid */}
      <div className="space-y-4">
        {filteredShows.length === 0 ? (
          <div className="text-center py-12 bg-slate-900/40 rounded-2xl border border-slate-800 p-6 space-y-2">
            <p className="text-slate-300 font-medium">No encontramos shows con esos filtros.</p>
            <p className="text-xs text-slate-500">
              Probá seleccionando "Todos" los barrios o géneros.
            </p>
            <button
              onClick={() => {
                setSelectedNeighborhood('Todos');
                setSelectedGenre('Todos');
                setSearchQuery('');
              }}
              className="mt-3 text-xs text-amber-400 underline font-semibold"
            >
              Restablecer filtros
            </button>
          </div>
        ) : (
          filteredShows.map((show) => {
            const venue = venues.find((v) => v.id === show.venueId);
            const musician = musicians.find((m) => m.id === show.musicianId);

            return (
              <div
                key={show.id}
                className="group bg-slate-900/90 border border-slate-800 hover:border-amber-500/40 rounded-2xl overflow-hidden shadow-md transition-all hover:shadow-xl hover:shadow-amber-500/5"
              >
                {/* Photo & Badges */}
                <div className="relative h-44 w-full bg-slate-950 overflow-hidden cursor-pointer" onClick={() => onSelectShow(show)}>
                  <img
                    src={show.venuePhoto}
                    alt={show.venueName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/30 to-transparent" />

                  {/* Date badge */}
                  <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-md border border-slate-700/60 rounded-xl px-2.5 py-1 text-center shadow-lg">
                    <div className="text-[10px] uppercase font-bold text-amber-400">
                      {formatDateBA(show.date).split(' ')[0]}
                    </div>
                    <div className="text-sm font-black text-slate-100">
                      {show.date.split('-')[2]}
                    </div>
                  </div>

                  {/* Ticket type badge */}
                  <div className="absolute top-3 right-3 bg-slate-950/85 backdrop-blur-md border border-slate-700/60 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                    {show.ticketType === 'entrada_libre'
                      ? 'Entrada Libre'
                      : show.ticketType === 'consumicion_minima'
                      ? `Consumición ${formatARS(show.ticketPriceARS)}`
                      : `Ticket ${formatARS(show.ticketPriceARS)}`}
                  </div>

                  {/* Venue and Neighborhood bottom label */}
                  <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-xs text-slate-300">
                    <span className="font-bold flex items-center text-white drop-shadow">
                      <MapPin className="w-3.5 h-3.5 text-amber-400 mr-1 shrink-0" />
                      {show.venueName} • {show.venueNeighborhood}
                    </span>
                    <span className="text-amber-300 font-semibold drop-shadow">{show.time}</span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-3">
                  {/* Musician presentation */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3
                        onClick={() => onSelectShow(show)}
                        className="text-lg font-bold text-slate-100 font-display group-hover:text-amber-400 transition-colors cursor-pointer"
                      >
                        {show.musicianName}
                      </h3>
                      <p className="text-xs text-slate-400 flex items-center space-x-1.5 mt-0.5">
                        <span>{show.musicianFormat}</span>
                        <span>•</span>
                        <span className="text-amber-400/90 font-medium">
                          {show.musicianGenres.join(', ')}
                        </span>
                      </p>
                    </div>

                    <img
                      src={show.musicianAvatar}
                      alt={show.musicianName}
                      onClick={() => onViewMusician(show.musicianId)}
                      title={`Ver perfil de ${show.musicianName}`}
                      className="w-10 h-10 rounded-full object-cover border border-amber-500/40 shrink-0 cursor-pointer hover:scale-105 transition-transform"
                    />
                  </div>

                  {/* Airbnb-style Ratings Summary for both parties */}
                  <div className="bg-slate-950/60 rounded-xl p-2.5 border border-slate-800/80 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-1 text-slate-300">
                      <span className="text-slate-500">Músico:</span>
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span className="font-bold text-slate-200">
                        {musician ? musician.rating.toFixed(1) : '4.9'}
                      </span>
                      <span className="text-slate-500">({musician?.reviewCount || 20})</span>
                    </div>

                    <div className="h-3 w-px bg-slate-800" />

                    <div className="flex items-center space-x-1 text-slate-300">
                      <span className="text-slate-500">Bar:</span>
                      <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span className="font-bold text-slate-200">
                        {venue ? venue.rating.toFixed(1) : '4.9'}
                      </span>
                      <span className="text-slate-500">({venue?.reviewCount || 35})</span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      onClick={() => onSelectShow(show)}
                      className="flex-1 py-2.5 px-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold rounded-xl text-xs shadow-md transition-all flex items-center justify-center space-x-1"
                    >
                      <UtensilsCrossed className="w-3.5 h-3.5" />
                      <span>Reservar Mesa / Ver Show</span>
                    </button>

                    <button
                      onClick={() => onViewVenue(show.venueId)}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1"
                      title="Ver perfil y reputación del bar"
                    >
                      <span>Bar</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
