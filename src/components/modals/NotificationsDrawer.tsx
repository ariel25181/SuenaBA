import React from 'react';
import { X, Bell, CheckCheck, Sparkles, MessageCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext.tsx';

interface NotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToTab?: (tab: string) => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  isOpen,
  onClose,
  onNavigateToTab,
}) => {
  const { notifications, markNotificationsAsRead } = useApp();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-sm bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-2">
            <Bell className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-slate-100 font-display">Notificaciones</h3>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={markNotificationsAsRead}
              title="Marcar todas como leídas"
              className="text-xs text-slate-400 hover:text-amber-400 transition-colors p-1"
            >
              <CheckCheck className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1 rounded-full"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {notifications.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No tenés notificaciones pendientes.
            </div>
          ) : (
            notifications.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (onNavigateToTab) onNavigateToTab('acuerdos');
                  onClose();
                }}
                className={`p-3.5 rounded-xl border text-xs cursor-pointer transition-all ${
                  item.read
                    ? 'bg-slate-950/40 border-slate-800/60 text-slate-400'
                    : 'bg-slate-800/60 border-amber-500/40 text-slate-200 shadow-sm'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-bold text-slate-100 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block shrink-0" />
                    <span>{item.title}</span>
                  </span>
                  <span className="text-[10px] text-slate-500">{item.timestamp}</span>
                </div>
                <p className="text-slate-300 leading-relaxed">{item.message}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
