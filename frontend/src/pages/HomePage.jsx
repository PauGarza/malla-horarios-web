import { useAuth } from '../context/AuthContext';

const ROL_LABELS = {
  profesor: 'Profesor',
  jefe_departamento: 'Jefe de Departamento',
  servicios_escolares: 'Servicios Escolares',
  nomina: 'Nómina',
  admin: 'Administrador',
};

const ROLES_CON_PANEL_PREFERENCIAS = ['jefe_departamento', 'admin'];

// Vistas "próximamente" por rol — además de Formulario de preferencias y
// Preferencias recibidas, que se calculan aparte (dependen de tipo_contrato/
// rol específico, no de una lista fija).
const VISTAS_PENDIENTES_POR_ROL = {
  jefe_departamento: ['Panel de Jefe de Departamento (grupos y asignación de tu departamento)'],
  servicios_escolares: ['Panel de Servicios Escolares'],
  nomina: ['Reporte de horas para Nómina'],
  admin: ['Panel de administración'],
};

export default function HomePage({ onAbrirFormulario, onAbrirPanelPreferencias }) {
  const { profesor, nombreDepartamento, logout } = useAuth();

  const daClases = Boolean(profesor.tipo_contrato);
  const vePanelPreferencias = ROLES_CON_PANEL_PREFERENCIAS.includes(profesor.rol);
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

          {vePanelPreferencias && (
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

          {!daClases && !vePanelPreferencias && pendientes.length === 0 && (
            <p className="home-vacio">
              Tu cuenta no tiene ninguna vista disponible todavía.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
