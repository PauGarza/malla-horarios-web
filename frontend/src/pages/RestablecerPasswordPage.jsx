import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { restablecerPassword } from '../lib/api';

// Mismas reglas que api/restablecer-password.php, repetidas solo para avisar
// antes de mandar. Quien decide es el servidor.
const MIN_LARGO = 6;

// Se llega aquí desde el enlace del correo (#restablecer=<token>); App.jsx lee
// el token y quita el fragmento con onTerminar.
export default function RestablecerPasswordPage({ token, onTerminar }) {
  const { login } = useAuth();
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (nueva.length < MIN_LARGO) {
      setError(`La nueva contraseña debe tener al menos ${MIN_LARGO} caracteres.`);
      return;
    }
    if (nueva !== confirmar) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setEnviando(true);
    let cu;
    try {
      ({ cu } = await restablecerPassword(token, nueva));
    } catch (err) {
      setError(err.message);
      setEnviando(false);
      return;
    }
    // Ya cambió: entrar de una vez. Si el login falla, la contraseña sí quedó;
    // se manda al login normal en vez de mostrar un error que diga lo contrario.
    await login(cu, nueva).catch(() => {});
    onTerminar();
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Nueva contraseña</h1>
        <p className="login-subtitle">División de Ciencias Exactas — ITAM</p>

        <label htmlFor="restablecer-nueva">Nueva contraseña</label>
        <input
          id="restablecer-nueva"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LARGO}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoFocus
          required
        />
        <label htmlFor="restablecer-confirmar">Confirma la nueva contraseña</label>
        <input
          id="restablecer-confirmar"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LARGO}
          value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)}
          required
        />
        <p className="login-hint">Al menos {MIN_LARGO} caracteres, y distinta de tu clave única.</p>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn-primary" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar y entrar'}
        </button>
        <button type="button" className="btn-link" onClick={onTerminar}>
          Cancelar
        </button>
      </form>
    </div>
  );
}
