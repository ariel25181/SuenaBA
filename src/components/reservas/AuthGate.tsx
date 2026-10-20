import React, { useState } from 'react';
import { useSession } from '../../context/SessionContext.tsx';
import { Banner, Btn, Card, Field, inputCls, useAction } from './ui.tsx';

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state } = useSession();
  if (state.status === 'loading') return <p className="text-center text-sm text-slate-400 py-10">Cargando…</p>;
  if (state.status === 'anon') return <LoginForm />;
  if (state.status === 'no_profile') return <Onboarding />;
  return <>{children}</>;
};

const LoginForm: React.FC = () => {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setMsg(null);
    const err = await (mode === 'login' ? signIn(email.trim(), password) : signUp(email.trim(), password));
    setMsg(err); setBusy(false);
  };
  return (
    <Card className="space-y-3 mt-4">
      <h2 className="text-lg font-bold text-slate-100">{mode === 'login' ? 'Ingresá a SuenaBA' : 'Creá tu cuenta'}</h2>
      <p className="text-xs text-slate-400">Reservá fechas, cobrá tus shows y dejá reseñas verificadas.</p>
      <Field label="Email"><input className={inputCls} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Contraseña"><input className={inputCls} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      {msg && <Banner kind="error">{msg}</Banner>}
      <Btn className="w-full" disabled={busy || !email || password.length < 6} onClick={submit}>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</Btn>
      <button className="w-full text-xs text-amber-400" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg(null); }}>
        {mode === 'login' ? '¿No tenés cuenta? Crear una' : 'Ya tengo cuenta'}
      </button>
    </Card>
  );
};

const Onboarding: React.FC = () => {
  const { state, api, refresh, signOut } = useSession();
  const { run, busy, error } = useAction();
  const [role, setRole] = useState<'bar' | 'musico'>('musico');
  const [name, setName] = useState(''), [neighborhood, setNeighborhood] = useState(''), [address, setAddress] = useState(''), [bio, setBio] = useState(''), [evidence, setEvidence] = useState('');
  if (state.status !== 'no_profile') return null;
  const req = state.request;
  if (req?.status === 'pendiente') {
    return (
      <Card className="space-y-2 mt-4">
        <h2 className="text-lg font-bold text-slate-100">Estamos revisando tu perfil</h2>
        <p className="text-sm text-slate-400">Recibimos tu solicitud como <strong>{req.displayName}</strong> ({req.role === 'bar' ? 'bar' : 'músico/banda'}). Te avisamos apenas esté verificado.</p>
        <Btn kind="ghost" onClick={refresh}>Actualizar estado</Btn>
        <Btn kind="ghost" onClick={signOut}>Cerrar sesión</Btn>
      </Card>
    );
  }
  const submit = () => run(async () => { await api.requestProfile({ role, displayName: name, neighborhood, address, bio, evidenceUrl: evidence }); await refresh(); });
  return (
    <Card className="space-y-3 mt-4">
      <h2 className="text-lg font-bold text-slate-100">Contanos quién sos</h2>
      {req?.status === 'rechazada' && <Banner kind="error">No pudimos verificar tu solicitud anterior{req.reviewerNote ? `: ${req.reviewerNote}` : '.'} Podés enviar una nueva.</Banner>}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de perfil">
        <Btn kind={role === 'musico' ? 'primary' : 'ghost'} role="radio" aria-checked={role === 'musico'} onClick={() => setRole('musico')}>Soy músico o banda</Btn>
        <Btn kind={role === 'bar' ? 'primary' : 'ghost'} role="radio" aria-checked={role === 'bar'} onClick={() => setRole('bar')}>Tengo un bar</Btn>
      </div>
      <Field label={role === 'bar' ? 'Nombre del bar' : 'Nombre artístico'}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      {role === 'bar' && <>
        <Field label="Barrio"><input className={inputCls} value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Palermo Soho" /></Field>
        <Field label="Dirección"><input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      </>}
      <Field label="Presentación"><textarea className={inputCls} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} /></Field>
      <Field label="Enlace para verificarte (Instagram, YouTube, web)" hint="Debe empezar con https://"><input className={inputCls} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
      {error && <Banner kind="error">{error}</Banner>}
      <Btn className="w-full" disabled={busy || name.trim().length < 2} onClick={submit}>Enviar solicitud</Btn>
      <button className="w-full text-xs text-slate-500" onClick={signOut}>Cerrar sesión</button>
    </Card>
  );
};
