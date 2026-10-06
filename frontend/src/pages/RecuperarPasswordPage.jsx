import { useState } from 'react';
import { olvidePassword } from '../lib/api';

// "Olvidé mi contraseña": pide el correo y el servidor manda un enlace de un
// solo uso (api/olvide-password.php). El enlace vuelve a la app con
// #restablecer=<token>, que abre RestablecerPasswordPage desde App.jsx.
export default function RecuperarPasswordPage({ onVolver }) {
  const [correo, setCorreo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await olvidePassword(correo.trim());
      setEnviado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Recuperar contraseña</h1>
        <p className="login-subtitle">División de Ciencias Exactas — ITAM</p>

        {enviado ? (
          // Mismo mensaje exista o no la cuenta: el servidor tampoco lo dice.
          <p className="login-ok" role="status">
            Si hay una cuenta con <strong>{correo.trim()}</strong>, te mandamos un correo con un
            enlace para elegir una contraseña nueva. Vence en una hora. Revisa también la carpeta
            de correo no deseado.
          </p>
        ) : (
          <>
            <p className="login-hint">
              Escribe el correo que registraste en tu cuenta y te mandaremos un enlace para elegir
              una contraseña nueva.
            </p>
            <label htmlFor="recuperar-correo">Correo electrónico</label>
            <input
              id="recuperar-correo"
              type="email"
              autoComplete="email"
              maxLength={191}
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              autoFocus
              required
            />

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="btn-primary" disabled={enviando}>
              {enviando ? 'Enviando…' : 'Mandar enlace'}
            </button>
          </>
        )}

        <button type="button" className="btn-link" onClick={onVolver}>
          Volver a iniciar sesión
        </button>
        <p className="login-hint">
          ¿No registraste correo o ya no tienes acceso a él? Escribe a{' '}
          <a href="mailto:paulina.garza@itam.mx">paulina.garza@itam.mx</a>.
        </p>
      </form>
    </div>
  );
}
