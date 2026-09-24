import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';

const NIVELES = ['verde', 'amarillo', 'rojo'];
const TIPO_CONTRATO_LABELS = {
  tiempo_completo: 'Tiempo Completo',
  medio_tiempo: 'Medio Tiempo',
  asignatura: 'Asignatura',
};

// Quiénes ven el bloque de cobertura departamental. Medio tiempo va aquí junto
// con tiempo completo: son justo los cursos que "necesitan que varios profesores
// de tiempo completo o medio tiempo los impartan" (BITACORA 2026-08-21).
// Asignatura no lo ve — esas materias le aparecen mezcladas en el catálogo.
const CONTRATOS_COBERTURA = ['tiempo_completo', 'medio_tiempo'];

// Mínimos de verdes que exigen los formularios actuales, ahora expresados como
// "en verde" en vez de checkboxes. Son constantes del archivo y no config de
// base porque hoy son iguales en los 3 departamentos; si eso cambia, el lugar
// natural es departamento_semestre_config, junto a horas_minimas_verde.
const MIN_COBERTURA = 2;
const MIN_GENERAL = 5;

function claveDisponibilidad(dia, franjaId) {
  return `${dia}-${franjaId}`;
}

const DIAS = [
  { valor: 'lunes', etiqueta: 'Lun' },
  { valor: 'martes', etiqueta: 'Mar' },
  { valor: 'miercoles', etiqueta: 'Mié' },
  { valor: 'jueves', etiqueta: 'Jue' },
  { valor: 'viernes', etiqueta: 'Vie' },
];

function siguienteNivel(actual) {
  const idx = actual ? NIVELES.indexOf(actual) : -1;
  return idx === NIVELES.length - 1 ? undefined : NIVELES[idx + 1];
}

export default function FormularioPreferencias({
  onVolver,
  profesorObjetivo = null,
  soloLecturaForzada = false,
}) {
  const { token, profesor, nombreDepartamento } = useAuth();
  // Un Jefe de Departamento puede abrir el formulario YA CONTESTADO de otro
  // profesor desde el panel; en ese caso todo se arma alrededor de esa persona,
  // no de quien tiene la sesión abierta.
  const profesorForm = profesorObjetivo ?? profesor;

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const [semestre, setSemestre] = useState(null);
  const [franjas, setFranjas] = useState([]);
  const [materias, setMaterias] = useState([]);
  const [mostrarMaterias, setMostrarMaterias] = useState(true);
  const [horasMinimasVerde, setHorasMinimasVerde] = useState(10);

  const [preferenciaId, setPreferenciaId] = useState(null);
  const [estado, setEstado] = useState('borrador');
  const [numCursosMax, setNumCursosMax] = useState(1);
  const [horariosOtroDepto, setHorariosOtroDepto] = useState('');
  const [observacionesCursos, setObservacionesCursos] = useState('');
  const [observacionesHorarios, setObservacionesHorarios] = useState('');
  const [nivelMaterias, setNivelMaterias] = useState({});
  const [nivelDisponibilidad, setNivelDisponibilidad] = useState({});

  const esAsignatura = profesorForm.tipo_contrato === 'asignatura';
  const veCobertura = CONTRATOS_COBERTURA.includes(profesorForm.tipo_contrato);
  const soloLectura = soloLecturaForzada || estado === 'enviado';

  // Dependencias primitivas, no el objeto: si el padre construye
  // profesorObjetivo en cada render, depender del objeto reinicia el efecto en
  // bucle y dispara fetches sin parar.
  const profesorId = profesorForm.id;
  const profesorDepartamentoId = profesorForm.departamento_id;
  const profesorModoMaterias = profesorForm.modo_materias_elegibles;

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const [semestres, franjasData] = await Promise.all([
          apiFetch('/semestre?select=id,tipo,anio,etiqueta&order=id.desc&limit=1', token),
          apiFetch('/franja_horaria?select=id,hora_inicio,hora_fin,orden&order=orden.asc', token),
        ]);
        const sem = semestres[0];
        if (!sem) throw new Error('No hay ningún semestre configurado todavía.');
        if (cancelado) return;
        setSemestre(sem);
        setFranjas(franjasData);

        // Config del departamento para este semestre — si no existe la fila,
        // se asume abierto (mostrar_seleccion_materias = true) y el mínimo de
        // D18 en GUIA-DECISIONES.md (10 hrs), ambos default de la propia tabla.
        let configDepto = null;
        if (profesorDepartamentoId) {
          const config = await apiFetch(
            `/departamento_semestre_config?select=mostrar_seleccion_materias,horas_minimas_verde&departamento_id=eq.${profesorDepartamentoId}&semestre_id=eq.${sem.id}`,
            token,
          );
          configDepto = config[0] ?? null;
        }
        if (cancelado) return;
        setHorasMinimasVerde(configDepto?.horas_minimas_verde ?? 10);
        const modoOk = profesorModoMaterias !== 'ninguna';
        const configOk = configDepto?.mostrar_seleccion_materias !== false;
        const mostrar = modoOk && configOk && Boolean(profesorDepartamentoId);
        setMostrarMaterias(mostrar);

        let catalogo = [];
        if (mostrar) {
          // El catálogo sale de materia_cuestionario, NO de estimacion_demanda:
          // qué materias se ofrecen en el cuestionario lo decide el Jefe de
          // Departamento y no puede depender de que Servicios Escolares ya haya
          // publicado su estimación de demanda del semestre (que para un
          // semestre próximo todavía no existe).
          const [materiasDepto, config] = await Promise.all([
            apiFetch(
              `/materia?select=id,clave,nombre&departamento_id=eq.${profesorDepartamentoId}&activa=eq.true`,
              token,
            ),
            apiFetch(
              `/materia_cuestionario?select=materia_id,seccion,alias_de_id,etiqueta,orden&semestre_id=eq.${sem.id}`,
              token,
            ),
          ]);

          const configPorMateria = new Map(config.map((c) => [c.materia_id, c]));
          const nombrePorId = new Map(materiasDepto.map((m) => [m.id, m.nombre]));
          // Una materia sin fila de config se trata como catálogo general
          // (fail-open): es preferible que sobre una materia a que el profesor
          // se quede con el cuestionario vacío.
          const seccionDe = (id) => configPorMateria.get(id)?.seccion ?? 'catalogo_general';

          // Las materias ocultas que son el nombre viejo de otra se muestran
          // como "(antes ...)" en la fila de esa otra, no como fila propia.
          const aliasPorVisible = new Map();
          for (const c of config) {
            if (c.seccion !== 'oculta' || !c.alias_de_id) continue;
            const nombre = c.etiqueta ?? nombrePorId.get(c.materia_id);
            if (!nombre) continue;
            const lista = aliasPorVisible.get(c.alias_de_id) ?? [];
            lista.push(nombre);
            aliasPorVisible.set(c.alias_de_id, lista);
          }

          catalogo = materiasDepto
            .filter((m) => seccionDe(m.id) !== 'oculta')
            .map((m) => {
              const c = configPorMateria.get(m.id);
              return {
                ...m,
                seccion: seccionDe(m.id),
                nombreMostrado: c?.etiqueta ?? m.nombre,
                alias: aliasPorVisible.get(m.id) ?? [],
                orden: c?.orden ?? null,
              };
            });

          // El filtro por lista personalizada va DESPUÉS de descartar las
          // ocultas: profesor_materia_elegible no tiene semestre, así que una
          // materia que el Jefe ocultó este semestre podría reaparecer por
          // seguir en la lista personalizada de alguien.
          if (profesorModoMaterias === 'personalizada') {
            const elegibles = await apiFetch(
              `/profesor_materia_elegible?select=materia_id&profesor_id=eq.${profesorId}`,
              token,
            );
            const idsElegibles = new Set(elegibles.map((e) => e.materia_id));
            catalogo = catalogo.filter((m) => idsElegibles.has(m.id));
          }

          catalogo.sort((a, b) => {
            if (a.orden !== b.orden) {
              if (a.orden === null) return 1;
              if (b.orden === null) return -1;
              return a.orden - b.orden;
            }
            return a.nombreMostrado.localeCompare(b.nombreMostrado, 'es');
          });
          if (!cancelado) setMaterias(catalogo);
        }

        // Todas las materias arrancan en amarillo, igual que el mockup que los
        // profesores ya revisaron: "la puedo dar si hace falta" es el default
        // honesto, y así el motor recibe una señal de todas y no solo de las
        // que alguien alcanzó a tocar.
        const nivelesPorDefecto = Object.fromEntries(catalogo.map((m) => [m.id, 'amarillo']));

        // Preferencia ya existente de este profesor para este semestre. Se
        // filtra por profesor_id explícitamente (no solo por RLS): un Jefe
        // de Departamento/admin llenando su PROPIO formulario también puede
        // ver, por RLS, las preferencias de todo su departamento
        // (departamento_preferencia_select) — sin este filtro se podía
        // cargar por error la preferencia de un colega. Mismo bug real que
        // en AuthContext.cargarPerfil, encontrado 2026-09-21.
        const preferencias = await apiFetch(
          `/preferencia?select=*&semestre_id=eq.${sem.id}&profesor_id=eq.${profesorId}`,
          token,
        );
        const pref = preferencias[0];
        if (pref && !cancelado) {
          setPreferenciaId(pref.id);
          setEstado(pref.estado);
          setNumCursosMax(pref.num_cursos_max);
          setHorariosOtroDepto(pref.horarios_otro_depto ?? '');
          setObservacionesCursos(pref.observaciones_cursos ?? '');
          setObservacionesHorarios(pref.observaciones_horarios ?? '');

          const [prefMaterias, disponibilidad] = await Promise.all([
            apiFetch(`/preferencia_materia?select=materia_id,nivel&preferencia_id=eq.${pref.id}`, token),
            apiFetch(`/disponibilidad?select=dia,franja_id,nivel&preferencia_id=eq.${pref.id}`, token),
          ]);
          if (!cancelado) {
            // El merge deja en amarillo cualquier materia que el Jefe haya
            // agregado al cuestionario después de que se guardó el borrador.
            setNivelMaterias({
              ...nivelesPorDefecto,
              ...Object.fromEntries(prefMaterias.map((m) => [m.materia_id, m.nivel])),
            });
            setNivelDisponibilidad(
              Object.fromEntries(
                disponibilidad.map((d) => [claveDisponibilidad(d.dia, d.franja_id), d.nivel]),
              ),
            );
          }
        } else if (!cancelado) {
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
  }, [token, profesorId, profesorDepartamentoId, profesorModoMaterias]);

  const materiasCobertura = useMemo(
    () => (veCobertura ? materias.filter((m) => m.seccion === 'cobertura_departamental') : []),
    [materias, veCobertura],
  );
  // Un profesor de asignatura ve las de cobertura mezcladas al final del
  // catálogo general, como en el mockup, y le cuentan para el mínimo de 5.
  const materiasGenerales = useMemo(
    () => (veCobertura ? materias.filter((m) => m.seccion !== 'cobertura_departamental') : materias),
    [materias, veCobertura],
  );

  const contarVerdes = (lista) => lista.filter((m) => nivelMaterias[m.id] === 'verde').length;
  const verdesCobertura = contarVerdes(materiasCobertura);
  const verdesGenerales = contarVerdes(materiasGenerales);

  // Los mínimos se acotan al tamaño real de cada lista: un profesor con lista
  // personalizada de 3 materias nunca podría enviar si le exigiéramos 5.
  const minCobertura = Math.min(MIN_COBERTURA, materiasCobertura.length);
  const minGeneral = Math.min(MIN_GENERAL, materiasGenerales.length);

  const horasVerdeSemana = useMemo(
    () => Object.values(nivelDisponibilidad).filter((n) => n === 'verde').length * 0.5,
    [nivelDisponibilidad],
  );
  const hayMateriasParaElegir = mostrarMaterias && materias.length > 0;

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
  // memo de SlotCelda corte las ~109 celdas que no cambiaron.
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

  // Guarda por "reemplazo completo": borra las filas de esta preferencia y
  // vuelve a insertar el estado actual del formulario. Más simple y menos
  // propenso a errores que diffear cambio por cambio — el volumen de datos
  // (decenas de filas) no justifica la complejidad de un autosave granular
  // para esta primera versión. Ver docs/mockup/cuestionario-profesores.md §3.6
  // para la ambición original de autosave, todavía no implementada así.
  async function guardar(nuevoEstado) {
    setError('');
    setMensaje('');
    if (nuevoEstado === 'enviado') {
      // Se juntan los tres faltantes en un solo mensaje: ir descubriéndolos de
      // uno en uno, reintento tras reintento, es la peor versión de esto.
      const faltantes = [];
      if (veCobertura && minCobertura > 0 && verdesCobertura < minCobertura) {
        faltantes.push(
          `${minCobertura} materias en verde en cobertura departamental (llevas ${verdesCobertura})`,
        );
      }
      if (minGeneral > 0 && verdesGenerales < minGeneral) {
        faltantes.push(`${minGeneral} materias en verde en el catálogo (llevas ${verdesGenerales})`);
      }
      // D18 (GUIA-DECISIONES.md): mínimo de horas en verde por semana,
      // configurable por departamento/semestre.
      if (horasVerdeSemana < horasMinimasVerde) {
        faltantes.push(`${horasMinimasVerde} hrs en verde de disponibilidad (llevas ${horasVerdeSemana})`);
      }
      // Nada de esto bloquea guardar borrador: un borrador a medias es válido.
      if (faltantes.length > 0) {
        setError(`Antes de enviar te falta marcar: ${faltantes.join('; ')}.`);
        return;
      }
    }
    setGuardando(true);
    try {
      let id = preferenciaId;
      const payloadPreferencia = {
        profesor_id: profesorId,
        semestre_id: semestre.id,
        num_cursos_max: numCursosMax,
        horarios_otro_depto: esAsignatura ? horariosOtroDepto || null : null,
        observaciones_cursos: observacionesCursos || null,
        observaciones_horarios: observacionesHorarios || null,
        estado: nuevoEstado,
        ...(nuevoEstado === 'enviado' ? { enviado_at: new Date().toISOString() } : {}),
      };

      if (id) {
        await apiFetch(`/preferencia?id=eq.${id}`, token, {
          method: 'PATCH',
          body: JSON.stringify(payloadPreferencia),
        });
      } else {
        const creada = await apiFetch('/preferencia', token, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(payloadPreferencia),
        });
        id = creada[0].id;
        setPreferenciaId(id);
      }

      await apiFetch(`/preferencia_materia?preferencia_id=eq.${id}`, token, { method: 'DELETE' });
      const seccionPorMateria = new Map(materias.map((m) => [m.id, m.seccion]));
      const filasMaterias = Object.entries(nivelMaterias)
        // Un borrador viejo puede traer materias que ya salieron del
        // cuestionario; insertarlas rompería el FK o ensuciaría el dato.
        .filter(([materiaId]) => seccionPorMateria.has(Number(materiaId)))
        .map(([materiaId, nivel]) => ({
          preferencia_id: id,
          materia_id: Number(materiaId),
          nivel,
          // Se deriva de la configuración del semestre, no de en qué lista se
          // pintó la fila: un profesor de asignatura ve estas materias
          // mezcladas en el catálogo y aun así son de cobertura departamental.
          cobertura_departamental:
            seccionPorMateria.get(Number(materiaId)) === 'cobertura_departamental',
        }));
      if (filasMaterias.length > 0) {
        await apiFetch('/preferencia_materia', token, {
          method: 'POST',
          body: JSON.stringify(filasMaterias),
        });
      }

      await apiFetch(`/disponibilidad?preferencia_id=eq.${id}`, token, { method: 'DELETE' });
      const filasDisponibilidad = Object.entries(nivelDisponibilidad).map(([clave, nivel]) => {
        const [dia, franjaId] = clave.split('-');
        return { preferencia_id: id, dia, franja_id: Number(franjaId), nivel };
      });
      if (filasDisponibilidad.length > 0) {
        await apiFetch('/disponibilidad', token, {
          method: 'POST',
          body: JSON.stringify(filasDisponibilidad),
        });
      }

      setEstado(nuevoEstado);
      setMensaje(nuevoEstado === 'enviado' ? 'Preferencias enviadas.' : 'Borrador guardado.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return <div className="formulario-cargando">Cargando…</div>;

  const listaMaterias = (lista) => (
    <div className="materias-lista">
      {lista.map((m) => (
        <div className="materia-fila" key={m.id}>
          <div className="materia-info">
            <span className="materia-nombre">{m.nombreMostrado}</span>
            {m.alias.length > 0 && <span className="materia-alias">(antes {m.alias.join(', ')})</span>}
            <span className="materia-clave">{m.clave}</span>
          </div>
          <TriToggle
            valor={nivelMaterias[m.id]}
            disabled={soloLectura}
            onCambiar={(nivel) => alternarMateria(m.id, nivel)}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="formulario-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>{profesorForm.nombre}</strong>
            <span>
              {nombreDepartamento(profesorForm.departamento_id)} ·{' '}
              {TIPO_CONTRATO_LABELS[profesorForm.tipo_contrato] ?? profesorForm.tipo_contrato} ·{' '}
              {etiquetaSemestre(semestre)}
            </span>
          </div>
          <span className={`badge badge-${estado}`}>
            {estado === 'enviado' ? 'Enviado' : 'Borrador'}
          </span>
        </div>
      </header>

      {error && <p className="formulario-error">{error}</p>}
      {mensaje && <p className="formulario-mensaje">{mensaje}</p>}
      {soloLecturaForzada ? (
        <p className="formulario-aviso">
          Estás viendo el formulario de {profesorForm.nombre} — solo lectura.
        </p>
      ) : (
        soloLectura && (
          <p className="formulario-aviso">
            Ya enviaste tus preferencias — solo lectura. Si necesitas cambiar algo, pídele a tu Jefe de
            Departamento que la reabra.
          </p>
        )
      )}

      {hayMateriasParaElegir && (
        <section className="formulario-seccion">
          <label htmlFor="num_cursos_max">¿Cuántos cursos puedes impartir este semestre?</label>
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
      )}

      {!mostrarMaterias && (
        <section className="formulario-seccion">
          <p className="formulario-nota">
            Tu Jefe de Departamento no habilitó selección de materias este semestre — solo declara tu
            disponibilidad de horario abajo.
          </p>
        </section>
      )}

      {hayMateriasParaElegir && (
        <section className="formulario-seccion">
          <h2>Preferencia de materias</h2>
          <p className="formulario-nota">
            Marca cada materia según <strong>si puedes impartirla</strong>: verde (sí, con gusto),
            amarillo (sí puedo, aunque no es mi primera opción), rojo (no puedo — por ejemplo, no
            podría preparar el material).
          </p>
          <p className="formulario-nota">
            El rojo es para cuando realmente <strong>no puedes</strong>, no para lo que preferirías no
            dar: entre más materias queden en rojo, más difícil es armar la malla del departamento.
            Todas empiezan en amarillo.
          </p>

          {materiasCobertura.length > 0 && (
            <div className="materias-bloque">
              <div className="materias-bloque-encabezado">
                <h3>Cursos de cálculo — cobertura departamental</h3>
                <span className={`counter ${verdesCobertura >= minCobertura ? 'ok' : 'low'}`}>
                  {verdesCobertura} en verde (mínimo {minCobertura})
                </span>
              </div>
              <p className="formulario-nota">
                Cursos de cálculo que, por ser departamentales, necesitan que varios profesores de
                tiempo completo o medio tiempo los impartan.
              </p>
              {listaMaterias(materiasCobertura)}
            </div>
          )}

          <div className="materias-bloque">
            <div className="materias-bloque-encabezado">
              <h3>{veCobertura ? 'Resto del catálogo' : 'Catálogo de materias'}</h3>
              <span className={`counter ${verdesGenerales >= minGeneral ? 'ok' : 'low'}`}>
                {verdesGenerales} en verde (mínimo {minGeneral})
              </span>
            </div>
            {listaMaterias(materiasGenerales)}
          </div>
        </section>
      )}

      <section className="formulario-seccion">
        <h2>Disponibilidad de horarios</h2>
        <p className={`formulario-nota ${horasVerdeSemana >= horasMinimasVerde ? 'nota-ok' : 'nota-falta'}`}>
          {horasVerdeSemana} hrs en verde marcadas de {horasMinimasVerde} hrs mínimo para poder enviar.
        </p>
        <div className="legend">
          <span><i className="legend-verde" /> Seguro disponible</span>
          <span><i className="legend-amarillo" /> Posible pero complicado</span>
          <span><i className="legend-rojo" /> No disponible</span>
        </div>
        {!soloLectura && (
          <p className="formulario-nota" id="ayuda-rejilla">
            Haz clic para cambiar el color de una franja, o mantén presionado y arrastra para pintar
            varias de un jalón.
          </p>
        )}
        <div className="disponibilidad-grid-wrap">
          <table className="disponibilidad-grid" onPointerMove={moverSobreRejilla}>
            <thead>
              <tr>
                <th>Hora</th>
                {DIAS.map((d) => (
                  <th key={d.valor}>{d.etiqueta}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {franjas.map((f, i) => {
                const filaAnterior = franjas[i - 1];
                const saltoComida = filaAnterior && f.hora_inicio !== filaAnterior.hora_fin;
                return (
                  <Fragment key={f.id}>
                    {saltoComida && (
                      <tr className="fila-comida">
                        <td colSpan={DIAS.length + 1}>comida</td>
                      </tr>
                    )}
                    <tr>
                      <td className="franja-hora">{f.hora_inicio.slice(0, 5)}</td>
                      {DIAS.map((d) => {
                        const clave = claveDisponibilidad(d.valor, f.id);
                        return (
                          <SlotCelda
                            key={d.valor}
                            clave={clave}
                            nivel={nivelDisponibilidad[clave]}
                            etiqueta={`${d.etiqueta} ${f.hora_inicio.slice(0, 5)}`}
                            disabled={soloLectura}
                            onIniciar={iniciarPintado}
                            onContinuar={continuarPintado}
                            onTeclado={ciclarConTeclado}
                          />
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {esAsignatura && (
        <section className="formulario-seccion">
          <label htmlFor="horarios_otro_depto">
            ¿Ya solicitaste cursos en otro departamento? ¿En qué horarios?
          </label>
          <textarea
            id="horarios_otro_depto"
            value={horariosOtroDepto}
            disabled={soloLectura}
            onChange={(e) => setHorariosOtroDepto(e.target.value)}
            placeholder="Ej. Martes 10:00-11:30 en Actuaría"
          />
        </section>
      )}

      <section className="formulario-seccion">
        <label htmlFor="observaciones_cursos">Observaciones sobre la asignación de cursos</label>
        <textarea
          id="observaciones_cursos"
          value={observacionesCursos}
          disabled={soloLectura}
          onChange={(e) => setObservacionesCursos(e.target.value)}
        />
        <label htmlFor="observaciones_horarios">Observaciones sobre disponibilidad de horarios</label>
        <textarea
          id="observaciones_horarios"
          value={observacionesHorarios}
          disabled={soloLectura}
          onChange={(e) => setObservacionesHorarios(e.target.value)}
        />
      </section>

      {!soloLectura && (
        <footer className="formulario-acciones">
          <button className="btn-secondary" disabled={guardando} onClick={() => guardar('borrador')}>
            Guardar borrador
          </button>
          <button
            className="btn-primary"
            disabled={guardando}
            onClick={() => {
              if (window.confirm('¿Enviar tus preferencias? Ya no podrás editarlas tú mismo después.')) {
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

// memo + handlers estables: al arrastrar se repinta solo la celda que cambió,
// no las 110 de la rejilla.
const SlotCelda = memo(function SlotCelda({
  clave,
  nivel,
  etiqueta,
  disabled,
  onIniciar,
  onContinuar,
  onTeclado,
}) {
  return (
    <td>
      <button
        type="button"
        className={`slot ${nivel ?? ''}`}
        data-clave={clave}
        disabled={disabled}
        aria-label={`${etiqueta}: ${nivel ?? 'sin marcar'}`}
        aria-describedby="ayuda-rejilla"
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          // Sin liberar la captura, en touch todos los eventos siguen yendo a
          // la celda donde empezó el gesto y arrastrar no pintaría nada más.
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          onIniciar(clave);
        }}
        onPointerEnter={() => {
          if (!disabled) onContinuar(clave);
        }}
        onKeyDown={(e) => {
          // El clic sintético que el navegador genera con Enter sobre un
          // <button> se perdió al quitar onClick, así que el teclado se maneja
          // aquí o la rejilla deja de ser usable sin mouse. No arma arrastre:
          // sin pointerup que lo cierre, se quedaría activo para siempre.
          if (disabled) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onTeclado(clave);
        }}
      />
    </td>
  );
});

// El texto del botón es el color, pero lo que se está respondiendo es si puede
// dar la materia; el title lo deja claro justo donde se toma la decisión.
function TriToggle({ valor, disabled, onCambiar }) {
  return (
    <div className="tri-toggle">
      <button
        type="button"
        className={`v ${valor === 'verde' ? 'active' : ''}`}
        disabled={disabled}
        title="Sí puedo darla, con gusto"
        onClick={() => onCambiar('verde')}
      >
        Verde
      </button>
      <button
        type="button"
        className={`a ${valor === 'amarillo' ? 'active' : ''}`}
        disabled={disabled}
        title="Sí puedo darla, aunque no es mi primera opción"
        onClick={() => onCambiar('amarillo')}
      >
        Amarillo
      </button>
      <button
        type="button"
        className={`r ${valor === 'rojo' ? 'active' : ''}`}
        disabled={disabled}
        title="No puedo darla — por ejemplo, no podría preparar el material"
        onClick={() => onCambiar('rojo')}
      >
        Rojo
      </button>
    </div>
  );
}
