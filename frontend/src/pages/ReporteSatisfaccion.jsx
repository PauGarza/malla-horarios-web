import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { leerMalla } from '../lib/api';
import { PESOS, calcularSatisfaccion } from '../lib/satisfaccion';
import { TIPO_CONTRATO_LABELS, veMallaDeTodaLaDivision } from '../lib/roles';
import { nombreCompleto } from '../lib/reporteHorarios';
import { etiquetaSemestre } from '../lib/semestre';
import { DIAS } from '../lib/formulario';
import EtiquetaFlotante from '../components/EtiquetaFlotante';
import EncabezadoOrdenable, { BotonOrden, ThOrdenable } from '../components/EncabezadoOrdenable';

// Satisfacción de los profesores: qué tanto se parece lo que le tocó a cada
// quien en la malla a lo que pidió en su formulario, del peor al mejor. Lee lo
// mismo que la malla (api/malla.php); el cálculo está en lib/satisfaccion.js y
// la fórmula en DACE/DISENO-REPORTES.md §2. Solo para la jefatura: los
// profesores no lo ven.

const TODOS = 'todos';

/** Los departamentos que se piden a api/malla.php; null = el de la cuenta. */
const deptosDe = (veTodos, alcance, departamentos) =>
  !veTodos ? null : alcance === TODOS ? departamentos.map((d) => d.id) : [Number(alcance)];

function alternarEnSet(set, id) {
  const siguiente = new Set(set);
  if (siguiente.has(id)) siguiente.delete(id);
  else siguiente.add(id);
  return siguiente;
}

const NIVELES = ['verde', 'amarillo', 'rojo'];
const NOMBRE_DIA = Object.fromEntries(DIAS.map((d) => [d.valor, d.etiqueta]));

// Cada columna ordenable sabe sacar su valor de una fila. Sin cursos no hay
// calificación: va con los peores, salvo quien pidió 0 (como en satisfaccion.js).
const COLUMNAS = {
  nombre: (f) => f.nombre,
  contrato: (f) => TIPO_CONTRATO_LABELS[f.contrato] ?? f.contrato ?? '',
  s: (f) => (f.s != null ? f.s : f.pidio === 0 ? 2 : -2),
  ...Object.fromEntries(NIVELES.map((n) => [`horas-${n}`, (f) => f.horario[n]])),
  ...Object.fromEntries(NIVELES.map((n) => [`materias-${n}`, (f) => f.materia[n]])),
  cursos: (f) => f.cursos,
  dias: (f) => f.dias.length,
};

function comparar(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
}

const fmt = (s) => (s == null ? '—' : s.toFixed(2));
const horasTxt = (h) => `${h.toLocaleString('es-MX')} h`;

function claseS(s) {
  if (s == null) return 'satisf-nada';
  if (s >= 0.9) return 'satisf-alta';
  if (s >= 0.5) return 'satisf-media';
  return 'satisf-baja';
}

/** Los tres números; los que no son 0 abren la lista de cuáles son. */
function Conteo({ c, que, profesor, abierto, onAbrir }) {
  return (
    <span className="satisf-conteo">
      {NIVELES.map((n, i) => (
        <span key={n}>
          {i > 0 && ' · '}
          {c[n] === 0 ? (
            <span className={`num-${n}`}>0</span>
          ) : (
            <button
              type="button"
              className={`conteo-boton num-${n}`}
              aria-expanded={abierto(n)}
              aria-label={`Ver ${que} en ${n} de ${profesor}`}
              onClick={(e) => onAbrir(e, n)}
            >
              {c[n].toLocaleString('es-MX')}
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

function notas(f) {
  const out = [];
  if (!f.cursos) out.push(f.pidio === 0 ? 'No pidió cursos' : 'Sin cursos');
  if (f.materiasNoVerdes.length) out.push(f.materiasNoVerdes.join(', '));
  const pa = f.porAsignacion;
  if (pa.amarillo + pa.rojo) {
    out.push(`${horasTxt(pa.amarillo + pa.rojo)} fuera de verde por asignación directa`);
  }
  if (f.otroDepto.length) out.push(`También da ${f.otroDepto.join(', ')} de otro departamento (no cuenta)`);
  if (f.sinFormulario) out.push('No envió formulario');
  else if (f.borrador) out.push('Formulario en borrador');
  return out;
}

export default function ReporteSatisfaccion({ onVolver }) {
  const { token, profesor, departamentos, semestre } = useAuth();
  const veTodos = veMallaDeTodaLaDivision(profesor.rol);
  const [alcance, setAlcance] = useState(TODOS);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [contratos, setContratos] = useState(() => new Set(Object.keys(TIPO_CONTRATO_LABELS)));
  // La lista abierta: { profesorId, que: 'horas' | 'materias', nivel, f, boton }
  const [detalle, setDetalle] = useState(null);
  // Del peor al mejor, como sale de calcularSatisfaccion
  const [orden, setOrden] = useState({ columna: 's', asc: true });

  useEffect(() => {
    if (!semestre) return undefined;
    let cancelado = false;
    setDatos(null);
    setDetalle(null);
    setError('');
    leerMalla(token, semestre.id, deptosDe(veTodos, alcance, departamentos))
      .then((d) => {
        if (!cancelado) setDatos(d);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestre, veTodos, alcance, departamentos]);

  const cerrarDetalle = useCallback(() => setDetalle(null), []);
  const esAbierto = (f, que) => (n) => detalle?.profesorId === f.id && detalle.que === que && detalle.nivel === n;
  const alternar = (f, que) => (e, n) =>
    setDetalle(esAbierto(f, que)(n) ? null : { profesorId: f.id, que, nivel: n, f, boton: e.currentTarget });

  const todas = useMemo(() => (datos ? calcularSatisfaccion(datos) : []), [datos]);
  const contratosPresentes = useMemo(
    () =>
      Object.keys(TIPO_CONTRATO_LABELS).filter((c) => todas.some((sec) => sec.profesores.some((f) => f.contrato === c))),
    [todas],
  );
  // El filtro por contrato solo esconde filas: la calificación de cada quien no cambia
  const secciones = useMemo(() => {
    const valor = COLUMNAS[orden.columna];
    const ordenar = (lista) =>
      [...lista].sort((a, b) => {
        const c = comparar(valor(a), valor(b));
        return (orden.asc ? c : -c) || comparar(a.nombre, b.nombre);
      });
    return todas
      .map((sec) => ({ ...sec, profesores: ordenar(sec.profesores.filter((f) => contratos.has(f.contrato))) }))
      .filter((sec) => sec.profesores.length);
  }, [todas, contratos, orden]);

  function ordenarPor(columna) {
    setDetalle(null);
    setOrden((prev) =>
      prev.columna === columna
        ? { columna, asc: !prev.asc }
        : // Los números se leen mejor de mayor a menor la primera vez; la
          // calificación, del peor al mejor, que es para lo que está el reporte.
          { columna, asc: columna === 'nombre' || columna === 'contrato' || columna === 's' },
    );
  }
  // La explicación dice cómo cuenta una hora sin contestar, igual que el cálculo
  const sinComo = datos?.entrada?.reglas?.sin_respuesta_cuenta_como || 'rojo';

  return (
    <div className="respuestas-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Satisfacción de los profesores</strong>
            <span>{etiquetaSemestre(semestre)} · qué tanto se parece su horario y su materia a lo que pidieron</span>
          </div>
          {veTodos && (
            <label className="selector-depto">
              Departamento
              <select value={alcance} disabled={!datos && !error} onChange={(e) => setAlcance(e.target.value)}>
                {departamentos.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.nombre}
                  </option>
                ))}
                <option value={TODOS}>Los tres</option>
              </select>
            </label>
          )}
        </div>
        <p className="formulario-nota">
          Cada hora de clase vale 1 si el profesor la marcó en verde, 0 en amarillo y −1 en rojo (sin
          contestar cuenta como {sinComo}); cada grupo vale lo mismo según cómo marcó la materia (sin marcar vale 0). La
          calificación es {PESOS.horario * 100}% el promedio de las horas y {PESOS.materia * 100}% el de
          las materias: 1 es todo en verde y −1 todo en rojo. Las horas de una asignación directa
          cuentan igual que las demás, y los cursos se muestran aparte. Se calcula con
          la malla tal como está ahora.
        </p>
      </header>

      {!semestre && <p className="formulario-error">No hay ningún semestre activo.</p>}
      {error && <p className="formulario-error">{error}</p>}
      {semestre && !datos && !error && <div className="formulario-cargando">Cargando…</div>}
      {datos && contratosPresentes.length > 1 && (
        <div className="respuestas-filtros">
          <fieldset className="filtro-grupo">
            <legend>Contrato</legend>
            <div className="filtro-opciones">
              {contratosPresentes.map((c) => (
                <label className="check-linea" key={c}>
                  <input
                    type="checkbox"
                    checked={contratos.has(c)}
                    onChange={() => {
                      setDetalle(null);
                      setContratos((prev) => alternarEnSet(prev, c));
                    }}
                  />
                  {TIPO_CONTRATO_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {datos && !todas.length && <p className="formulario-nota">Todavía no hay profesores en la malla.</p>}
      {datos && todas.length > 0 && !secciones.length && (
        <p className="formulario-nota">Ningún profesor con ese tipo de contrato.</p>
      )}

      {secciones.map(({ departamento, profesores }) => {
        const conS = profesores.filter((f) => f.s != null);
        const bajos = conS.filter((f) => f.s < 0.9).length;
        return (
          <section className="horarios-depto" key={departamento.id}>
            <div className="horarios-titulo">
              <div>
                <h2>{departamento.nombre}</h2>
                <p>
                  {conS.length} con cursos · {bajos} debajo de 0.90 · {profesores.length - conS.length} sin cursos
                </p>
              </div>
            </div>
            <div className="respuestas-tabla-wrap">
              <table className="panel-tabla reporte-tabla satisf-tabla">
                <thead>
                  <tr>
                    <EncabezadoOrdenable columna="nombre" orden={orden} onOrdenar={ordenarPor}>
                      Profesor
                    </EncabezadoOrdenable>
                    <EncabezadoOrdenable columna="contrato" orden={orden} onOrdenar={ordenarPor}>
                      Contrato
                    </EncabezadoOrdenable>
                    <EncabezadoOrdenable columna="s" orden={orden} onOrdenar={ordenarPor} className="col-num">
                      Calificación
                    </EncabezadoOrdenable>
                    {[
                      ['horas', 'Horas'],
                      ['materias', 'Materias'],
                    ].map(([grupo, titulo]) => (
                      <ThOrdenable key={grupo} columnas={NIVELES.map((n) => `${grupo}-${n}`)} orden={orden}>
                        {titulo}{' '}
                        {NIVELES.map((n, i) => (
                          <span key={n}>
                            {i > 0 && ' · '}
                            <BotonOrden
                              columna={`${grupo}-${n}`}
                              orden={orden}
                              onOrdenar={ordenarPor}
                              className={`th-${n}`}
                            >
                              {n === 'amarillo' ? 'amar.' : n}
                            </BotonOrden>
                          </span>
                        ))}
                      </ThOrdenable>
                    ))}
                    <EncabezadoOrdenable columna="cursos" orden={orden} onOrdenar={ordenarPor} className="col-num">
                      Cursos (tiene / pidió)
                    </EncabezadoOrdenable>
                    <EncabezadoOrdenable columna="dias" orden={orden} onOrdenar={ordenarPor}>
                      Días con clase
                    </EncabezadoOrdenable>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {profesores.map((f) => (
                    <tr key={f.id}>
                      <td>{nombreCompleto(f.nombre)}</td>
                      <td>{TIPO_CONTRATO_LABELS[f.contrato] ?? f.contrato ?? ''}</td>
                      <td className={`col-num satisf-s ${claseS(f.s)}`}>{fmt(f.s)}</td>
                      <td>
                        {f.cursos ? (
                          <Conteo
                            c={f.horario}
                            que="las horas"
                            profesor={f.nombre}
                            abierto={esAbierto(f, 'horas')}
                            onAbrir={alternar(f, 'horas')}
                          />
                        ) : (
                          ''
                        )}
                      </td>
                      <td>
                        {f.cursos ? (
                          <Conteo
                            c={f.materia}
                            que="las materias"
                            profesor={f.nombre}
                            abierto={esAbierto(f, 'materias')}
                            onAbrir={alternar(f, 'materias')}
                          />
                        ) : (
                          ''
                        )}
                      </td>
                      <td className={`col-num${f.pidio != null && f.cursos < f.pidio ? ' satisf-faltan' : ''}`}>
                        {f.cursos} / {f.pidio ?? '–'}
                      </td>
                      <td className="satisf-dias">
                        {f.dias.length ? (
                          <>
                            <strong>{f.dias.length}</strong> {f.dias.map((d) => NOMBRE_DIA[d] ?? d).join(', ')}
                          </>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="satisf-notas">{notas(f).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {detalle && (
        <EtiquetaFlotante
          boton={detalle.boton}
          titulo={
            detalle.que === 'horas'
              ? `${horasTxt(detalle.f.horario[detalle.nivel])} en ${detalle.nivel}`
              : `${detalle.f.materia[detalle.nivel]} ${detalle.f.materia[detalle.nivel] === 1 ? 'grupo' : 'grupos'} en ${detalle.nivel}`
          }
          subtitulo={nombreCompleto(detalle.f.nombre)}
          etiquetaAria={`${detalle.que === 'horas' ? 'Horas' : 'Materias'} en ${detalle.nivel} de ${detalle.f.nombre}`}
          className={`etiqueta-${detalle.nivel}`}
          onCerrar={cerrarDetalle}
        >
          <ul>
            {detalle.que === 'horas'
              ? detalle.f.tramosHorario[detalle.nivel].map((t, i) => (
                  <li key={i}>
                    {NOMBRE_DIA[t.dia] ?? t.dia} {t.inicio}–{t.fin} <span className="materia-alias">{t.clases}</span>
                    {t.maestria && <span className="materia-alias"> · su materia de maestría</span>}
                    {t.porAsignacion && <span className="materia-alias"> · asignación directa</span>}
                  </li>
                ))
              : detalle.f.gruposMateria[detalle.nivel].map((m, i) => (
                  <li key={i}>
                    {m.nombre || m.clases} <span className="materia-alias">{m.clases}</span>
                    {m.sinMarcar && <span className="materia-alias"> · sin marcar</span>}
                  </li>
                ))}
          </ul>
        </EtiquetaFlotante>
      )}
    </div>
  );
}
