import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  guardarAsignacion,
  leerAsignaciones,
  leerDisponibilidadProfesor,
  quitarAsignacion,
} from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { TIPO_CONTRATO_LABELS, departamentoInicial } from '../lib/roles';
import { DIAS, claveDisponibilidad, franjasDeDepartamento } from '../lib/formulario';
import SelectorDepartamento from '../components/SelectorDepartamento';

// Asignaciones directas: lo que la jefatura decide a mano ANTES de correr el
// algoritmo. Cada asignación es un grupo: "este profesor da esta materia" y,
// si se quiere, "en estas horas". El algoritmo las respeta tal cual y reparte
// lo demás (api/asignaciones.php, tabla asignacion_fija).
//
// El servidor rechaza lo imposible (materia bloqueada a ese profesor, horario
// que no suma los créditos, choque con otra asignación suya). Lo que es mala
// idea pero posible —una hora que el profesor marcó en rojo, pasarse de los
// cursos que pidió o de los grupos sugeridos— solo se avisa aquí: la jefatura
// puede saber algo que el formulario no dice.
//
// "Materia de Maestría" (tipo = 'maestria'): las materias de maestría que da un
// profesor no están en el catálogo del departamento. Fijarla APARTA esas horas
// (el algoritmo no le pone nada ahí, como si fueran rojo) y NO cuenta como
// curso: quien pidió 1 curso y tiene una de maestría todavía recibe 1. Su
// horario es obligatorio y no depende de créditos.

const GRUPOS_PROFESOR = [
  { nivel: 'verde', etiqueta: 'En verde (lo marcó o lo puso la jefatura)' },
  { nivel: 'amarillo', etiqueta: 'En amarillo' },
  { nivel: 'rojo', etiqueta: 'En rojo' },
  { nivel: null, etiqueta: 'Sin respuesta para esta materia' },
];
const TOPE_HORAS_ASIGNATURA = 10; // RN03

// El valor del <select> de materia para la de maestría, y el objeto que hace
// sus veces donde se espera una materia del catálogo.
const MAESTRIA = 'maestria';
const MATERIA_MAESTRIA = { id: null, clave: null, nombre: 'Materia de Maestría', creditos: null, grupos_sugeridos: null };
const esDeMaestria = (a) => a.tipo === MAESTRIA;
const nombreMateria = (a, materiasPorId) =>
  esDeMaestria(a) ? MATERIA_MAESTRIA.nombre : (materiasPorId.get(a.materia_id)?.nombre ?? `Materia ${a.materia_id}`);

const DIA_CORTO = Object.fromEntries(DIAS.map((d) => [d.valor, d.etiqueta]));

const claveBloqueo = (profesorId, materiaId) => `${profesorId}-${materiaId}`;

/** "Lun 07:00–08:30 · Mié 07:00–08:30": junta los bloques seguidos de cada día. */
function resumenHorario(bloques, franjasPorId) {
  const porDia = new Map(DIAS.map((d) => [d.valor, []]));
  for (const [dia, franjaId] of bloques) {
    const f = franjasPorId.get(franjaId);
    if (f) porDia.get(dia)?.push(f);
  }
  const partes = [];
  for (const [dia, franjas] of porDia) {
    if (franjas.length === 0) continue;
    franjas.sort((a, b) => a.orden - b.orden);
    const tramos = [];
    for (const f of franjas) {
      const ultimo = tramos[tramos.length - 1];
      if (ultimo && ultimo.fin === f.hora_inicio) ultimo.fin = f.hora_fin;
      else tramos.push({ inicio: f.hora_inicio, fin: f.hora_fin });
    }
    partes.push(
      `${DIA_CORTO[dia]} ${tramos.map((t) => `${t.inicio.slice(0, 5)}–${t.fin.slice(0, 5)}`).join(', ')}`,
    );
  }
  return partes.join(' · ');
}

/**
 * Avisos de una asignación (guardada o en edición) contra todo lo demás que
 * está fijado. `otras` son las asignaciones SIN ella misma.
 */
function avisosDe({ materia, profesor, horario, otras, nivelMateria, materiasPorId }) {
  const avisos = [];
  if (!materia || !profesor) return avisos;
  // La de maestría solo aparta horas: si cae en su rojo es justo por eso, y no
  // es curso ni grupo del departamento.
  if (materia === MATERIA_MAESTRIA) return avisos;

  if (nivelMateria === 'rojo') avisos.push({ grave: true, texto: 'Marcó esta materia en rojo.' });

  const enRojo = horario.filter(([, , n]) => n === 'rojo').length;
  const sinMarcar = horario.filter(([, , n]) => !n).length;
  const enAmarillo = horario.filter(([, , n]) => n === 'amarillo').length;
  if (enRojo > 0) avisos.push({ grave: true, texto: `${enRojo} de las medias horas caen en su rojo.` });
  if (sinMarcar > 0)
    avisos.push({ grave: true, texto: `${sinMarcar} de las medias horas no las marcó (el algoritmo las trata como rojo).` });
  if (enAmarillo > 0) avisos.push({ grave: false, texto: `${enAmarillo} de las medias horas caen en su amarillo.` });

  // Las de maestría no son cursos: no suman ni para sus cursos ni para sus horas.
  const suyas = otras.filter((a) => a.profesor_id === profesor.id && !esDeMaestria(a));
  const cursos = suyas.length + 1;
  if (profesor.num_cursos !== null && cursos > profesor.num_cursos) {
    avisos.push({
      grave: false,
      texto: `Con esta lleva ${cursos} ${cursos === 1 ? 'grupo fijado' : 'grupos fijados'} y ${
        profesor.cursos_ajustados ? 'la jefatura le puso' : 'pidió'
      } ${profesor.num_cursos}.`,
    });
  }
  if (profesor.tipo_contrato === 'asignatura') {
    const bloques = [...suyas.map((a) => materiasPorId.get(a.materia_id)?.creditos ?? 0), materia.creditos].reduce(
      (x, y) => x + y,
      0,
    );
    if (bloques / 2 > TOPE_HORAS_ASIGNATURA) {
      avisos.push({
        grave: true,
        texto: `Suma ${bloques / 2} h a la semana fijadas en este departamento; el tope de asignatura es ${TOPE_HORAS_ASIGNATURA} h.`,
      });
    }
  }

  const grupos = otras.filter((a) => a.materia_id === materia.id).length + 1;
  if (materia.grupos_sugeridos !== null && grupos > materia.grupos_sugeridos) {
    avisos.push({
      grave: false,
      texto: `Son ${grupos} grupos fijados de esta materia y la demanda sugiere ${materia.grupos_sugeridos}.`,
    });
  }
  return avisos;
}

function ListaAvisos({ avisos }) {
  if (avisos.length === 0) return null;
  return (
    <ul className="asig-avisos">
      {avisos.map((a) => (
        <li key={a.texto} className={a.grave ? 'aviso-grave' : ''}>
          {a.texto}
        </li>
      ))}
    </ul>
  );
}

/**
 * Rejilla para escoger el horario fijo. De fondo, la disponibilidad que marcó
 * el profesor; encima, los bloques elegidos. Las horas que ya ocupa otra
 * asignación suya no se pueden tomar (el servidor también lo rechaza).
 */
function RejillaHorarioFijo({ franjas, seleccion, niveles, ocupadas, onAlternar }) {
  return (
    <div className="disponibilidad-grid-wrap">
      <table className="disponibilidad-grid asig-grid">
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
            const anterior = franjas[i - 1];
            return (
              <Fragment key={f.id}>
                {anterior && f.hora_inicio !== anterior.hora_fin && (
                  <tr className="fila-comida">
                    <td colSpan={DIAS.length + 1}>comida</td>
                  </tr>
                )}
                <tr>
                  <td className="franja-hora">{f.hora_inicio.slice(0, 5)}</td>
                  {DIAS.map((d) => {
                    if (f.dias && !f.dias.includes(d.valor)) {
                      return <td key={d.valor} className="slot-no-aplica" aria-hidden="true" />;
                    }
                    const clave = claveDisponibilidad(d.valor, f.id);
                    const nivel = niveles?.[clave];
                    const elegida = seleccion.has(clave);
                    const otra = ocupadas.get(clave);
                    const etiqueta = `${d.etiqueta} ${f.hora_inicio.slice(0, 5)}`;
                    const estado = otra
                      ? `ya tiene ${otra}`
                      : `${nivel ? `marcó ${nivel}` : 'sin marcar'}${elegida ? ', elegida' : ''}`;
                    return (
                      <td key={d.valor}>
                        <button
                          type="button"
                          className={`asig-slot ${nivel ? `fondo-${nivel}` : 'fondo-vacio'} ${elegida ? 'elegida' : ''} ${
                            otra ? 'ocupada' : ''
                          }`}
                          disabled={Boolean(otra)}
                          aria-pressed={elegida}
                          aria-label={`${etiqueta}: ${estado}`}
                          title={`${etiqueta}: ${estado}`}
                          onClick={() => onAlternar(clave)}
                        >
                          {elegida ? '✓' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const EDITOR_VACIO = { id: null, materiaId: '', profesorId: '', conHorario: false, horario: new Set(), nota: '' };

export default function AsignacionesDirectas({ onVolver }) {
  const { token, profesor: yo, departamentos, semestre, franjas, nombreDepartamento } = useAuth();

  const [departamentoId, setDepartamentoId] = useState(() => departamentoInicial(yo, departamentos));
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  // null = editor cerrado.
  const [editor, setEditor] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorEditor, setErrorEditor] = useState('');
  // profesorId -> { clave: nivel } | 'cargando' | 'error'
  const [disponibilidades, setDisponibilidades] = useState({});
  const [confirmarQuitar, setConfirmarQuitar] = useState(null);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError('');
      setEditor(null);
      setDisponibilidades({});
      try {
        if (!semestre) throw new Error('No hay ningún semestre configurado todavía.');
        const r = await leerAsignaciones(token, semestre.id, departamentoId);
        if (!cancelado) setDatos(r);
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
  }, [token, semestre, departamentoId]);

  const franjasDepto = useMemo(() => franjasDeDepartamento(franjas, departamentoId), [franjas, departamentoId]);
  const franjasPorId = useMemo(() => new Map(franjas.map((f) => [f.id, f])), [franjas]);
  const materiasPorId = useMemo(() => new Map((datos?.materias ?? []).map((m) => [m.id, m])), [datos]);
  const profesoresPorId = useMemo(() => new Map((datos?.profesores ?? []).map((p) => [p.id, p])), [datos]);
  const bloqueos = useMemo(
    () => new Set((datos?.bloqueos ?? []).map(([p, m]) => claveBloqueo(p, m))),
    [datos],
  );

  const profesorEditor = editor?.profesorId ? Number(editor.profesorId) : null;

  // La disponibilidad de un profesor se pide la primera vez que hace falta
  // (al abrir la rejilla con él elegido) y se guarda para el resto de la visita.
  function asegurarDisponibilidad(profesorId) {
    if (!profesorId || disponibilidades[profesorId] !== undefined) return;
    setDisponibilidades((prev) => ({ ...prev, [profesorId]: 'cargando' }));
    leerDisponibilidadProfesor(token, semestre.id, departamentoId, profesorId)
      .then((r) =>
        setDisponibilidades((prev) => ({
          ...prev,
          [profesorId]: Object.fromEntries(r.celdas.map(([d, f, n]) => [claveDisponibilidad(d, f), n])),
        })),
      )
      .catch(() => setDisponibilidades((prev) => ({ ...prev, [profesorId]: 'error' })));
  }

  const asignaciones = useMemo(() => {
    if (!datos) return [];
    return [...datos.asignaciones].sort(
      (a, b) =>
        nombreMateria(a, materiasPorId).localeCompare(nombreMateria(b, materiasPorId), 'es') ||
        (profesoresPorId.get(a.profesor_id)?.nombre ?? '').localeCompare(profesoresPorId.get(b.profesor_id)?.nombre ?? '', 'es'),
    );
  }, [datos, materiasPorId, profesoresPorId]);

  // --- Editor -----------------------------------------------------------------

  const esMaestriaEditor = editor?.materiaId === MAESTRIA;
  const materiaEditor = esMaestriaEditor
    ? MATERIA_MAESTRIA
    : editor?.materiaId
      ? materiasPorId.get(Number(editor.materiaId))
      : null;
  // La de maestría siempre lleva horario: es lo único que hace.
  const conHorarioEditor = Boolean(editor?.conHorario || esMaestriaEditor);
  const profesorEditorObj = profesorEditor !== null ? profesoresPorId.get(profesorEditor) : null;
  const dispEditor = profesorEditor !== null ? disponibilidades[profesorEditor] : undefined;
  const otrasQueLaEditada = useMemo(
    () => (datos?.asignaciones ?? []).filter((a) => a.id !== editor?.id),
    [datos, editor?.id],
  );

  // Horas que el profesor elegido ya tiene en OTRAS asignaciones fijas.
  const ocupadasEditor = useMemo(() => {
    const m = new Map();
    if (profesorEditor === null) return m;
    for (const a of otrasQueLaEditada) {
      if (a.profesor_id !== profesorEditor) continue;
      const nombre = nombreMateria(a, materiasPorId);
      for (const [dia, franjaId] of a.horario) m.set(claveDisponibilidad(dia, franjaId), nombre);
    }
    return m;
  }, [otrasQueLaEditada, profesorEditor, materiasPorId]);

  const horarioEditor = useMemo(() => {
    if (!conHorarioEditor) return [];
    const niveles = typeof dispEditor === 'object' ? dispEditor : {};
    return [...editor.horario].map((clave) => {
      const [dia, franjaId] = clave.split('-');
      return [dia, Number(franjaId), niveles[clave] ?? null];
    });
  }, [editor, dispEditor, conHorarioEditor]);

  const avisosEditor =
    editor && materiaEditor && profesorEditorObj
      ? avisosDe({
          materia: materiaEditor,
          profesor: profesorEditorObj,
          horario: typeof dispEditor === 'object' ? horarioEditor : [],
          otras: otrasQueLaEditada,
          nivelMateria: datos.niveles[profesorEditorObj.id]?.[materiaEditor.id],
          materiasPorId,
        })
      : [];

  // Candidatos para la materia elegida, agrupados por lo que contestaron.
  const candidatos = useMemo(() => {
    if (!datos) return [];
    const materiaId = editor?.materiaId && editor.materiaId !== MAESTRIA ? Number(editor.materiaId) : null;
    const fijadas = new Map();
    for (const a of otrasQueLaEditada) {
      if (!esDeMaestria(a)) fijadas.set(a.profesor_id, (fijadas.get(a.profesor_id) ?? 0) + 1);
    }
    return datos.profesores
      .map((p) => ({
        ...p,
        nivel: materiaId ? (datos.niveles[p.id]?.[materiaId] ?? null) : null,
        bloqueado: materiaId ? bloqueos.has(claveBloqueo(p.id, materiaId)) : false,
        fijadas: fijadas.get(p.id) ?? 0,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [datos, editor?.materiaId, otrasQueLaEditada, bloqueos]);

  const faltaParaGuardar = !editor
    ? null
    : !materiaEditor
      ? 'Elige la materia.'
      : !profesorEditorObj
        ? 'Elige al profesor.'
        : esMaestriaEditor && editor.horario.size === 0
          ? 'Elige las horas de la materia de maestría: es lo que se le aparta.'
          : !esMaestriaEditor && editor.conHorario && editor.horario.size !== materiaEditor.creditos
          ? `El horario lleva ${materiaEditor.creditos} medias horas (${materiaEditor.creditos / 2} h a la semana); llevas ${editor.horario.size}.`
          : null;

  function abrirNueva() {
    setErrorEditor('');
    setConfirmarQuitar(null);
    setEditor({ ...EDITOR_VACIO, horario: new Set() });
  }

  function abrirEdicion(a) {
    setErrorEditor('');
    setConfirmarQuitar(null);
    if (a.horario.length > 0 || esDeMaestria(a)) asegurarDisponibilidad(a.profesor_id);
    setEditor({
      id: a.id,
      materiaId: esDeMaestria(a) ? MAESTRIA : String(a.materia_id),
      profesorId: String(a.profesor_id),
      conHorario: a.horario.length > 0,
      horario: new Set(a.horario.map(([d, f]) => claveDisponibilidad(d, f))),
      nota: a.nota ?? '',
    });
  }

  function cambiarEditor(cambios) {
    const siguiente = { ...editor, ...cambios };
    if ((siguiente.conHorario || siguiente.materiaId === MAESTRIA) && siguiente.profesorId) {
      asegurarDisponibilidad(Number(siguiente.profesorId));
    }
    setEditor(siguiente);
  }

  function alternarBloque(clave) {
    setEditor((prev) => {
      const horario = new Set(prev.horario);
      if (horario.has(clave)) horario.delete(clave);
      else horario.add(clave);
      return { ...prev, horario };
    });
  }

  async function guardar() {
    if (faltaParaGuardar) return;
    setGuardando(true);
    setErrorEditor('');
    try {
      const cuerpo = {
        tipo: esMaestriaEditor ? MAESTRIA : 'materia',
        materia_id: esMaestriaEditor ? null : materiaEditor.id,
        profesor_id: profesorEditorObj.id,
        horario: conHorarioEditor ? horarioEditor.map(([d, f]) => [d, f]) : [],
        nota: editor.nota.trim() || null,
      };
      const r = await guardarAsignacion(token, semestre.id, departamentoId, cuerpo, editor.id);
      setDatos((prev) => ({
        ...prev,
        asignaciones: editor.id
          ? prev.asignaciones.map((a) => (a.id === editor.id ? r.asignacion : a))
          : [...prev.asignaciones, r.asignacion],
      }));
      setEditor(null);
    } catch (err) {
      setErrorEditor(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(a) {
    setError('');
    try {
      await quitarAsignacion(token, semestre.id, departamentoId, a.id);
      setDatos((prev) => ({ ...prev, asignaciones: prev.asignaciones.filter((x) => x.id !== a.id) }));
      if (editor?.id === a.id) setEditor(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirmarQuitar(null);
    }
  }

  // --- Render -----------------------------------------------------------------

  const fijadasPorMateria = new Map();
  for (const a of datos?.asignaciones ?? []) {
    if (!esDeMaestria(a)) fijadasPorMateria.set(a.materia_id, (fijadasPorMateria.get(a.materia_id) ?? 0) + 1);
  }

  return (
    <div className="respuestas-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Asignaciones directas</strong>
            <span>
              {nombreDepartamento(departamentoId)} · {etiquetaSemestre(semestre)}
              {datos && ` · ${datos.asignaciones.length} ${datos.asignaciones.length === 1 ? 'fijada' : 'fijadas'}`}
            </span>
          </div>
          {datos && !editor && (
            <button type="button" className="btn-primary" onClick={abrirNueva}>
              + Nueva asignación
            </button>
          )}
        </div>
      </header>

      <SelectorDepartamento valor={departamentoId} onCambiar={setDepartamentoId} disabled={cargando || Boolean(editor)} />

      <p className="formulario-nota">
        Fija aquí lo que ya está decidido antes de correr el algoritmo. Cada asignación es <strong>un grupo</strong>:
        el algoritmo le dará esa materia a ese profesor y, si fijas el horario, en esas horas exactas. El salón y
        el resto de los grupos los decide él. Los profesores no ven esta pantalla.
      </p>

      {error && <p className="formulario-error">{error}</p>}

      {editor && datos && (
        <section className="asig-editor" aria-label={editor.id ? 'Editar asignación' : 'Nueva asignación'}>
          <h3>{editor.id ? 'Editar asignación' : 'Nueva asignación'}</h3>

          <div className="asig-campos">
            <label>
              Materia
              <select
                value={editor.materiaId}
                onChange={(e) => cambiarEditor({ materiaId: e.target.value })}
              >
                <option value="">Elige una materia…</option>
                <option value={MAESTRIA}>Materia de Maestría (aparta su horario, no cuenta como curso)</option>
                {datos.materias.map((m) => {
                  const editadaEsEsta = editor.id && !esMaestriaEditor && Number(editor.materiaId) === m.id;
                  const fijadas = (fijadasPorMateria.get(m.id) ?? 0) - (editadaEsEsta ? 1 : 0);
                  const sugeridos = m.grupos_sugeridos === null ? '' : ` de ${m.grupos_sugeridos} sugeridos`;
                  return (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.clave}){fijadas > 0 || m.grupos_sugeridos !== null ? ` · ${fijadas} fijados${sugeridos}` : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            <label>
              Profesor
              <select
                value={editor.profesorId}
                onChange={(e) => cambiarEditor({ profesorId: e.target.value })}
              >
                <option value="">Elige un profesor…</option>
                {GRUPOS_PROFESOR.map((g) => {
                  const lista = candidatos.filter((p) => !p.bloqueado && p.nivel === g.nivel);
                  if (lista.length === 0) return null;
                  return (
                    <optgroup key={g.nivel ?? 'sin'} label={editor.materiaId && !esMaestriaEditor ? g.etiqueta : 'Profesores'}>
                      {lista.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre} · {TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato}
                          {p.fijadas > 0 ? ` · ${p.fijadas} ya fijada${p.fijadas === 1 ? '' : 's'}` : ''}
                          {p.num_cursos !== null ? ` · ${p.num_cursos} cursos` : ''}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
                {candidatos.some((p) => p.bloqueado) && (
                  <optgroup label="Bloqueados para esta materia (desbloquéalos en Respuestas y bloqueos)">
                    {candidatos
                      .filter((p) => p.bloqueado)
                      .map((p) => (
                        <option key={p.id} value={p.id} disabled>
                          {p.nombre}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>

          {esMaestriaEditor ? (
            <p className="formulario-nota">
              Marca las horas de su materia de maestría. El algoritmo no le asignará nada en esas horas, y no
              cuenta como uno de sus cursos.
            </p>
          ) : (
            <label className="check-linea">
              <input
                type="checkbox"
                checked={editor.conHorario}
                onChange={(e) => cambiarEditor({ conHorario: e.target.checked })}
              />
              Fijar también el horario
            </label>
          )}

          {conHorarioEditor &&
            (!profesorEditorObj ? (
              <p className="formulario-nota">Elige al profesor para ver su disponibilidad.</p>
            ) : dispEditor === 'cargando' || dispEditor === undefined ? (
              <p className="formulario-nota">Cargando su disponibilidad…</p>
            ) : (
              <div className="asig-horario">
                {dispEditor === 'error' && (
                  <p className="formulario-error">
                    No se pudo cargar su disponibilidad; la rejilla sale sin ella.
                  </p>
                )}
                <div className="asig-horario-barra">
                  <span className={faltaParaGuardar && materiaEditor ? 'nota-falta' : 'nota-ok'}>
                    {editor.horario.size}
                    {materiaEditor?.creditos ? ` de ${materiaEditor.creditos}` : ''} medias horas elegidas
                    {materiaEditor?.creditos
                      ? ` (${materiaEditor.creditos / 2} h a la semana)`
                      : ` (${editor.horario.size / 2} h a la semana)`}
                  </span>
                  {editor.horario.size > 0 && (
                    <button type="button" className="btn-link" onClick={() => cambiarEditor({ horario: new Set() })}>
                      Limpiar
                    </button>
                  )}
                  {editor.horario.size > 0 && (
                    <span className="formulario-nota">
                      {resumenHorario(
                        horarioEditor.map(([d, f]) => [d, f]),
                        franjasPorId,
                      )}
                    </span>
                  )}
                </div>
                <div className="legend">
                  <span><i className="legend-verde" /> Él marcó verde</span>
                  <span><i className="legend-amarillo" /> Amarillo</span>
                  <span><i className="legend-rojo" /> Rojo</span>
                  <span><i className="legend-vacia" /> Sin marcar</span>
                  <span><i className="legend-elegida" /> Elegida</span>
                </div>
                <RejillaHorarioFijo
                  franjas={franjasDepto}
                  seleccion={editor.horario}
                  niveles={typeof dispEditor === 'object' ? dispEditor : null}
                  ocupadas={ocupadasEditor}
                  onAlternar={alternarBloque}
                />
              </div>
            ))}

          <label className="asig-nota">
            {esMaestriaEditor ? '¿Qué materia es? (opcional)' : 'Nota (opcional)'}
            <textarea
              rows={2}
              maxLength={500}
              value={editor.nota}
              placeholder={
                esMaestriaEditor
                  ? 'Por ejemplo: Aprendizaje de máquina, MCD'
                  : 'Por ejemplo: acordado con el profesor en la reunión de academia'
              }
              onChange={(e) => cambiarEditor({ nota: e.target.value })}
            />
          </label>

          <ListaAvisos avisos={avisosEditor} />
          {errorEditor && <p className="formulario-error">{errorEditor}</p>}

          <div className="asig-acciones">
            <button type="button" className="btn-primary" disabled={Boolean(faltaParaGuardar) || guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : editor.id ? 'Guardar cambios' : 'Fijar asignación'}
            </button>
            <button type="button" className="btn-secondary" disabled={guardando} onClick={() => setEditor(null)}>
              Cancelar
            </button>
            {faltaParaGuardar && <span className="formulario-nota">{faltaParaGuardar}</span>}
          </div>
        </section>
      )}

      {cargando ? (
        <div className="formulario-cargando">Cargando…</div>
      ) : (
        datos &&
        (asignaciones.length === 0 ? (
          !editor && <p className="formulario-nota">Todavía no hay asignaciones fijadas en este departamento.</p>
        ) : (
          <div className="disponibilidad-grid-wrap">
            <table className="panel-tabla asig-tabla">
              <thead>
                <tr>
                  <th>Materia</th>
                  <th>Profesor</th>
                  <th>Horario</th>
                  <th>Avisos</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {asignaciones.map((a) => {
                  const maestria = esDeMaestria(a);
                  const m = maestria ? MATERIA_MAESTRIA : materiasPorId.get(a.materia_id);
                  const p = profesoresPorId.get(a.profesor_id);
                  const avisos = avisosDe({
                    materia: m,
                    profesor: p,
                    horario: a.horario,
                    otras: datos.asignaciones.filter((x) => x.id !== a.id),
                    nivelMateria: p && m ? datos.niveles[p.id]?.[m.id] : undefined,
                    materiasPorId,
                  });
                  return (
                    <tr key={a.id} className={editor?.id === a.id ? 'asig-fila-editando' : ''}>
                      <td>
                        {nombreMateria(a, materiasPorId)}
                        {maestria ? (
                          <span className="asig-etiqueta-maestria">aparta horario · no cuenta como curso</span>
                        ) : (
                          m && <span className="materia-alias"> · {m.clave}</span>
                        )}
                        {a.nota && <span className="respuestas-sub">{a.nota}</span>}
                      </td>
                      <td>
                        {/* Un profesor dado de baja después de fijarlo ya no está en el roster. */}
                        {p ? p.nombre : 'Profesor inactivo'}
                        {p && (
                          <span className="respuestas-sub">{TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato}</span>
                        )}
                      </td>
                      <td>
                        {a.horario.length > 0 ? (
                          resumenHorario(a.horario, franjasPorId)
                        ) : (
                          <span className="materia-alias">Lo decide el algoritmo</span>
                        )}
                      </td>
                      <td>
                        {avisos.length > 0 ? <ListaAvisos avisos={avisos} /> : <span className="materia-alias">—</span>}
                      </td>
                      <td>
                        <div className="panel-acciones">
                          {confirmarQuitar === a.id ? (
                            <>
                              <span className="formulario-nota">¿Quitarla?</span>
                              <button type="button" className="btn-secondary" onClick={() => quitar(a)}>
                                Sí, quitar
                              </button>
                              <button type="button" className="btn-link" onClick={() => setConfirmarQuitar(null)}>
                                No
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={Boolean(editor)}
                                onClick={() => abrirEdicion(a)}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="btn-link"
                                disabled={Boolean(editor)}
                                onClick={() => setConfirmarQuitar(a.id)}
                              >
                                Quitar
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
