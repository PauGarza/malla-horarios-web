import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  cuestionario as cargarCuestionario,
  guardarPreferencia,
  leerFormulario,
  leerPreferencia,
  preferenciaDeProfesor,
} from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { TIPO_CONTRATO_LABELS } from '../lib/roles';
import {
  claveDisponibilidad,
  cuestionarioParaContrato,
  faltantesParaEnviar,
  formatearRatio,
  franjasDeDepartamento,
  horasMinimasVerde,
  minimoEfectivo,
} from '../lib/formulario';
import {
  LeyendaDisponibilidad,
  MateriaInfo,
  RejillaDisponibilidad,
  TriToggle,
} from '../components/FormularioPiezas';

// Una franja sin marcar ES rojo para el motor (2026-10-09), y desde 2026-10-13
// la rejilla lo muestra así: arranca toda en rojo claro y el profesor solo
// pinta lo que sí puede. El clic va sin marcar -> verde -> amarillo -> sin
// marcar. Un 'rojo' explícito de un borrador viejo se ve igual que sin marcar
// y su siguiente clic es verde (indexOf da -1).
const NIVELES_REJILLA = ['verde', 'amarillo'];

function siguienteNivel(actual) {
  const idx = actual ? NIVELES_REJILLA.indexOf(actual) : -1;
  return idx === NIVELES_REJILLA.length - 1 ? undefined : NIVELES_REJILLA[idx + 1];
}

/** "El mínimo sale de lo que contestaste: 6 h por 2 cursos + 1 h para … = 7 h, × 1.5 …" */
function ExplicacionMinimo({ numCursos, base, extra, minimo, ratio }) {
  let texto = `El mínimo sale de lo que contestaste: ${numCursos * 3} h por ${numCursos} ${
    numCursos === 1 ? 'curso' : 'cursos'
  }`;
  if (extra > 0) {
    texto += ` + ${extra} h para que quepa tu materia más larga en verde (${3 + extra} h a la semana)`;
  }
  if (ratio !== 1) {
    texto += ` = ${base} h, × ${formatearRatio(ratio)} que pide tu departamento`;
    if (minimo !== base * ratio) texto += ', redondeado a la media hora';
  }
  return `${texto}.`;
}

// Desde 2026-09-28 el formulario no está escrito aquí: lo arma la jefatura en
// su editor (secciones de materias, preguntas abiertas, textos y mínimos) y el
// servidor lo manda ya resuelto para el contrato de esta persona. Esta pantalla
// solo recorre `secciones` y dibuja cada una según su tipo.
//
// `prueba` = { departamentoId, tipoContrato }: el formulario de prueba del
// admin (2026-10-13). Se llena igual que el de un profesor de ese
// departamento y contrato, con las mismas validaciones, pero nada viaja al
// servidor: ni el borrador ni el envío se guardan.
export default function FormularioPreferencias({
  onVolver,
  profesorObjetivo = null,
  soloLecturaForzada = false,
  prueba = null,
  // { posicion, total, anterior, siguiente }: al revisar los formularios
  // desde Preferencias recibidas, para pasar al de otro profesor sin volver.
  navegacion = null,
}) {
  const { token, profesor, semestre, franjas, nombreDepartamento } = useAuth();
  // Un Jefe de Departamento puede abrir el formulario YA CONTESTADO de otro
  // profesor desde el panel; en ese caso todo se arma alrededor de esa persona,
  // no de quien tiene la sesión abierta. En modo prueba, alrededor de un
  // profesor imaginario.
  const profesorForm = prueba
    ? {
        id: null,
        nombre: 'Formulario de prueba',
        departamento_id: prueba.departamentoId,
        tipo_contrato: prueba.tipoContrato,
      }
    : (profesorObjetivo ?? profesor);
  const franjasForm = useMemo(
    () => franjasDeDepartamento(franjas, profesorForm.departamento_id),
    [franjas, profesorForm.departamento_id],
  );

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  // semestre y franjas ya vienen del contexto (los trae catalogos.php al
  // arrancar la sesión), así que esta pantalla ya no los pide.
  const [publicado, setPublicado] = useState(true);
  const [secciones, setSecciones] = useState([]);
  const [textoIntroduccion, setTextoIntroduccion] = useState('');
  // Ya resuelto para el contrato de esta persona (asignatura = 1).
  const [ratioHorasVerde, setRatioHorasVerde] = useState(1);

  const [estado, setEstado] = useState('borrador');
  const [numCursosMax, setNumCursosMax] = useState(1);
  const [nivelMaterias, setNivelMaterias] = useState({});
  const [nivelDisponibilidad, setNivelDisponibilidad] = useState({});
  const [respuestas, setRespuestas] = useState({});

  const soloLectura = soloLecturaForzada || estado === 'enviado';

  // Los botones están al final de un formulario largo y los mensajes arriba:
  // sin esto el profesor enviaba y no veía ninguna confirmación (ni el error de
  // lo que le faltaba), y se quedaba con la duda de si se había mandado.
  const avisosRef = useRef(null);
  useEffect(() => {
    if (mensaje || error) avisosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [mensaje, error]);

  // Dependencias primitivas, no el objeto: si el padre construye
  // profesorObjetivo en cada render, depender del objeto reinicia el efecto en
  // bucle y dispara fetches sin parar.
  const profesorId = profesorForm.id;
  const esDeOtro = Boolean(profesorObjetivo);
  const esPrueba = Boolean(prueba);
  const pruebaDepto = prueba?.departamentoId ?? null;
  const pruebaContrato = prueba?.tipoContrato ?? null;

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        if (!semestre) throw new Error('No hay ningún semestre configurado todavía.');

        // Cuando el Jefe abre el formulario de OTRA persona, todo viene de
        // panel.php?profesor_id=N: el formulario que se muestra es el que vio
        // quien lo llenó, no el de quien lo consulta.
        // En modo prueba, del editor (configuracion.php): el formulario
        // completo del departamento, recortado para el contrato elegido, y sin
        // preferencia guardada (siempre arranca en blanco).
        const [cuest, prefDatos] = esPrueba
          ? await leerFormulario(token, semestre.id, pruebaDepto).then((d) => [
              cuestionarioParaContrato(d, pruebaContrato),
              { preferencia: null },
            ])
          : esDeOtro
          ? await preferenciaDeProfesor(token, semestre.id, profesorId).then((d) => [
              d.cuestionario,
              d,
            ])
          : await Promise.all([
              cargarCuestionario(token, semestre.id),
              leerPreferencia(token, semestre.id),
            ]);

        if (cancelado) return;

        // La vista de solo lectura del jefe no depende de que esté publicado.
        setPublicado(esDeOtro || cuest.publicado);
        setSecciones(cuest.secciones ?? []);
        setTextoIntroduccion(cuest.texto_introduccion ?? '');
        setRatioHorasVerde(cuest.ratio_horas_verde ?? 1);

        // Todas las materias arrancan en amarillo: "la puedo dar si hace
        // falta" es el default honesto, y así el motor recibe una señal de
        // todas y no solo de las que alguien alcanzó a tocar.
        const materias = (cuest.secciones ?? []).flatMap((s) => s.materias ?? []);
        const nivelesPorDefecto = Object.fromEntries(materias.map((m) => [m.id, 'amarillo']));

        const pref = prefDatos.preferencia;
        if (pref) {
          setEstado(pref.estado);
          // null si se guardó cuando la pregunta de número de cursos era
          // opcional (2026-10-02 a 2026-10-13): arranca en 1.
          setNumCursosMax(pref.num_cursos_max ?? 1);
          // El merge deja en amarillo cualquier materia que la jefatura haya
          // agregado al formulario después de que se guardó el borrador.
          setNivelMaterias({
            ...nivelesPorDefecto,
            ...Object.fromEntries(prefDatos.materias.map((m) => [m.materia_id, m.nivel])),
          });
          setNivelDisponibilidad(
            Object.fromEntries(
              prefDatos.disponibilidad.map((d) => [claveDisponibilidad(d.dia, d.franja_id), d.nivel]),
            ),
          );
          setRespuestas(
            Object.fromEntries((prefDatos.respuestas ?? []).map((r) => [r.seccion_id, r.texto])),
          );
        } else {
          setNivelMaterias(nivelesPorDefecto);
        }
      } catch (err) {
        if (!cancelado) setError(err.message);
      } finally {
        if (!cancelado) setCargando(false);
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [token, semestre, profesorId, esDeOtro, esPrueba, pruebaDepto, pruebaContrato]);

  const hayMaterias = secciones.some((s) => s.tipo === 'materias');

  const horasVerdeSemana = useMemo(
    () => Object.values(nivelDisponibilidad).filter((n) => n === 'verde').length * 0.5,
    [nivelDisponibilidad],
  );

  // Se recalcula al cambiar el número de cursos o al poner una materia en verde.
  const horasMinimas = useMemo(
    () =>
      horasMinimasVerde({
        numCursos: numCursosMax,
        secciones,
        niveles: nivelMaterias,
        ratio: ratioHorasVerde,
      }),
    [numCursosMax, secciones, nivelMaterias, ratioHorasVerde],
  );

  function alternarMateria(materiaId, nivel) {
    if (soloLectura) return;
    setNivelMaterias((prev) => ({
      ...prev,
      // Con el default en amarillo, "des-seleccionar" es volver a amarillo, no
      // dejar la materia sin respuesta.
      [materiaId]: prev[materiaId] === nivel ? 'amarillo' : nivel,
    }));
  }

  // --- Rejilla de disponibilidad: pintar arrastrando -----------------------
  // El estado del arrastre vive en un ref: empezar a arrastrar no tiene por qué
  // provocar un render, y así los handlers pueden ser estables y dejar que el
  // memo de SlotCelda corte las ~111 celdas que no cambiaron.
  const arrastre = useRef({ activo: false, valor: undefined });

  const pintarSlot = useCallback((clave, valor) => {
    setNivelDisponibilidad((prev) => {
      if (prev[clave] === valor) return prev; // sin cambio real, sin render
      const siguiente = { ...prev };
      if (valor === undefined) delete siguiente[clave];
      else siguiente[clave] = valor;
      return siguiente;
    });
  }, []);

  // Avanza una franja al siguiente color. `arrastrando` distingue el clic (que
  // además arma el arrastre) del Enter del teclado (que no debe dejarlo activo).
  const ciclarSlot = useCallback((clave, arrastrando) => {
    setNivelDisponibilidad((prev) => {
      const valor = siguienteNivel(prev[clave]);
      if (arrastrando) arrastre.current = { activo: true, valor };
      if (prev[clave] === valor) return prev;
      const siguiente = { ...prev };
      if (valor === undefined) delete siguiente[clave];
      else siguiente[clave] = valor;
      return siguiente;
    });
  }, []);

  const iniciarPintado = useCallback((clave) => ciclarSlot(clave, true), [ciclarSlot]);
  const ciclarConTeclado = useCallback((clave) => ciclarSlot(clave, false), [ciclarSlot]);

  const continuarPintado = useCallback(
    (clave) => {
      if (!arrastre.current.activo) return;
      pintarSlot(clave, arrastre.current.valor);
    },
    [pintarSlot],
  );

  useEffect(() => {
    const fin = () => {
      arrastre.current.activo = false;
    };
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
    // Sin esto, cambiar de ventana con el botón presionado deja el arrastre
    // "pegado" y la rejilla se sigue pintando sola al volver.
    window.addEventListener('blur', fin);
    return () => {
      window.removeEventListener('pointerup', fin);
      window.removeEventListener('pointercancel', fin);
      window.removeEventListener('blur', fin);
    };
  }, []);

  // En touch, pointerenter no se dispara en las celdas vecinas aunque se libere
  // la captura, así que se resuelve a mano con la celda que haya bajo el dedo.
  function moverSobreRejilla(e) {
    if (!arrastre.current.activo) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const clave = el?.dataset?.clave;
    if (clave) continuarPintado(clave);
  }

  // Guarda por "reemplazo completo": el servidor borra las filas de esta
  // preferencia y vuelve a insertar el estado actual del formulario, todo en
  // una transacción.
  async function guardar(nuevoEstado) {
    setError('');
    setMensaje('');
    if (nuevoEstado === 'enviado') {
      // Se juntan todos los faltantes en un solo mensaje: ir descubriéndolos
      // de uno en uno, reintento tras reintento, es la peor versión de esto.
      const faltantes = faltantesParaEnviar({
        secciones,
        horasMinimasVerde: horasMinimas.minimo,
        niveles: nivelMaterias,
        respuestas,
        horasVerde: horasVerdeSemana,
      });
      // Nada de esto bloquea guardar borrador: un borrador a medias es válido.
      if (faltantes.length > 0) {
        setError(`Antes de enviar te falta: ${faltantes.join('; ')}.`);
        return;
      }
    }
    if (esPrueba) {
      // Lo único que en el formulario real revisa solo el servidor
      // (preferencia.php), para que la prueba rebote donde rebotaría.
      if (!Number.isInteger(numCursosMax) || numCursosMax < 1 || numCursosMax > 6) {
        setError('El número de cursos debe estar entre 1 y 6');
        return;
      }
      // Nada viaja al servidor.
      setEstado(nuevoEstado);
      setMensaje(
        nuevoEstado === 'enviado'
          ? '✓ Prueba: el formulario se habría enviado. No se guardó nada.'
          : '✓ Prueba: el borrador se habría guardado. No se guardó nada.',
      );
      return;
    }
    setGuardando(true);
    try {
      // Solo las materias que están en el formulario: un borrador viejo puede
      // traer materias que la jefatura ya quitó.
      const materias = secciones.flatMap((s) => s.materias ?? []);
      const filasMaterias = materias
        .filter((m) => nivelMaterias[m.id])
        .map((m) => ({ materia_id: m.id, nivel: nivelMaterias[m.id] }));

      const filasDisponibilidad = Object.entries(nivelDisponibilidad).map(([clave, nivel]) => {
        const [dia, franjaId] = clave.split('-');
        return { dia, franja_id: Number(franjaId), nivel };
      });

      const filasRespuestas = secciones
        .filter((s) => s.tipo === 'abierta' && (respuestas[s.id] ?? '').trim())
        .map((s) => ({ seccion_id: s.id, texto: respuestas[s.id] }));

      // profesor_id no viaja: el endpoint usa el del token y solo el del
      // token. enviado_at tampoco: lo pone el servidor, en UTC.
      // cobertura_departamental tampoco: sale de la sección donde la jefatura
      // puso cada materia.
      await guardarPreferencia(token, semestre.id, {
        num_cursos_max: numCursosMax,
        estado: nuevoEstado,
        materias: filasMaterias,
        disponibilidad: filasDisponibilidad,
        respuestas: filasRespuestas,
      });

      setEstado(nuevoEstado);
      setMensaje(
        nuevoEstado === 'enviado'
          ? '✓ Formulario enviado correctamente. Tu Jefe de Departamento ya puede ver tus preferencias; desde ahora el formulario queda en solo lectura.'
          : '✓ Borrador guardado. Puedes volver a editarlo cuando quieras; recuerda enviarlo al terminar.',
      );
    } catch (err) {
      if (err.codigo === 'ya_enviada') {
        // Lo más probable: un "Enviar" anterior SÍ llegó y se perdió la
        // respuesta (red lenta), y esto es el reintento. Mostrarlo como error
        // haría creer que no se envió. La pantalla pasa a solo lectura.
        setEstado('enviado');
        setMensaje('Tus preferencias ya estaban enviadas. Si necesitas cambiarlas, pide a tu Jefe de Departamento que reabra el formulario.');
      } else {
        setError(err.message);
      }
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <div className="formulario-cargando">Cargando…</div>;

  const encabezado = (
    <header className="formulario-header">
      <div className="formulario-header-barra">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        {navegacion && (
          <nav className="formulario-navegacion" aria-label="Otros formularios">
            <button
              className="btn-secondary"
              disabled={!navegacion.anterior}
              onClick={navegacion.anterior?.ir}
              title={navegacion.anterior ? `Anterior: ${navegacion.anterior.nombre}` : undefined}
            >
              ← Anterior
            </button>
            <span>
              {navegacion.posicion} de {navegacion.total}
            </span>
            <button
              className="btn-secondary"
              disabled={!navegacion.siguiente}
              onClick={navegacion.siguiente?.ir}
              title={navegacion.siguiente ? `Siguiente: ${navegacion.siguiente.nombre}` : undefined}
            >
              Siguiente →
            </button>
          </nav>
        )}
      </div>
      <div className="formulario-header-datos">
        <div>
          <strong>{profesorForm.nombre}</strong>
          <span>
            {nombreDepartamento(profesorForm.departamento_id)} ·{' '}
            {TIPO_CONTRATO_LABELS[profesorForm.tipo_contrato] ?? profesorForm.tipo_contrato} ·{' '}
            {etiquetaSemestre(semestre)}
          </span>
        </div>
        {publicado && (
          <span className={`badge badge-${estado}`}>
            {estado === 'enviado' ? 'Enviado' : 'Borrador'}
          </span>
        )}
      </div>
    </header>
  );

  if (!publicado) {
    return (
      <div className="formulario-screen">
        {encabezado}
        {error && <p className="formulario-error">{error}</p>}
        <section className="formulario-seccion">
          <h2>Todavía no está disponible</h2>
          <p className="formulario-nota">
            El formulario de preferencias de {etiquetaSemestre(semestre)} todavía no está abierto.
            Tu Jefe de Departamento te avisará cuando puedas contestarlo.
          </p>
        </section>
      </div>
    );
  }

  function renderSeccion(s) {
    if (s.tipo === 'num_cursos') {
      // Se muestra aunque no haya materias que elegir: de aquí sale el mínimo
      // de horas en verde, y el motor la necesita igual.
      return (
        <section className="formulario-seccion" key={s.id}>
          <label htmlFor="num_cursos_max">{s.titulo}</label>
          {s.descripcion && <p className="formulario-nota texto-libre">{s.descripcion}</p>}
          <input
            id="num_cursos_max"
            type="number"
            min={1}
            max={6}
            value={numCursosMax}
            disabled={soloLectura}
            onChange={(e) => setNumCursosMax(Number(e.target.value))}
          />
        </section>
      );
    }

    if (s.tipo === 'materias') {
      const minimo = minimoEfectivo(s);
      const verdes = s.materias.filter((m) => nivelMaterias[m.id] === 'verde').length;
      return (
        <section className="formulario-seccion" key={s.id}>
          <div className="materias-bloque-encabezado">
            <h2>{s.titulo}</h2>
            {minimo > 0 && (
              <span className={`counter ${verdes >= minimo ? 'ok' : 'low'}`}>
                {verdes} en verde (mínimo {minimo})
              </span>
            )}
          </div>
          {s.descripcion && <p className="formulario-nota texto-libre">{s.descripcion}</p>}
          <div className="materias-lista">
            {s.materias.map((m) => (
              <div className="materia-fila" key={m.id}>
                <MateriaInfo materia={m} />
                <TriToggle
                  valor={nivelMaterias[m.id]}
                  disabled={soloLectura}
                  onCambiar={(nivel) => alternarMateria(m.id, nivel)}
                />
              </div>
            ))}
          </div>
        </section>
      );
    }

    if (s.tipo === 'disponibilidad') {
      return (
        <section className="formulario-seccion" key={s.id}>
          <h2>{s.titulo}</h2>
          <p
            className={`formulario-nota ${horasVerdeSemana >= horasMinimas.minimo ? 'nota-ok' : 'nota-falta'}`}
          >
            {horasVerdeSemana} hrs en verde marcadas de {horasMinimas.minimo} hrs mínimo para poder
            enviar.
          </p>
          <p className="formulario-nota">
            <ExplicacionMinimo numCursos={numCursosMax} ratio={ratioHorasVerde} {...horasMinimas} />
          </p>
          <LeyendaDisponibilidad />
          {!soloLectura && s.descripcion && (
            <p className="formulario-nota texto-libre" id="ayuda-rejilla">
              {s.descripcion}
            </p>
          )}
          <RejillaDisponibilidad
            franjas={franjasForm}
            niveles={nivelDisponibilidad}
            disabled={soloLectura}
            ayudaId="ayuda-rejilla"
            onIniciar={iniciarPintado}
            onContinuar={continuarPintado}
            onTeclado={ciclarConTeclado}
            onPointerMove={moverSobreRejilla}
          />
        </section>
      );
    }

    // abierta
    const idCampo = `respuesta-${s.id}`;
    return (
      <section className="formulario-seccion" key={s.id}>
        <label htmlFor={idCampo}>
          {s.titulo}
          {s.obligatoria && <span className="obligatoria"> *</span>}
        </label>
        {s.descripcion && <p className="formulario-nota texto-libre">{s.descripcion}</p>}
        <textarea
          id={idCampo}
          value={respuestas[s.id] ?? ''}
          disabled={soloLectura}
          required={s.obligatoria}
          onChange={(e) => setRespuestas((prev) => ({ ...prev, [s.id]: e.target.value }))}
        />
      </section>
    );
  }

  return (
    <div className="formulario-screen">
      {encabezado}

      <div ref={avisosRef} className="formulario-avisos" role="status" aria-live="polite">
        {error && <p className="formulario-error">{error}</p>}
        {mensaje && <p className="formulario-mensaje">{mensaje}</p>}
      </div>
      {esPrueba ? (
        <div className="formulario-aviso">
          <p>
            <strong>Modo prueba.</strong> Así ve el formulario un profesor de{' '}
            {TIPO_CONTRATO_LABELS[pruebaContrato]} de {nombreDepartamento(pruebaDepto)}, con las mismas
            validaciones. Nada de lo que hagas aquí se guarda.
            {soloLectura && ' Así queda el formulario después de enviarlo.'}
          </p>
          {soloLectura && (
            <button type="button" className="btn-secondary" onClick={() => setEstado('borrador')}>
              Seguir editando la prueba
            </button>
          )}
        </div>
      ) : soloLecturaForzada ? (
        <p className="formulario-aviso">
          Estás viendo el formulario de {profesorForm.nombre} — solo lectura.
        </p>
      ) : (
        // Recién enviado, la confirmación verde ya dice lo mismo.
        soloLectura &&
        !mensaje && (
          <p className="formulario-aviso">
            Ya enviaste tus preferencias — solo lectura. Si necesitas cambiar algo, pídele a tu Jefe de
            Departamento que la reabra.
          </p>
        )
      )}

      {hayMaterias && textoIntroduccion && (
        <section className="formulario-seccion">
          <p className="formulario-nota texto-libre">{textoIntroduccion}</p>
        </section>
      )}

      {!hayMaterias && (
        <section className="formulario-seccion">
          <p className="formulario-nota">
            Este semestre no se eligen materias: solo di cuántos cursos puedes impartir y tu
            disponibilidad de horario.
          </p>
        </section>
      )}

      {secciones.map(renderSeccion)}

      {!soloLectura && (
        <footer className="formulario-acciones">
          <button className="btn-secondary" disabled={guardando} onClick={() => guardar('borrador')}>
            Guardar borrador
          </button>
          <button
            className="btn-primary"
            disabled={guardando}
            onClick={() => {
              const pregunta = esPrueba
                ? '¿Enviar la prueba? Se valida como un envío real, pero no se guarda nada.'
                : '¿Enviar tus preferencias? Ya no podrás editarlas tú mismo después.';
              if (window.confirm(pregunta)) {
                guardar('enviado');
              }
            }}
          >
            Enviar
          </button>
        </footer>
      )}
    </div>
  );
}
