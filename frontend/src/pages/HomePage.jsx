import { useAuth } from '../context/AuthContext';
import { administraSemestres, etiquetaRol, gestionaDepartamento as esGestion } from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';

// Vistas "próximamente" por rol — además de las que se calculan aparte
// (dependen de tipo_contrato o de si el rol gestiona un departamento).
const VISTAS_PENDIENTES_POR_ROL = {
  jefe_departamento: ['Panel de Jefe de Departamento (grupos y asignación de tu departamento)'],
  // Por ahora la jefatura de división ve solo Matemáticas (DIVISION_SOLO_SU_DEPARTAMENTO).
  jefe_division: ['Panel de División (grupos y asignación de tu departamento)'],
  servicios_escolares: ['Panel de Servicios Escolares'],
  nomina: ['Reporte de horas para Nómina'],
  admin: ['Panel de administración'],
};

export default function HomePage({
  onAbrirFormulario,
  onAbrirPanelPreferencias,
  onAbrirEditor,
  onAbrirRespuestas,
  onAbrirCatalogoMaterias,
  onAbrirCargaDemanda,
  onAbrirDemanda,
  onAbrirSemestres,
}) {
  const { profesor, nombreDepartamento, formularioPublicado, semestre } = useAuth();

  const daClases = Boolean(profesor.tipo_contrato);
  const gestionaDepartamento = esGestion(profesor.rol);
  const administra = administraSemestres(profesor.rol);
  const pendientes = VISTAS_PENDIENTES_POR_ROL[profesor.rol] ?? [];

  return (
    <div className="home-screen">
      <header className="home-header">
        <div>
          <h1>Malla Horarios</h1>
          <p className="home-subtitle">
            {profesor.nombre} · {etiquetaRol(profesor.rol)}
            {profesor.departamento_id && ` · ${nombreDepartamento(profesor.departamento_id)}`}
          </p>
        </div>
      </header>

      <main className="home-main">
        <h2>Vistas disponibles</h2>
        <div className="opciones-grid">
          {daClases && (
            <button className="opcion-card opcion-activa" onClick={onAbrirFormulario}>
              <strong>
                Formulario de preferencias
                {!formularioPublicado && <span className="badge badge-no_iniciado">Aún no disponible</span>}
              </strong>
              <span>Declara las materias y horarios que prefieres para {etiquetaSemestre(semestre)}.</span>
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
            <button className="opcion-card opcion-activa" onClick={onAbrirEditor}>
              <strong>
                Editar el formulario
                <span className={`badge ${formularioPublicado ? 'badge-enviado' : 'badge-no_iniciado'}`}>
                  {formularioPublicado ? 'Publicado' : 'Sin publicar'}
                </span>
              </strong>
              <span>
                Las secciones, materias, preguntas y textos que verán los profesores, y publicarlo.
              </span>
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

          {gestionaDepartamento && (
            <button className="opcion-card opcion-activa" onClick={onAbrirRespuestas}>
              <strong>Respuestas y bloqueos</strong>
              <span>Lo que contestó cada profesor por materia, y bloquear materias a quien no le tocan.</span>
            </button>
          )}

          {gestionaDepartamento && (
            <button className="opcion-card opcion-activa" onClick={onAbrirCargaDemanda}>
              <strong>Cargar la estimación de demanda</strong>
              <span>Subir el PDF de Servicios Escolares con los grupos sugeridos por materia.</span>
            </button>
          )}

          {gestionaDepartamento && (
            <button className="opcion-card opcion-activa" onClick={onAbrirDemanda}>
              <strong>Demanda del semestre</strong>
              <span>La estimación cargada: grupos sugeridos por materia.</span>
            </button>
          )}

          {administra && (
            <button className="opcion-card opcion-activa" onClick={onAbrirSemestres}>
              <strong>Semestres</strong>
              <span>Abrir el siguiente semestre cuando empieza la planeación, y consultar los anteriores.</span>
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
