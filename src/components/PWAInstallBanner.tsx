import React, { useState } from 'react';
import { Download, Smartphone, X, Share, PlusSquare, Sparkles, Check } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

export const PWAInstallBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // If already running in standalone PWA mode, hide
  if (isInstalled || dismissed) {
    return null;
  }

  return (
    <>
      {/* Top Banner / In-app Install notification */}
      <div className="bg-gradient-to-r from-amber-500/15 via-slate-900 to-amber-500/10 border-b border-amber-500/30 px-3.5 py-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center space-x-2 truncate">
          <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Smartphone className="w-3.5 h-3.5" />
          </div>
          <span className="text-slate-200 truncate">
            <strong>Instalá SuenaBA en tu celular</strong> (Android o iPhone)
          </span>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          {isInstallable ? (
            <button
              onClick={install}
              className="py-1 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center space-x-1 shadow-sm transition-all"
            >
              <Download className="w-3 h-3" />
              <span>Instalar</span>
            </button>
          ) : (
            <button
              onClick={() => setShowGuide(true)}
              className="py-1 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-[11px] flex items-center space-x-1 transition-all"
            >
              <span>Ver cómo instalar</span>
            </button>
          )}

          <button
            onClick={() => setDismissed(true)}
            aria-label="Cerrar banner de instalación"
            className="p-1 text-slate-400 hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Guided Modal for Android and iPhone Installation */}
      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-xl overflow-hidden border border-amber-500/40 shrink-0">
                  <img src="/pwa-192x192.png" alt="SuenaBA Icon" className="w-full h-full object-cover" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100 font-display text-base">
                    Instalar SuenaBA en tu Celular
                  </h3>
                  <p className="text-xs text-slate-400">
                    Funciona como app nativa sin ocupar espacio
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGuide(false)}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* iPhone / iOS Guide */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-2.5 text-xs text-slate-200">
              <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm">
                <span>🍏 En iPhone (Safari):</span>
              </div>
              <ol className="space-y-2 text-slate-300 list-decimal list-inside leading-relaxed">
                <li className="flex items-start space-x-2">
                  <span className="font-bold text-amber-400">1.</span>
                  <span>
                    Abrí esta página en <strong>Safari</strong> y tocá el botón <strong>Compartir</strong> (ícono de un cuadrado con flecha hacia arriba <Share className="inline w-3.5 h-3.5 text-amber-400 mx-0.5" /> en la barra inferior).
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="font-bold text-amber-400">2.</span>
                  <span>
                    Deslizá hacia abajo y seleccioná <strong>"Agregar a pantalla de inicio"</strong> (<PlusSquare className="inline w-3.5 h-3.5 text-amber-400 mx-0.5" />).
                  </span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="font-bold text-amber-400">3.</span>
                  <span>
                    Tocá <strong>"Agregar"</strong> arriba a la derecha. ¡Listo! Ya tenés el ícono dorado de SuenaBA en tu pantalla de inicio y abre a pantalla completa.
                  </span>
                </li>
              </ol>
            </div>

            {/* Android Guide */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-2.5 text-xs text-slate-200">
              <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
                <span>🤖 En Android (Chrome / Brave / Edge):</span>
              </div>
              {isInstallable ? (
                <button
                  onClick={() => {
                    install();
                    setShowGuide(false);
                  }}
                  className="w-full py-2.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>Instalar ahora con 1 clic</span>
                </button>
              ) : (
                <ol className="space-y-2 text-slate-300 list-decimal list-inside leading-relaxed">
                  <li className="flex items-start space-x-2">
                    <span className="font-bold text-emerald-400">1.</span>
                    <span>
                      En Chrome, tocá el menú de los <strong>tres puntos verticales (`⋮`)</strong> arriba a la derecha.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="font-bold text-emerald-400">2.</span>
                    <span>
                      Seleccioná <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.
                    </span>
                  </li>
                  <li className="flex items-start space-x-2">
                    <span className="font-bold text-emerald-400">3.</span>
                    <span>
                      Confirmá la instalación. Se instalará automáticamente con su propio acceso directo.
                    </span>
                  </li>
                </ol>
              )}
            </div>

            {/* Button Close */}
            <button
              onClick={() => setShowGuide(false)}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};
