import React from 'react';

interface State {
  error: Error | null;
}

/**
 * Evita la pantalla negra: si una vista falla, muestra un mensaje
 * y permite reintentar o restablecer los datos locales.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('SuenaBA error:', error, info.componentStack);
  }

  handleReset = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('suena_ba_v1_'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <div className="text-4xl">🎷</div>
          <h1 className="text-xl font-bold">Algo salió mal</h1>
          <p className="text-sm text-slate-400">
            Esta pantalla no pudo cargarse. Probá recargar; si sigue igual, restablecé los datos locales.
          </p>
          <pre className="text-xs text-left text-red-300 bg-slate-900 border border-slate-800 rounded-xl p-3 overflow-auto max-h-32">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm"
            >
              Recargar
            </button>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded-xl border border-slate-700 text-slate-200 text-sm"
            >
              Restablecer datos
            </button>
          </div>
        </div>
      </div>
    );
  }
}
