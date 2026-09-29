import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { cambiarBloqueo, leerRespuestas } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { TIPO_CONTRATO_LABELS, departamentoInicial } from '../lib/roles';
import { audienciaAplica } from '../lib/formulario';
import SelectorDepartamento from '../components/SelectorDepartamento';

// Respuestas del cuestionario: profesores en filas, materias en columnas, cada
// celda con el color que contestó el profesor. Encima va la capa de BLOQUEOS:
// la jefatura hace clic en una celda para decir "esta persona no da esta
// materia", antes de correr el motor, que lo toma como restricción dura.
//
// El bloqueo no toca lo que contestó el profesor (se sigue viendo debajo) y el
// profesor nunca lo ve. Es lo que reemplaza a la lista personalizada por
// profesor: en vez de esconderle materias a alguien de antemano, todos
// contestan lo mismo y la jefatura decide después.
//
// Las columnas van por NOMBRE de materia, no por clave: los jefes conocen las
// materias por su nombre. Y con ~50 materias × ~45 profesores, la tabla entera
// no se puede leer de un vistazo, así que se filtra: materias por nombre y por
// sección (o eligiéndolas una por una), profesores por nombre, contrato y
// estado (o uno por uno).

const ESTADOS = [
  { valor: 'enviado', etiqueta: 'Enviado' },
  { valor: 'borrador', etiqueta: 'Borrador' },
  { valor: 'no_iniciado', etiqueta: 'Sin empezar' },
];
const ESTADO_LABELS = Object.fromEntries(ESTADOS.map((e) => [e.valor, e.etiqueta]));

const claveCelda = (profesorId, materiaId) => `${profesorId}-${materiaId}`;

// Para buscar "calculo" y encontrar "Cálculo".
const normalizar = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function alternarEnSet(set, id) {
  const siguiente = new Set(set);
  if (siguiente.has(id)) siguiente.delete(id);
  else siguiente.add(id);
  return siguiente;
}

export default function RespuestasCuestionario({ onVolver }) {
  const { token, profesor, departamentos, semestre } = useAuth();

  const [departamentoId, setDepartamentoId] = useState(() =>
    departamentoInicial(profesor, departamentos),
  );
  const [datos, setDatos] = useState(null);
  const [bloqueos, setBloqueos] = useState(() => new Set());
  const [pendientes, setPendientes] = useState(() => new Set());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  // Filtros de profesores
  const [busquedaProfesor, setBusquedaProfesor] = useState('');
  const [estados, setEstados] = useState(() => new Set(['enviado']));
  const [contratos, setContratos] = useState(() => new Set(Object.keys(TIPO_CONTRATO_LABELS)));
  const [profesoresOcultos, setProfesoresOcultos] = useState(() => new Set());

  // Filtros de materias
  const [busquedaMateria, setBusquedaMateria] = useState('');
  const [seccionesOcultas, setSeccionesOcultas] = useState(() => new Set());
  const [materiasOcultas, setMateriasOcultas] = useState(() => new Set());

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError('');
      try {
        if (!semestre) throw new Error('No hay ningún semestre configurado todavía.');
        const r = await leerRespuestas(token, semestre.id, departamentoId);
        if (cancelado) return;
        setDatos(r);
        setBloqueos(new Set(r.bloqueos.map(([p, m]) => claveCelda(p, m))));
        // Otro departamento, otras materias y otros profesores: lo elegido a
        // mano ya no aplica.
        setProfesoresOcultos(new Set());
        setMateriasOcultas(new Set());
        setSeccionesOcultas(new Set());
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

  // Secciones con solo sus materias visibles; las que quedan vacías se van.
  const seccionesVisibles = useMemo(() => {
    if (!datos) return [];
    const texto = normalizar(busquedaMateria.trim());
    return datos.secciones
      .filter((s) => !seccionesOcultas.has(s.id))
      .map((s) => ({
        ...s,
        materias: s.materias.filter(
          (m) =>
            !materiasOcultas.has(m.id) &&
            (!texto || normalizar(m.nombreMostrado).includes(texto) || normalizar(m.clave).includes(texto)),
        ),
      }))
      .filter((s) => s.materias.length > 0);
  }, [datos, seccionesOcultas, materiasOcultas, busquedaMateria]);

  const materias = useMemo(() => seccionesVisibles.flatMap((s) => s.materias), [seccionesVisibles]);
  const totalMaterias = datos?.secciones.reduce((n, s) => n + s.materias.length, 0) ?? 0;

  const filas = useMemo(() => {
    if (!datos) return [];
    const texto = normalizar(busquedaProfesor.trim());
    return datos.profesores.filter(
      (p) =>
        estados.has(p.estado) &&
        contratos.has(p.tipo_contrato) &&
        !profesoresOcultos.has(p.id) &&
        (!texto || normalizar(p.nombre).includes(texto)),
    );
  }, [datos, estados, contratos, profesoresOcultos, busquedaProfesor]);

  // Totales por materia sobre las filas visibles: cuántos la pueden dar en
  // verde sin estar bloqueados. Es lo que dice si una materia se va a poder
  // cubrir antes de correr el motor.
  const totales = useMemo(() => {
    const t = {};
    for (const m of materias) t[m.id] = { verdes: 0, bloqueos: 0 };
    for (const p of filas) {
      for (const m of materias) {
        if (bloqueos.has(claveCelda(p.id, m.id))) t[m.id].bloqueos++;
        else if (datos.niveles[p.id]?.[m.id] === 'verde') t[m.id].verdes++;
      }
    }
    return t;
  }, [filas, materias, bloqueos, datos]);

  async function alternar(profesorFila, materia) {
    const clave = claveCelda(profesorFila.id, materia.id);
    if (pendientes.has(clave)) return;
    const bloquear = !bloqueos.has(clave);

    // Se ve al instante y se revierte si falla: con 45 × 50 celdas, esperar
    // al servidor en cada clic se siente roto.
    const aplicar = (activo) =>
      setBloqueos((prev) => {
        const siguiente = new Set(prev);
        if (activo) siguiente.add(clave);
        else siguiente.delete(clave);
        return siguiente;
      });
    aplicar(bloquear);
    setPendientes((prev) => new Set(prev).add(clave));
    setError('');
    try {
      await cambiarBloqueo(token, semestre.id, departamentoId, profesorFila.id, materia.id, bloquear);
    } catch (err) {
      aplicar(!bloquear);
      setError(`No se pudo ${bloquear ? 'bloquear' : 'desbloquear'} ${materia.nombreMostrado}: ${err.message}`);
    } finally {
      setPendientes((prev) => {
        const siguiente = new Set(prev);
        siguiente.delete(clave);
        return siguiente;
      });
    }
  }

  const enviados = datos?.profesores.filter((p) => p.estado === 'enviado').length ?? 0;
  const contratosPresentes = datos
    ? Object.keys(TIPO_CONTRATO_LABELS).filter((c) => datos.profesores.some((p) => p.tipo_contrato === c))
    : [];

  function limpiarFiltros() {
    setBusquedaProfesor('');
    setBusquedaMateria('');
    setEstados(new Set(ESTADOS.map((e) => e.valor)));
    setContratos(new Set(Object.keys(TIPO_CONTRATO_LABELS)));
    setProfesoresOcultos(new Set());
    setMateriasOcultas(new Set());
    setSeccionesOcultas(new Set());
  }

  return (
    <div className="respuestas-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Respuestas y bloqueos</strong>
            <span>
              {etiquetaSemestre(semestre)}
              {datos && ` · ${enviados} de ${datos.profesores.length} enviados`}
            </span>
          </div>
          {datos && !datos.publicado && <span className="badge badge-borrador">Formulario sin publicar</span>}
        </div>
      </header>

      <SelectorDepartamento valor={departamentoId} onCambiar={setDepartamentoId} disabled={cargando} />

      {datos && (
        <div className="respuestas-filtros">
          <fieldset className="filtro-grupo">
            <legend>Materias</legend>
            <input
              type="search"
              placeholder="Buscar materia por nombre"
              aria-label="Buscar materia por nombre"
              value={busquedaMateria}
              onChange={(e) => setBusquedaMateria(e.target.value)}
            />
            {datos.secciones.length > 1 &&
              datos.secciones.map((s) => (
                <label className="check-linea" key={s.id}>
                  <input
                    type="checkbox"
                    checked={!seccionesOcultas.has(s.id)}
                    onChange={() => setSeccionesOcultas((prev) => alternarEnSet(prev, s.id))}
                  />
                  {s.titulo} ({s.materias.length})
                </label>
              ))}
            <details className="filtro-lista">
              <summary>
                Elegir materias una por una
                {materiasOcultas.size > 0 && ` (${materiasOcultas.size} ocultas)`}
              </summary>
              <div className="filtro-lista-acciones">
                <button type="button" className="btn-link" onClick={() => setMateriasOcultas(new Set())}>
                  Todas
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() =>
                    setMateriasOcultas(new Set(datos.secciones.flatMap((s) => s.materias.map((m) => m.id))))
                  }
                >
                  Ninguna
                </button>
              </div>
              {datos.secciones.map((s) => (
                <div key={s.id} className="filtro-lista-grupo">
                  <strong>{s.titulo}</strong>
                  {s.materias.map((m) => (
                    <label className="check-linea" key={m.id}>
                      <input
                        type="checkbox"
                        checked={!materiasOcultas.has(m.id)}
                        onChange={() => setMateriasOcultas((prev) => alternarEnSet(prev, m.id))}
                      />
                      {m.nombreMostrado}
                    </label>
                  ))}
                </div>
              ))}
            </details>
          </fieldset>

          <fieldset className="filtro-grupo">
            <legend>Profesores</legend>
            <input
              type="search"
              placeholder="Buscar profesor por nombre"
              aria-label="Buscar profesor por nombre"
              value={busquedaProfesor}
              onChange={(e) => setBusquedaProfesor(e.target.value)}
            />
            <div className="filtro-opciones">
              {ESTADOS.map((e) => (
                <label className="check-linea" key={e.valor}>
                  <input
                    type="checkbox"
                    checked={estados.has(e.valor)}
                    onChange={() => setEstados((prev) => alternarEnSet(prev, e.valor))}
                  />
                  {e.etiqueta}
                </label>
              ))}
            </div>
            {contratosPresentes.length > 1 && (
              <div className="filtro-opciones">
                {contratosPresentes.map((c) => (
                  <label className="check-linea" key={c}>
                    <input
                      type="checkbox"
                      checked={contratos.has(c)}
                      onChange={() => setContratos((prev) => alternarEnSet(prev, c))}
                    />
                    {TIPO_CONTRATO_LABELS[c]}
                  </label>
                ))}
              </div>
            )}
            <details className="filtro-lista">
              <summary>
                Elegir profesores uno por uno
                {profesoresOcultos.size > 0 && ` (${profesoresOcultos.size} ocultos)`}
              </summary>
              <div className="filtro-lista-acciones">
                <button type="button" className="btn-link" onClick={() => setProfesoresOcultos(new Set())}>
                  Todos
                </button>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setProfesoresOcultos(new Set(datos.profesores.map((p) => p.id)))}
                >
                  Ninguno
                </button>
              </div>
              <div className="filtro-lista-grupo">
                {datos.profesores.map((p) => (
                  <label className="check-linea" key={p.id}>
                    <input
                      type="checkbox"
                      checked={!profesoresOcultos.has(p.id)}
                      onChange={() => setProfesoresOcultos((prev) => alternarEnSet(prev, p.id))}
                    />
                    {p.nombre}
                  </label>
                ))}
              </div>
            </details>
          </fieldset>
        </div>
      )}

      {datos && (
        <div className="respuestas-resumen">
          <span className="formulario-nota">
            Mostrando {filas.length} de {datos.profesores.length} profesores y {materias.length} de{' '}
            {totalMaterias} materias.
          </span>
          <button type="button" className="btn-link" onClick={limpiarFiltros}>
            Ver todo
          </button>
        </div>
      )}

      <p className="formulario-nota">
        Haz clic en una celda para <strong>bloquear</strong> esa materia a ese profesor: el algoritmo no
        se la asignará. Lo que contestó se sigue viendo y el profesor no se entera. Otro clic la
        desbloquea.
      </p>
      <div className="legend">
        <span><i className="legend-verde" /> Verde</span>
        <span><i className="legend-amarillo" /> Amarillo</span>
        <span><i className="legend-rojo" /> Rojo (del profesor)</span>
        <span><i className="legend-bloqueada" /> Bloqueada por jefatura</span>
        <span><i className="legend-vacia" /> Sin respuesta</span>
      </div>

      {error && <p className="formulario-error">{error}</p>}

      {cargando && !datos ? (
        <div className="formulario-cargando">Cargando…</div>
      ) : datos && totalMaterias === 0 ? (
        <p className="formulario-nota">Este formulario no tiene materias que mostrar.</p>
      ) : datos && (filas.length === 0 || materias.length === 0) ? (
        <p className="formulario-nota">
          {filas.length === 0
            ? estados.size === 1 && estados.has('enviado') && enviados === 0
              ? 'Nadie ha enviado su formulario todavía. Marca "Borrador" o "Sin empezar" para ver a los demás.'
              : 'Ningún profesor coincide con los filtros.'
            : 'Ninguna materia coincide con los filtros.'}
        </p>
      ) : (
        datos && (
          <div className="respuestas-tabla-wrap">
            <table className="respuestas-tabla">
              <thead>
                <tr>
                  <th rowSpan={2} className="col-profesor">
                    Profesor
                  </th>
                  <th rowSpan={2} className="col-dato">
                    Cursos
                  </th>
                  {seccionesVisibles.map((s) => (
                    <th key={s.id} colSpan={s.materias.length} className="th-seccion">
                      {s.titulo}
                    </th>
                  ))}
                </tr>
                <tr>
                  {materias.map((m) => (
                    <th key={m.id} className="th-materia" title={`${m.nombreMostrado} (${m.clave})`}>
                      <span className="th-materia-texto">
                        <span className="th-materia-nombre">{m.nombreMostrado}</span>
                        <span className="th-materia-clave">{m.clave}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((p) => {
                  // Con la regla de fusión por audiencia, un profesor contesta
                  // todas las materias si le aplica al menos una sección de
                  // materias; si no le aplica ninguna, no contesta ninguna.
                  const contesta = datos.secciones.some((s) => audienciaAplica(s.audiencia, p.tipo_contrato));
                  return (
                    <tr key={p.id}>
                      <th scope="row" className="col-profesor">
                        <span className="respuestas-nombre">{p.nombre}</span>
                        <span className="respuestas-sub">
                          {TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato} · {ESTADO_LABELS[p.estado]}
                          {p.estado_especial && ` · ${p.estado_especial}`}
                        </span>
                      </th>
                      <td className="col-dato">{p.num_cursos_max ?? '—'}</td>
                      {materias.map((m) => {
                        const clave = claveCelda(p.id, m.id);
                        const nivel = contesta ? datos.niveles[p.id]?.[m.id] : undefined;
                        const bloqueada = bloqueos.has(clave);
                        const descripcion = `${p.nombre} — ${m.nombreMostrado}: ${
                          nivel ? `contestó ${nivel}` : 'sin respuesta'
                        }${bloqueada ? ', bloqueada por jefatura' : ''}`;
                        return (
                          <td key={m.id} className="celda-respuesta">
                            <button
                              type="button"
                              className={`celda ${nivel ?? 'vacia'} ${bloqueada ? 'bloqueada' : ''}`}
                              aria-pressed={bloqueada}
                              aria-label={`${descripcion}. ${bloqueada ? 'Clic para desbloquear' : 'Clic para bloquear'}`}
                              title={descripcion}
                              disabled={pendientes.has(clave)}
                              onClick={() => alternar(p, m)}
                            >
                              {bloqueada ? '✕' : ''}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="col-profesor">
                    Verdes disponibles
                    <span className="respuestas-sub">de los profesores mostrados, sin bloqueos</span>
                  </th>
                  <td className="col-dato" />
                  {materias.map((m) => (
                    <td
                      key={m.id}
                      className={`total ${totales[m.id].verdes === 0 ? 'total-cero' : ''}`}
                      title={`${m.nombreMostrado}: ${totales[m.id].verdes} en verde, ${totales[m.id].bloqueos} bloqueados`}
                    >
                      {totales[m.id].verdes}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="col-profesor">
                    Bloqueos
                  </th>
                  <td className="col-dato" />
                  {materias.map((m) => (
                    <td key={m.id} className="total">
                      {totales[m.id].bloqueos || ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  );
}
