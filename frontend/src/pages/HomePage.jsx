import { useAuth } from '../context/AuthContext';

const ROL_LABELS = {
  profesor: 'Profesor',
  jefe_departamento: 'Jefe de Departamento',
  servicios_escolares: 'Servicios Escolares',
  nomina: 'Nómina',
  admin: 'Administrador',
};

const ROLES_GESTION_DEPARTAMENTO = ['jefe_departamento', 'admin'];

// Vistas "próximamente" por rol — además de Formulario de preferencias y
// Preferencias recibidas, que se calculan aparte (dependen de tipo_contrato/
// rol específico, no de una lista fija).
const VISTAS_PENDIENTES_POR_ROL = {
  jefe_departamento: ['Panel de Jefe de Departamento (grupos y asignación de tu departamento)'],
  servicios_escolares: ['Panel de Servicios Escolares'],
  nomina: ['Reporte de horas para Nómina'],
  admin: ['Panel de administración'],
};

export default function HomePage({
  onAbrirFormulario,
  onAbrirPanelPreferencias,
  onAbrirConfigCuestionario,
  onAbrirCatalogoMaterias,
}) {
  const { profesor, nombreDepartamento, logout } = useAuth();

  const daClases = Boolean(profesor.tipo_contrato);
  const gestionaDepartamento = ROLES_GESTION_DEPARTAMENTO.includes(profesor.rol);
  const pendientes = VISTAS_PENDIENTES_POR_ROL[profesor.rol] ?? [];

  return (
    <div className="home-screen">
      <header className="home-header">
        <div>
          <h1>Malla Horarios</h1>
          <p className="home-subtitle">
            {profesor.nombre} · {ROL_LABELS[profesor.rol] ?? profesor.rol}
            {profesor.departamento_id && ` · ${nombreDepartamento(profesor.departamento_id)}`}
          </p>
        </div>
        <button className="btn-secondary" onClick={logout}>
          Cerrar sesión
        </button>
      </header>

      <main className="home-main">
        <h2>Vistas disponibles</h2>
        <div className="opciones-grid">
          {daClases && (
            <button className="opcion-card opcion-activa" onClick={onAbrirFormulario}>
              <strong>Formulario de preferencias</strong>
              <span>Declara las materias y horarios que prefieres para el semestre.</span>
            </button>
          )}

          {gestionaDepartamento && (
            <button className="opcion-card opcion-activa" onClick={onAbrirCatalogoMaterias}>
              <strong>Catálogo de materias</strong>
              <span>
                Los datos oficiales de las materias de tu departamento: clave, nombre, créditos y
                si siguen activas.
              </span>
            </button>
          )}

          {gestionaDepartamento && (
            <button className="opcion-card opcion-activa" onClick={onAbrirConfigCuestionario}>
              <strong>Configurar el cuestionario</strong>
              <span>Qué materias ve cada profesor este semestre, y las excepciones por persona.</span>
            </button>
          )}

          {gestionaDepartamento && (
            <button className="opcion-card opcion-activa" onClick={onAbrirPanelPreferencias}>
              <strong>Preferencias recibidas</strong>
              <span>
                Quién ya respondió el cuestionario, quién falta, y reabrirlo si alguien necesita
                corregir algo.
              </span>
            </button>
          )}

          {pendientes.map((titulo) => (
            <div className="opcion-card opcion-pendiente" key={titulo}>
              <strong>{titulo}</strong>
              <span>Todavía no está construida — próximamente.</span>
            </div>
          ))}

          {!daClases && !gestionaDepartamento && pendientes.length === 0 && (
            <p className="home-vacio">
              Tu cuenta no tiene ninguna vista disponible todavía.
            </p>
          )}
        </div>

        <p className="home-contacto">
          ¿Dudas o comentarios? Escríbeme a{' '}
          <a href="mailto:paulina.garza@itam.mx">paulina.garza@itam.mx</a>
        </p>
      </main>
    </div>
  );
}
