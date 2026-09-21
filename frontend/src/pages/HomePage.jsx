import { useAuth } from '../context/AuthContext';

const ROL_LABELS = {
  profesor: 'Profesor',
  jefe_departamento: 'Jefe de Departamento',
  servicios_escolares: 'Servicios Escolares',
  nomina: 'Nómina',
  admin: 'Administrador',
};

// Vistas "próximamente" por rol — además de Formulario de preferencias, que
// se calcula aparte (depende de tipo_contrato, no solo del rol: un Jefe de
// Departamento también da clases y debe verlo, un admin puro no).
const VISTAS_PENDIENTES_POR_ROL = {
  jefe_departamento: ['Panel de Jefe de Departamento (asignaciones de tu departamento)'],
  servicios_escolares: ['Panel de Servicios Escolares'],
  nomina: ['Reporte de horas para Nómina'],
  admin: ['Panel de administración'],
};

export default function HomePage({ onAbrirFormulario }) {
  const { profesor, nombreDepartamento, logout } = useAuth();

  const daClases = Boolean(profesor.tipo_contrato);
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

          {pendientes.map((titulo) => (
            <div className="opcion-card opcion-pendiente" key={titulo}>
              <strong>{titulo}</strong>
              <span>Todavía no está construida — próximamente.</span>
            </div>
          ))}

          {!daClases && pendientes.length === 0 && (
            <p className="home-vacio">
              Tu cuenta no tiene ninguna vista disponible todavía.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
