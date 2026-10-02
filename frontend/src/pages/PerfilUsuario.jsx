import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { cambiarPassword, guardarCorreo } from '../lib/api';
import { TIPO_CONTRATO_LABELS, etiquetaRol } from '../lib/roles';

// Mismas reglas que api/cambiar-password.php, repetidas aquí solo para avisar
// antes de mandar. Quien decide es el servidor.
const MIN_LARGO = 6;

export default function PerfilUsuario({ onVolver }) {
  const { token, profesor, nombreDepartamento, recargarPerfil } = useAuth();

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  // El correo se guarda aparte de la contraseña: son dos formularios.
  const [correo, setCorreo] = useState(profesor.correo ?? '');
  const [guardandoCorreo, setGuardandoCorreo] = useState(false);
  const [errorCorreo, setErrorCorreo] = useState('');
  const [mensajeCorreo, setMensajeCorreo] = useState('');

  async function enviarCorreo(e) {
    e.preventDefault();
    setErrorCorreo('');
    setMensajeCorreo('');
    setGuardandoCorreo(true);
    try {
      const r = await guardarCorreo(token, correo.trim());
      setCorreo(r.correo ?? '');
      setMensajeCorreo(r.correo ? 'Listo: guardamos tu correo.' : 'Listo: quitamos tu correo.');
    } catch (err) {
      setErrorCorreo(err.message);
      setGuardandoCorreo(false);
      return;
    }
    // Ya se guardó: si la recarga del perfil falla no es un error del guardado.
    await recargarPerfil().catch(() => {});
    setGuardandoCorreo(false);
  }

  function validar() {
    if (!actual || !nueva || !confirmacion) return 'Llena los tres campos.';
    if (nueva.length < MIN_LARGO) {
      return `La nueva contraseña debe tener al menos ${MIN_LARGO} caracteres.`;
    }
    if (nueva === profesor.cu) return 'La nueva contraseña no puede ser tu clave única.';
    if (nueva === actual) return 'La nueva contraseña es igual a la actual.';
    if (nueva !== confirmacion) return 'La confirmación no coincide con la nueva contraseña.';
    return '';
  }

  async function enviar(e) {
    e.preventDefault();
    setMensaje('');
    const problema = validar();
    setError(problema);
    if (problema) return;

    setGuardando(true);
    try {
      await cambiarPassword(token, actual, nueva);
      setActual('');
      setNueva('');
      setConfirmacion('');
      setMensaje('Listo: tu contraseña cambió. Úsala la próxima vez que entres.');
      // password_predeterminada acaba de cambiar en el servidor.
      await recargarPerfil().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  const datos = [
    ['Nombre', profesor.nombre],
    ['Clave única', profesor.cu],
    ['Departamento', profesor.departamento_id ? nombreDepartamento(profesor.departamento_id) : null],
    ['Rol', etiquetaRol(profesor.rol)],
    [
      'Tipo de contrato',
      profesor.tipo_contrato
        ? (TIPO_CONTRATO_LABELS[profesor.tipo_contrato] ?? profesor.tipo_contrato)
        : null,
    ],
  ].filter(([, valor]) => valor);

  return (
    <div className="formulario-screen perfil-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <strong className="perfil-titulo">Mi perfil</strong>
      </header>

      <section className="formulario-seccion">
        <h2>Mis datos</h2>
        <dl className="perfil-datos">
          {datos.map(([etiqueta, valor]) => (
            <div key={etiqueta}>
              <dt>{etiqueta}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>
        <p className="formulario-nota">
          Si algún dato está mal, pídele a tu Jefe de Departamento que lo corrija.
        </p>
      </section>

      <section className="formulario-seccion">
        <h2>Correo</h2>
        <form className="perfil-form" onSubmit={enviarCorreo} noValidate>
          <label htmlFor="correo">Correo electrónico</label>
          <input
            id="correo"
            type="email"
            autoComplete="email"
            maxLength={255}
            placeholder="nombre@itam.mx"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
          />
          <p className="formulario-nota">
            Para que la jefatura pueda contactarte sobre tu asignación. Déjalo vacío para quitarlo.
          </p>
          {errorCorreo && (
            <p className="formulario-error" role="alert">
              {errorCorreo}
            </p>
          )}
          {mensajeCorreo && (
            <p className="formulario-mensaje" role="status">
              {mensajeCorreo}
            </p>
          )}
          <div>
            <button
              type="submit"
              className="btn-primary"
              disabled={guardandoCorreo || correo.trim() === (profesor.correo ?? '')}
            >
              {guardandoCorreo ? 'Guardando…' : 'Guardar correo'}
            </button>
          </div>
        </form>
      </section>

      <section className="formulario-seccion">
        <h2>Cambiar contraseña</h2>
        <form className="perfil-form" onSubmit={enviar} noValidate>
          <label htmlFor="password_actual">Contraseña actual</label>
          <input
            id="password_actual"
            type="password"
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
          />
          <label htmlFor="password_nueva">Nueva contraseña</label>
          <input
            id="password_nueva"
            type="password"
            autoComplete="new-password"
            aria-describedby="password_ayuda"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
          />
          <p className="formulario-nota" id="password_ayuda">
            Al menos {MIN_LARGO} caracteres, y distinta de tu clave única.
          </p>
          <label htmlFor="password_confirmacion">Confirma la nueva contraseña</label>
          <input
            id="password_confirmacion"
            type="password"
            autoComplete="new-password"
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
          />

          {error && (
            <p className="formulario-error" role="alert">
              {error}
            </p>
          )}
          {mensaje && (
            <p className="formulario-mensaje" role="status">
              {mensaje}
            </p>
          )}

          <div>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
