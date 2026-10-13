import { useAuth } from '../context/AuthContext';
import {
  administraSemestres,
  etiquetaRol,
  gestionaDepartamento as esGestion,
  veTodosLosDepartamentos,
} from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';

// Vistas "próximamente" por rol — además de las que se calculan aparte
// (dependen de tipo_contrato o de si el rol gestiona un departamento).
const VISTAS_PENDIENTES_POR_ROL = {
  jefe_departamento: ['Panel de Jefe de Departamento (grupos y asignación de tu departamento)'],
  // Por ahora la jefatura de división ve solo Matemáticas (DIVISION_SOLO_SU_DEPARTAMENTO).
  jefe_division: ['Panel de División (grupos y asignación de tu departamento)'],
  servicios_escolares: ['Panel de Servicios Escolares'],
  nomina: ['Reporte de horas para Nómina'],
  // admin no tiene pendiente: el avance de los 3 departamentos lo ve en
  // Semestres, y cada vista de jefatura le pone selector de departamento.
};

export default function HomePage({
  onAbrirFormulario,
  onAbrirPanelPreferencias,
  onAbrirEditor,
  onAbrirRespuestas,
  onAbrirReporte,
  onAbrirReporteHoras,
  onAbrirAsignaciones,
  onAbrirCatalogoMaterias,
  onAbrirCargaDemanda,
  onAbrirSemestres,
}) {
  const { profesor, nombreDepartamento, formularioPublicado, semestre } = useAuth();

  const daClases = Boolean(profesor.tipo_contrato);
  const gestionaDepartamento = esGestion(profesor.rol);
  const administra = administraSemestres(profesor.rol);
  // Sin departamento propio (admin): los textos hablan de todos, y no hay un
  // solo formulario cuyo estado poner en la tarjeta.
  const veTodos = veTodosLosDepartamentos(profesor.rol);
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
        {/* Un renglón por momento del semestre, de arriba abajo: llenar el
            formulario, preparar los datos, revisar lo que contestaron, reportes. */}
        {daClases && (
          <section className="home-seccion">
            <h2>Mi formulario</h2>
            <div className="opciones-grid">
              <button className="opcion-card opcion-activa" onClick={onAbrirFormulario}>
                <strong>
                  Formulario de preferencias
                  {!formularioPublicado && <span className="badge badge-no_iniciado">Aún no disponible</span>}
                </strong>
                <span>Declara las materias y horarios que prefieres para {etiquetaSemestre(semestre)}.</span>
              </button>
            </div>
          </section>
        )}

        {gestionaDepartamento && (
          <section className="home-seccion">
            <h2>Datos del semestre</h2>
            <div className="opciones-grid">
              <button className="opcion-card opcion-activa" onClick={onAbrirEditor}>
                <strong>
                  Editar el formulario
                  {!veTodos && (
                    <span className={`badge ${formularioPublicado ? 'badge-enviado' : 'badge-no_iniciado'}`}>
                      {formularioPublicado ? 'Publicado' : 'Sin publicar'}
                    </span>
                  )}
                </strong>
                <span>
                  Las secciones, materias, preguntas y textos que verán los profesores, y publicarlo.
                </span>
              </button>

              <button className="opcion-card opcion-activa" onClick={onAbrirCatalogoMaterias}>
                <strong>Catálogo de materias</strong>
                <span>
                  Los datos oficiales de las materias {veTodos ? 'de cada departamento' : 'de tu departamento'}:
                  clave, nombre, créditos y si siguen activas.
                </span>
              </button>

              <button className="opcion-card opcion-activa" onClick={onAbrirCargaDemanda}>
                <strong>Cargar la estimación de demanda</strong>
                <span>Subir el PDF de Servicios Escolares con los grupos sugeridos por materia.</span>
              </button>

              {administra && (
                <button className="opcion-card opcion-activa" onClick={onAbrirSemestres}>
                  <strong>Semestres</strong>
                  <span>
                    {veTodos && 'Cómo va cada departamento: formulario publicado, enviados, borradores y demanda. '}
                    Abrir el siguiente semestre cuando empieza la planeación, y consultar los anteriores.
                  </span>
                </button>
              )}
            </div>
          </section>
        )}

        {gestionaDepartamento && (
          <section className="home-seccion">
            <h2>Después de las respuestas</h2>
            <div className="opciones-grid">
              <button className="opcion-card opcion-activa" onClick={onAbrirPanelPreferencias}>
                <strong>Preferencias recibidas</strong>
                <span>
                  Quién ya respondió el cuestionario, quién falta, y reabrirlo si alguien necesita
                  corregir algo.
                </span>
              </button>

              <button className="opcion-card opcion-activa" onClick={onAbrirRespuestas}>
                <strong>Respuestas y bloqueos</strong>
                <span>Lo que contestó cada profesor por materia, y bloquear materias a quien no le tocan.</span>
              </button>

              <button className="opcion-card opcion-activa" onClick={onAbrirAsignaciones}>
                <strong>Asignaciones directas</strong>
                <span>
                  Fijar a mano qué profesor da qué materia (y si quieres, a qué hora) antes de correr el
                  algoritmo. Él lo respeta tal cual.
                </span>
              </button>
            </div>
          </section>
        )}

        {gestionaDepartamento && (
          <section className="home-seccion">
            <h2>Reportes</h2>
            <div className="opciones-grid">
              <button className="opcion-card opcion-activa" onClick={onAbrirReporte}>
                <strong>Reporte de preferencias</strong>
                <span>
                  Por profesor: tipo de contrato, cursos que pidió, y cuántas materias y horas marcó en
                  verde, amarillo y rojo.
                </span>
              </button>

              <button className="opcion-card opcion-activa" onClick={onAbrirReporteHoras}>
                <strong>Reporte de horas</strong>
                <span>
                  Mapa de calor de la semana: entre más profesores pidieron un horario, más oscuro se
                  ve, y en blanco los que nadie pidió.
                </span>
              </button>
            </div>
          </section>
        )}

        {pendientes.length > 0 && (
          <section className="home-seccion">
            <h2>Próximamente</h2>
            <div className="opciones-grid">
              {pendientes.map((titulo) => (
                <div className="opcion-card opcion-pendiente" key={titulo}>
                  <strong>{titulo}</strong>
                  <span>Todavía no está construida — próximamente.</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {!daClases && !gestionaDepartamento && pendientes.length === 0 && (
          <p className="home-vacio">
            Tu cuenta no tiene ninguna vista disponible todavía.
          </p>
        )}

        <p className="home-contacto">
          ¿Dudas o comentarios? Escríbeme a{' '}
          <a href="mailto:paulina.garza@itam.mx">paulina.garza@itam.mx</a>
        </p>
      </main>
    </div>
  );
}
