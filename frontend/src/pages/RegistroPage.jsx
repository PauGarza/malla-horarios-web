import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { departamentosRegistro, registrar } from '../lib/api';

// Alta de cuenta desde la pantalla de login. Pide todas las columnas de
// `profesor` que le toca llenar a la persona; rol, activo,
// password_predeterminada y estado_especial los fija el servidor (ver
// api/registro.php).
const TIPOS_CONTRATO = [
  { valor: 'tiempo_completo', etiqueta: 'Tiempo completo' },
  { valor: 'medio_tiempo', etiqueta: 'Medio tiempo' },
  { valor: 'asignatura', etiqueta: 'Asignatura' },
];

export default function RegistroPage({ onVolver }) {
  const { login } = useAuth();
  const [departamentos, setDepartamentos] = useState([]);
  const [datos, setDatos] = useState({
    cu: '',
    nombre: '',
    correo: '',
    departamento_id: '',
    tipo_contrato: '',
    password: '',
    confirmar: '',
  });
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    departamentosRegistro()
      .then((r) => setDepartamentos(r.departamentos ?? []))
      .catch((err) => setError(err.message));
  }, []);

  const campo = (nombre) => ({
    id: `reg-${nombre}`,
    value: datos[nombre],
    onChange: (e) => setDatos((d) => ({ ...d, [nombre]: e.target.value })),
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (datos.password !== datos.confirmar) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setEnviando(true);
    try {
      const cu = datos.cu.trim();
      await registrar({
        cu,
        nombre: datos.nombre.trim(),
        correo: datos.correo.trim(),
        departamento_id: Number(datos.departamento_id),
        tipo_contrato: datos.tipo_contrato,
        password: datos.password,
      });
      // Cuenta creada: entrar de una vez en vez de mandarla a teclear lo mismo.
      await login(cu, datos.password);
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Crear cuenta</h1>
        <p className="login-subtitle">División de Ciencias Exactas — ITAM</p>

        <label htmlFor="reg-cu">Clave Única</label>
        <input
          {...campo('cu')}
          autoComplete="username"
          inputMode="numeric"
          pattern="[0-9]*"
          title="Solo números"
          maxLength={10}
          autoFocus
          required
        />

        <label htmlFor="reg-nombre">Nombre completo</label>
        <input {...campo('nombre')} autoComplete="name" maxLength={255} required />

        <label htmlFor="reg-correo">Correo electrónico (opcional)</label>
        <input {...campo('correo')} type="email" autoComplete="email" maxLength={255} />

        <label htmlFor="reg-departamento_id">Departamento</label>
        <select {...campo('departamento_id')} required>
          <option value="" disabled>
            Selecciona…
          </option>
          {departamentos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}
            </option>
          ))}
        </select>

        <label htmlFor="reg-tipo_contrato">Tipo de contrato</label>
        <select {...campo('tipo_contrato')} required>
          <option value="" disabled>
            Selecciona…
          </option>
          {TIPOS_CONTRATO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>

        <label htmlFor="reg-password">Contraseña</label>
        <input {...campo('password')} type="password" autoComplete="new-password" minLength={6} required />

        <label htmlFor="reg-confirmar">Confirmar contraseña</label>
        <input {...campo('confirmar')} type="password" autoComplete="new-password" minLength={6} required />

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn-primary" disabled={enviando}>
          {enviando ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
        <button type="button" className="btn-link" onClick={onVolver}>
          Ya tengo cuenta — iniciar sesión
        </button>
      </form>
    </div>
  );
}
