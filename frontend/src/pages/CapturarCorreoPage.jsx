import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { guardarCorreo } from '../lib/api';

// El correo es obligatorio desde el 2026-10-02 (con él se recupera la
// contraseña), pero el roster cargado con cargar-profesores.php no lo trae.
// A quien entre sin correo se le pide aquí antes de dejarlo pasar; App.jsx
// decide cuándo mostrar esta pantalla.
export default function CapturarCorreoPage() {
  const { token, profesor, recargarPerfil, logout } = useAuth();
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await guardarCorreo(token, correo.trim());
      // Al recargar, profesor.correo ya viene lleno y App.jsx deja pasar.
      await recargarPerfil();
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Agrega tu correo</h1>
        <p className="login-subtitle">{profesor.nombre}</p>
        <p className="login-hint">
          Necesitamos un correo para poder mandarte un enlace si algún día olvidas tu contraseña.
          Lo puedes cambiar después en Mi perfil.
        </p>

        <label htmlFor="capturar-correo">Correo electrónico</label>
        <input
          id="capturar-correo"
          type="email"
          autoComplete="email"
          maxLength={191}
          placeholder="nombre@itam.mx"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          autoFocus
          required
        />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn-primary" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar y continuar'}
        </button>
        <button type="button" className="btn-link" onClick={logout}>
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
