import React from 'react';
import {
  CalendarDays,
  Radio,
  Clock,
  Handshake,
  User,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { useApp } from '../context/AppContext.tsx';

interface BottomNavProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab }) => {
  const { role, openCalls, musicianAvailabilities, liveShows } = useApp();

  const openCallsCount = openCalls.filter((c) => c.status === 'abierta').length;
  const availCount = musicianAvailabilities.filter((a) => a.status === 'disponible').length;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800/80 px-2 py-1.5 safe-area-bottom">
      <div className="max-w-md mx-auto grid grid-cols-6 gap-1">
        {/* Tab 1: Cartelera BA (Función 3) */}
        <button
          onClick={() => onSelectTab('cartelera')}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all ${
            activeTab === 'cartelera'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CalendarDays className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Cartelera</span>
        </button>

        {/* Tab 2: Convocatorias (Función 1) */}
        <button
          onClick={() => onSelectTab('convocatorias')}
          className={`relative flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all ${
            activeTab === 'convocatorias'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Radio className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Convocatorias</span>
          {openCallsCount > 0 && (
            <span className="absolute top-1 right-2.5 w-2 h-2 rounded-full bg-amber-400" />
          )}
        </button>

        {/* Tab 3: Disponibilidad (Función 2) */}
        <button
          onClick={() => onSelectTab('disponibilidad')}
          className={`relative flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all ${
            activeTab === 'disponibilidad'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Clock className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Disponibles</span>
          {availCount > 0 && (
            <span className="absolute top-1 right-2.5 w-2 h-2 rounded-full bg-cyan-400" />
          )}
        </button>

        {/* Tab 4: Acuerdos & Ratings */}
        <button
          onClick={() => onSelectTab('acuerdos')}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all ${
            activeTab === 'acuerdos'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Handshake className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Acuerdos</span>
        </button>

        {/* Tab: Reservas (estilo Airbnb) */}
        <button
          onClick={() => onSelectTab('reservas')}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all ${
            activeTab === 'reservas'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Ticket className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">Reservas</span>
        </button>

        {/* Tab 5: Mi Perfil & Reputación */}
        <button
          onClick={() => onSelectTab('perfil')}
          className={`flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all ${
            activeTab === 'perfil'
              ? 'text-amber-400 font-bold bg-amber-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <User className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] tracking-tight">
            {role === 'bar' ? 'Mi Bar' : role === 'musico' ? 'Mi Banda' : 'Perfil'}
          </span>
        </button>
      </div>
    </nav>
  );
};
