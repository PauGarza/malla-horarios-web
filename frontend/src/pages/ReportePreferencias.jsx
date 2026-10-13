import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { leerReporte } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { TIPO_CONTRATO_LABELS, departamentoInicial } from '../lib/roles';
import SelectorDepartamento from '../components/SelectorDepartamento';
import EtiquetaFlotante from '../components/EtiquetaFlotante';
import { ValorNumCursos } from '../components/NumCursos';
import { numCursosEfectivo } from '../lib/numCursos';

// Reporte de preferencias: una fila por profesor con lo que pidió, ya contado
// (api/reporte.php). Es el resumen que la jefatura lee antes de asignar —
// cuántos cursos quiere dar cada quien y qué tan abierto vino en materias y en
// horario — sin abrir el formulario de nadie ni recorrer la matriz de
// Respuestas y bloqueos.
//
// Los niveles son los del profesor, sin bloqueos de jefatura. Ojo al leer
// "amarillo" en materias: el formulario arranca todas en amarillo, así que ese
// número incluye las que el profesor nunca tocó. El número de cursos sí lleva
// el ajuste de jefatura (Respuestas y bloqueos), marcado, porque es el que
// cuenta para asignar.

const NIVELES = [
  { valor: 'verde', etiqueta: 'Verde' },
  { valor: 'amarillo', etiqueta: 'Amarillo' },
  { valor: 'rojo', etiqueta: 'Rojo' },
];

const ESTADOS = [
  { valor: 'enviado', etiqueta: 'Enviado' },
  { valor: 'borrador', etiqueta: 'Borrador' },
  { valor: 'no_iniciado', etiqueta: 'Sin empezar' },
];
const ESTADO_LABELS = Object.fromEntries(ESTADOS.map((e) => [e.valor, e.etiqueta]));

// Cada columna ordenable sabe sacar su valor de una fila. Los null (quien no
// ha contestado) van siempre al final, en cualquier dirección.
const COLUMNAS = {
  nombre: (p) => p.nombre,
  tipo: (p) => TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato,
  estado: (p) => ESTADO_LABELS[p.estado],
  // Ordena y suma por el que cuenta: el de la jefatura si lo ajustó.
  cursos: numCursosEfectivo,
  ...Object.fromEntries(NIVELES.map((n) => [`materias-${n.valor}`, (p) => p.materias[n.valor]])),
  ...Object.fromEntries(NIVELES.map((n) => [`horas-${n.valor}`, (p) => p.horas[n.valor]])),
};

const normalizar = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function alternarEnSet(set, id) {
  const siguiente = new Set(set);
  if (siguiente.has(id)) siguiente.delete(id);
  else siguiente.add(id);
  return siguiente;
}

// 12.5 y no 12.50; 10 y no 10.0.
const formatoHoras = (h) => (Number.isInteger(h) ? String(h) : h.toFixed(1));

function comparar(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
}

function EncabezadoOrdenable({ columna, orden, onOrdenar, children, className = '', ...resto }) {
  const activo = orden.columna === columna;
  return (
    <th
      className={`th-ordenable ${className}`}
      aria-sort={activo ? (orden.asc ? 'ascending' : 'descending') : 'none'}
      {...resto}
    >
      <button type="button" onClick={() => onOrdenar(columna)}>
        {children}
        <span className="orden-flecha" aria-hidden="true">
          {activo ? (orden.asc ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

function descargarCsv(filas, nombreArchivo) {
  const encabezado = [
    'Profesor',
    'Tipo',
    'Estado',
    'Cursos solicitados',
    'Cursos ajustados por jefatura',
    ...NIVELES.map((n) => `Materias ${n.etiqueta.toLowerCase()}`),
    ...NIVELES.map((n) => `Horas ${n.etiqueta.toLowerCase()}`),
  ];
  const celda = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [
    encabezado,
    ...filas.map((p) => [
      p.nombre,
      TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato,
      ESTADO_LABELS[p.estado],
      p.num_cursos_max,
      p.ajuste_cursos?.num_cursos,
      ...NIVELES.map((n) => p.materias[n.valor]),
      ...NIVELES.map((n) => p.horas[n.valor]),
    ]),
  ].map((l) => l.map(celda).join(','));
  // El BOM es para que Excel abra los acentos bien.
  const blob = new Blob(['\uFEFF' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportePreferencias({ onVolver }) {
  const { token, profesor, departamentos, semestre, nombreDepartamento } = useAuth();

  const [departamentoId, setDepartamentoId] = useState(() =>
    departamentoInicial(profesor, departamentos),
  );
  const [profesores, setProfesores] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [busqueda, setBusqueda] = useState('');
  const [estados, setEstados] = useState(() => new Set(ESTADOS.map((e) => e.valor)));
  const [contratos, setContratos] = useState(() => new Set(Object.keys(TIPO_CONTRATO_LABELS)));
  const [orden, setOrden] = useState({ columna: 'nombre', asc: true });
  // La celda de materias abierta: { profesorId, nivel, profesor, materias, boton }.
  const [detalle, setDetalle] = useState(null);

  const esDetalleAbierto = (profesorId, nivel) =>
    detalle?.profesorId === profesorId && detalle?.nivel.valor === nivel;

  function alternarDetalle(evento, p, nivel) {
    if (esDetalleAbierto(p.id, nivel.valor)) {
      setDetalle(null);
      return;
    }
    setDetalle({
      profesorId: p.id,
      nivel,
      profesor: p.nombre,
      materias: p.lista_materias[nivel.valor],
      boton: evento.currentTarget,
    });
  }

  const cerrarDetalle = useCallback(() => setDetalle(null), []);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError('');
      try {
        if (!semestre) throw new Error('No hay ningún semestre configurado todavía.');
        setDetalle(null);
        const r = await leerReporte(token, semestre.id, departamentoId);
        if (!cancelado) setProfesores(r.profesores);
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

  const contratosPresentes = useMemo(
    () =>
      Object.keys(TIPO_CONTRATO_LABELS).filter((c) => (profesores ?? []).some((p) => p.tipo_contrato === c)),
    [profesores],
  );

  const visibles = useMemo(() => {
    if (!profesores) return [];
    const q = normalizar(busqueda.trim());
    const filtrados = profesores.filter(
      (p) =>
        estados.has(p.estado) &&
        contratos.has(p.tipo_contrato) &&
        (!q || normalizar(p.nombre).includes(q)),
    );
    const valor = COLUMNAS[orden.columna];
    return [...filtrados].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      if (va === null && vb === null) return comparar(a.nombre, b.nombre);
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = comparar(va, vb);
      return (orden.asc ? c : -c) || comparar(a.nombre, b.nombre);
    });
  }, [profesores, busqueda, estados, contratos, orden]);

  // Totales de lo que se ve: con el filtro en "Enviado" es la oferta real del
  // departamento contra la que se compara la demanda.
  const totales = useMemo(() => {
    const suma = (f) => visibles.reduce((acc, p) => acc + (f(p) ?? 0), 0);
    return {
      cursos: suma(numCursosEfectivo),
      materias: Object.fromEntries(NIVELES.map((n) => [n.valor, suma((p) => p.materias[n.valor])])),
      horas: Object.fromEntries(NIVELES.map((n) => [n.valor, suma((p) => p.horas[n.valor])])),
    };
  }, [visibles]);

  function ordenarPor(columna) {
    setOrden((prev) =>
      prev.columna === columna
        ? { columna, asc: !prev.asc }
        : // Los números se leen mejor de mayor a menor la primera vez.
          { columna, asc: columna === 'nombre' || columna === 'tipo' || columna === 'estado' },
    );
  }

  const nombreDepto = nombreDepartamento(departamentoId);
  const sinRespuesta = (p) => p.estado === 'no_iniciado';

  return (
    <div className="respuestas-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Reporte de preferencias</strong>
            <span>
              {nombreDepto} · {etiquetaSemestre(semestre)}
              {profesores && ` · ${profesores.filter((p) => p.estado === 'enviado').length} de ${profesores.length} enviados`}
            </span>
          </div>
          {visibles.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                descargarCsv(visibles, `reporte-preferencias-${normalizar(nombreDepto).replace(/\s+/g, '-')}-${semestre.etiqueta ?? semestre.id}.csv`)
              }
            >
              Descargar CSV
            </button>
          )}
        </div>
      </header>

      <SelectorDepartamento valor={departamentoId} onCambiar={setDepartamentoId} disabled={cargando} />

      {profesores && (
        <div className="respuestas-filtros">
          <fieldset className="filtro-grupo">
            <legend>Profesores</legend>
            <input
              type="search"
              placeholder="Buscar profesor por nombre"
              aria-label="Buscar profesor por nombre"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
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
          </fieldset>
        </div>
      )}

      <p className="formulario-nota">
        Lo que contestó cada profesor, sin bloqueos de jefatura. Los cursos con{' '}
        <span className="cursos-marcador">J</span> los ajustó la jefatura en Respuestas y bloqueos. En materias, amarillo incluye las que
        dejó como venían; en horas, las celdas sin marcar no cuentan en ningún color.
      </p>

      {error && <p className="formulario-error">{error}</p>}

      {cargando ? (
        <div className="formulario-cargando">Cargando…</div>
      ) : (
        profesores && (
          <div className="disponibilidad-grid-wrap">
            <table className="panel-tabla reporte-tabla">
              <thead>
                <tr>
                  <EncabezadoOrdenable orden={orden} onOrdenar={ordenarPor} columna="nombre" rowSpan={2}>Profesor</EncabezadoOrdenable>
                  <EncabezadoOrdenable orden={orden} onOrdenar={ordenarPor} columna="tipo" rowSpan={2}>Tipo</EncabezadoOrdenable>
                  <EncabezadoOrdenable orden={orden} onOrdenar={ordenarPor} columna="estado" rowSpan={2}>Estado</EncabezadoOrdenable>
                  <EncabezadoOrdenable orden={orden} onOrdenar={ordenarPor} columna="cursos" rowSpan={2} className="col-num">
                    Cursos solicitados
                  </EncabezadoOrdenable>
                  <th colSpan={3} className="th-grupo">Materias</th>
                  <th colSpan={3} className="th-grupo">Horas</th>
                </tr>
                <tr>
                  {['materias', 'horas'].map((grupo) =>
                    NIVELES.map((n) => (
                      <EncabezadoOrdenable
                        orden={orden}
                        onOrdenar={ordenarPor}
                        key={`${grupo}-${n.valor}`}
                        columna={`${grupo}-${n.valor}`}
                        className={`col-num num-${n.valor} th-${n.valor}`}
                      >
                        {n.etiqueta}
                      </EncabezadoOrdenable>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.nombre}
                      {p.estado_especial && <span className="materia-alias"> · {p.estado_especial}</span>}
                    </td>
                    <td>{TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato}</td>
                    <td>
                      <span className={`badge badge-${p.estado}`}>{ESTADO_LABELS[p.estado]}</span>
                    </td>
                    <td className="col-num">
                      <ValorNumCursos profesor={p} />
                    </td>
                    {NIVELES.map((n) => (
                      <td key={`m-${n.valor}`} className={`col-num num-${n.valor}`}>
                        {sinRespuesta(p) ? (
                          '—'
                        ) : p.materias[n.valor] === 0 ? (
                          0
                        ) : (
                          <button
                            type="button"
                            className="conteo-boton"
                            aria-expanded={esDetalleAbierto(p.id, n.valor)}
                            aria-label={`Ver las ${p.materias[n.valor]} materias en ${n.etiqueta.toLowerCase()} de ${p.nombre}`}
                            onClick={(e) => alternarDetalle(e, p, n)}
                          >
                            {p.materias[n.valor]}
                          </button>
                        )}
                      </td>
                    ))}
                    {NIVELES.map((n) => (
                      <td key={`h-${n.valor}`} className={`col-num num-${n.valor}`}>
                        {sinRespuesta(p) ? '—' : formatoHoras(p.horas[n.valor])}
                      </td>
                    ))}
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr>
                    <td colSpan={10}>Ningún profesor coincide con los filtros.</td>
                  </tr>
                )}
              </tbody>
              {visibles.length > 0 && (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>
                      Total ({visibles.length} {visibles.length === 1 ? 'profesor' : 'profesores'})
                    </th>
                    <td className="col-num">{totales.cursos}</td>
                    {NIVELES.map((n) => (
                      <td key={`tm-${n.valor}`} className={`col-num num-${n.valor}`}>
                        {totales.materias[n.valor]}
                      </td>
                    ))}
                    {NIVELES.map((n) => (
                      <td key={`th-${n.valor}`} className={`col-num num-${n.valor}`}>
                        {formatoHoras(totales.horas[n.valor])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )
      )}

      {detalle && (
        <EtiquetaFlotante
          boton={detalle.boton}
          titulo={`${detalle.materias.length} en ${detalle.nivel.etiqueta.toLowerCase()}`}
          subtitulo={detalle.profesor}
          etiquetaAria={`Materias en ${detalle.nivel.etiqueta.toLowerCase()} de ${detalle.profesor}`}
          className={`etiqueta-${detalle.nivel.valor}`}
          onCerrar={cerrarDetalle}
        >
          <ul>
            {detalle.materias.map((m) => (
              <li key={m.clave}>
                {m.nombre} <span className="materia-alias">{m.clave}</span>
              </li>
            ))}
          </ul>
        </EtiquetaFlotante>
      )}
    </div>
  );
}
