import { useAuth } from '../context/AuthContext';
import { etiquetaRol, gestionaDepartamento as esGestion, veTodosLosDepartamentos } from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';

// El menú de inicio:
//
//   Mi formulario          contestar el propio, para quien da clases
//                          (jefes incluidos: también dan clases).
//   Proceso del semestre   las ACCIONES de jefatura, agrupadas por las fases
//                          del procedimiento real (LE/Procedimiento.pdf y
//                          PROCESO-ACTUAL.md), en el orden en que se hacen y
//                          sin numerar: es un flujo, no un checklist rígido.
//                          Lo que todavía no existe aparece en su lugar como
//                          "en construcción".
//   Reportes               vistas de solo consulta, para ver cómo va todo.
//   Administración         el ciclo de semestres (admin y jefa de división).

// `abrir` es el nombre del handler que recibe HomePage; sin él, el paso está
// en construcción. `nota` es contexto del procedimiento (fechas, sistemas).
const FASES = [
  {
    titulo: 'Preparación',
    pasos: [
      {
        titulo: 'Revisar el catálogo de materias',
        texto: 'Que las materias del departamento estén completas y correctas: clave, nombre, créditos y si siguen activas.',
        abrir: 'onAbrirCatalogoMaterias',
      },
    ],
  },
  {
    titulo: 'Preferencias de profesores',
    pasos: [
      {
        titulo: 'Editar y publicar el formulario',
        texto: 'Las secciones, materias, preguntas y textos que verán todos los profesores, y publicarlo para que lo contesten.',
        nota: 'Primavera: se pide la 3ª semana de septiembre, para tener todo a inicios de octubre. Otoño: alrededor de la 2ª semana de marzo.',
        abrir: 'onAbrirEditor',
        estado: 'publicacion',
      },
    ],
  },
  {
    titulo: 'Construcción de la malla',
    pasos: [
      {
        // Va aquí y no en Preparación: el PDF de Servicios Escolares llega
        // DESPUÉS de que los profesores contestan el formulario (aclaración
        // de la usuaria, 2026-09-29), y hace falta antes de asignar la malla.
        titulo: 'Cargar la estimación de demanda',
        texto: 'Subir el PDF de Servicios Escolares con los grupos sugeridos por materia.',
        nota: 'Llega después de que los profesores contestan el formulario.',
        abrir: 'onAbrirCargaDemanda',
      },
      {
        titulo: 'Bloquear materias a profesores',
        texto: 'Con las respuestas en mano, marcar qué materias no le toca dar a quién antes de correr el algoritmo.',
        abrir: 'onAbrirRespuestas',
      },
      {
        titulo: 'Asignar la malla',
        texto: 'Correr el algoritmo que propone profesor, horario y salón para cada grupo.',
      },
      {
        titulo: 'Revisar y ajustar la malla',
        texto: 'Revisar la propuesta, mover lo que haga falta y resolver empalmes.',
      },
    ],
  },
  {
    titulo: 'Asignación a profesores',
    pasos: [
      {
        titulo: 'Publicar la malla y enviar las cartas de asignación',
        texto: 'Confirmar la asignación final y mandar a cada profesor su carta con los cursos que le tocaron.',
        nota: 'Tiempo completo: noviembre (primavera) y mayo (otoño). Asignatura: mediados de diciembre y de junio.',
      },
    ],
  },
  {
    titulo: 'Inscripciones',
    pasos: [
      {
        titulo: 'Cancelaciones y reasignaciones de grupos',
        texto: 'Avisar a los profesores de asignatura cuando su grupo se cancela o pasa a un profesor de tiempo completo.',
        nota: 'Empalmes y listas de espera se siguen resolviendo en merlin.itam.mx.',
      },
    ],
  },
];

// Reportes "próximamente" por rol.
const REPORTES_PENDIENTES_POR_ROL = {
  servicios_escolares: ['Panel de Servicios Escolares'],
  nomina: ['Reporte de horas para Nómina'],
};

export default function HomePage(handlers) {
  const { onAbrirFormulario, onAbrirPanelPreferencias, onAbrirDemanda, onAbrirSemestres } = handlers;
  const { profesor, nombreDepartamento, formularioPublicado, semestre } = useAuth();

  const daClases = Boolean(profesor.tipo_contrato);
  const gestion = esGestion(profesor.rol);
  const administra = veTodosLosDepartamentos(profesor.rol);
  const reportesPendientes = REPORTES_PENDIENTES_POR_ROL[profesor.rol] ?? [];
  const hayReportes = gestion || reportesPendientes.length > 0;

  function renderPaso(paso) {
    const onClick = paso.abrir ? handlers[paso.abrir] : null;
    const contenido = (
      <>
        <span className="paso-punto" aria-hidden="true" />
        <span className="paso-cuerpo">
          <strong>
            {paso.titulo}
            {paso.estado === 'publicacion' && (
              <span className={`badge ${formularioPublicado ? 'badge-enviado' : 'badge-no_iniciado'}`}>
                {formularioPublicado ? 'Publicado' : 'Sin publicar'}
              </span>
            )}
            {!onClick && <span className="badge badge-no_iniciado">En construcción</span>}
          </strong>
          <span>{paso.texto}</span>
          {paso.nota && <span className="paso-nota">{paso.nota}</span>}
        </span>
      </>
    );
    return (
      <li key={paso.titulo}>
        {onClick ? (
          <button className="paso paso-activo" onClick={onClick}>
            {contenido}
          </button>
        ) : (
          <div className="paso paso-pendiente">{contenido}</div>
        )}
      </li>
    );
  }

  return (
    <div className="home-screen">
      <header className="home-header">
        <div>
          <h1>Hola, {profesor.nombre}</h1>
          <p className="home-subtitle">
            {etiquetaRol(profesor.rol)}
            {profesor.departamento_id && ` · ${nombreDepartamento(profesor.departamento_id)}`}
          </p>
        </div>
      </header>

      <main className="home-main">
        {daClases && (
          <section className="home-seccion" aria-labelledby="home-formulario">
            <h2 id="home-formulario">Mi formulario</h2>
            <div className="opciones-grid">
              <button className="opcion-card opcion-activa" onClick={onAbrirFormulario}>
                <strong>
                  Contestar mi formulario de preferencias
                  {!formularioPublicado && <span className="badge badge-no_iniciado">Aún no disponible</span>}
                </strong>
                <span>Declara las materias y horarios que prefieres para {etiquetaSemestre(semestre)}.</span>
              </button>
            </div>
          </section>
        )}

        {gestion && (
          <section className="home-seccion" aria-labelledby="home-proceso">
            <h2 id="home-proceso">Proceso del semestre · {etiquetaSemestre(semestre)}</h2>
            {FASES.map((fase) => (
              <div className="fase" key={fase.titulo}>
                <h3>{fase.titulo}</h3>
                <ol className="pasos">{fase.pasos.map(renderPaso)}</ol>
              </div>
            ))}
          </section>
        )}

        {hayReportes && (
          <section className="home-seccion" aria-labelledby="home-reportes">
            <h2 id="home-reportes">Reportes</h2>
            <div className="opciones-grid">
              {gestion && (
                <button className="opcion-card opcion-activa" onClick={onAbrirPanelPreferencias}>
                  <strong>Preferencias recibidas</strong>
                  <span>
                    Quién ya respondió el formulario y quién falta, y reabrirlo si alguien necesita
                    corregir algo.
                  </span>
                </button>
              )}
              {gestion && (
                <button className="opcion-card opcion-activa" onClick={onAbrirDemanda}>
                  <strong>Demanda del semestre</strong>
                  <span>La estimación de Servicios Escolares cargada: grupos sugeridos por materia.</span>
                </button>
              )}
              {gestion && (
                <div className="opcion-card opcion-pendiente">
                  <strong>Cobertura: grupos sugeridos contra profesores disponibles</strong>
                  <span>Todavía no está construida — próximamente.</span>
                </div>
              )}
              {reportesPendientes.map((titulo) => (
                <div className="opcion-card opcion-pendiente" key={titulo}>
                  <strong>{titulo}</strong>
                  <span>Todavía no está construida — próximamente.</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {administra && (
          <section className="home-seccion" aria-labelledby="home-admin">
            <h2 id="home-admin">Administración</h2>
            <div className="opciones-grid">
              <button className="opcion-card opcion-activa" onClick={onAbrirSemestres}>
                <strong>Semestres</strong>
                <span>
                  Abrir el siguiente semestre cuando empieza la planeación, y consultar los anteriores.
                </span>
              </button>
            </div>
          </section>
        )}

        {!daClases && !gestion && !hayReportes && (
          <p className="home-vacio">Tu cuenta no tiene ninguna vista disponible todavía.</p>
        )}

        <p className="home-contacto">
          ¿Dudas o comentarios? Escríbeme a{' '}
          <a href="mailto:paulina.garza@itam.mx">paulina.garza@itam.mx</a>
        </p>
      </main>
    </div>
  );
}
