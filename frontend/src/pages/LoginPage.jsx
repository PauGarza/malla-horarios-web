import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [cu, setCu] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await login(cu.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Malla Horarios</h1>
        <p className="login-subtitle">División de Ciencias Exactas — ITAM</p>

        <label htmlFor="cu">Clave Única</label>
        <input
          id="cu"
          value={cu}
          onChange={(e) => setCu(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn-primary" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>

        {/* El CU del ejemplo es inventado a propósito: como la contraseña
            inicial ES el CU, poner aquí el de una persona real sería publicar
            sus credenciales en el código fuente de un repo público. */}
        <p className="login-hint">
          Tu usuario y tu contraseña inicial son tu Clave Única, <strong>sin ceros a la izquierda</strong> —
          si tu CU real es <code>000123456</code>, aquí escribe <code>123456</code>.
        </p>
      </form>
    </div>
  );
}
