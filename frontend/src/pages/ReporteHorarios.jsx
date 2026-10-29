import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { leerMalla } from '../lib/api';
import { armarReporte } from '../lib/reporteHorarios';
import { veMallaDeTodaLaDivision } from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';

// Horarios del departamento, para descargar en PDF: cómo quedaron los grupos,
// como el max-min de Servicios Escolares. Lee lo mismo que la malla
// (api/malla.php) y el PDF lo hace el navegador al imprimir (window.print(),
// "Guardar como PDF"); la hoja de impresión está en index.css (@media print).
// Diseño en DACE/DISENO-REPORTES.md §1.

const TODOS = 'todos';
// Filtro por contrato (2026-10-29), como el de la malla: solo los grupos con algún
// profesor de ese contrato. Un grupo sin profesor no tiene contrato y sale del filtro.
const CONTRATOS = [
  ['tiempo_completo', 'Tiempo completo'],
  ['medio_tiempo', 'Medio tiempo'],
  ['asignatura', 'Asignatura'],
];

/** Los departamentos que se piden a api/malla.php; null = el de la cuenta. */
const deptosDe = (veTodos, alcance, departamentos) =>
  !veTodos ? null : alcance === TODOS ? departamentos.map((d) => d.id) : [Number(alcance)];

export default function ReporteHorarios({ onVolver }) {
  const { token, profesor, departamentos, semestre } = useAuth();
  const veTodos = veMallaDeTodaLaDivision(profesor.rol);
  const [alcance, setAlcance] = useState(TODOS);
  const [contrato, setContrato] = useState(TODOS);
  const [materia, setMateria] = useState(TODOS);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [generado, setGenerado] = useState(null);

  useEffect(() => {
    if (!semestre) return undefined;
    let cancelado = false;
    setDatos(null);
    setError('');
    leerMalla(token, semestre.id, deptosDe(veTodos, alcance, departamentos))
      .then((d) => {
        if (cancelado) return;
        setDatos(d);
        setGenerado(new Date());
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestre, veTodos, alcance, departamentos]);

  const completo = useMemo(() => (datos ? armarReporte(datos) : []), [datos]);
  // Los contratos que tienen grupos en el reporte, para no ofrecer uno vacío
  const hayContrato = useMemo(
    () => new Set(completo.flatMap((s) => s.renglones.flatMap((r) => r.contratos))),
    [completo],
  );
  // Las materias del reporte por departamento, para el selector: [{ departamento, materias: [{ clave, nombre }] }]
  const materias = useMemo(
    () =>
      completo.map((s) => {
        const vistas = new Map();
        for (const r of s.renglones) if (!vistas.has(r.clave)) vistas.set(r.clave, r.materia);
        return { departamento: s.departamento, materias: [...vistas].map(([clave, nombre]) => ({ clave, nombre })) };
      }),
    [completo],
  );
  const secciones = useMemo(() => {
    if (contrato === TODOS && materia === TODOS) return completo;
    return completo
      .map((s) => {
        const renglones = s.renglones.filter(
          (r) => (contrato === TODOS || r.contratos.includes(contrato)) && (materia === TODOS || r.clave === materia),
        );
        return { ...s, renglones, pendientes: renglones.filter((r) => r.faltan.length) };
      })
      .filter((s) => s.renglones.length);
  }, [completo, contrato, materia]);
  const etiquetaContrato = (CONTRATOS.find(([v]) => v === contrato) || [])[1];
  const filtroTxt = [
    materia !== TODOS && 'solo ' + materia,
    etiquetaContrato && 'solo profesores de ' + etiquetaContrato.toLowerCase(),
  ].filter(Boolean);
  const enRevision = Boolean(datos && datos.grupos.length);
  const fecha = generado
    ? generado.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })
    : '';

  return (
    <div className="respuestas-screen horarios-reporte">
      <header className="formulario-header no-imprimir">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Horarios del departamento</strong>
            <span>
              {etiquetaSemestre(semestre)} · los grupos con su profesor, horario y salón, para descargar en PDF
            </span>
          </div>
          <div className="horarios-acciones">
            {veTodos && (
              <label className="selector-depto">
                Departamento
                <select value={alcance} disabled={!datos && !error} onChange={(e) => {
                    setAlcance(e.target.value);
                    setMateria(TODOS);
                  }}
                >
                  {departamentos.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.nombre}
                    </option>
                  ))}
                  <option value={TODOS}>Los tres</option>
                </select>
              </label>
            )}
            <label className="selector-depto">
              Contrato
              <select value={contrato} disabled={!datos} onChange={(e) => setContrato(e.target.value)}>
                <option value={TODOS}>Todos los profesores</option>
                {CONTRATOS.filter(([v]) => hayContrato.has(v) || v === contrato).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="selector-depto">
              Materia
              <select value={materia} disabled={!datos} onChange={(e) => setMateria(e.target.value)}>
                <option value={TODOS}>Todas las materias</option>
                {materias.map(({ departamento, materias: ms }) => {
                  const opciones = ms.map((m) => (
                    <option key={m.clave} value={m.clave}>
                      {m.clave} · {m.nombre}
                    </option>
                  ));
                  return materias.length > 1 ? (
                    <optgroup key={departamento.id} label={departamento.nombre}>
                      {opciones}
                    </optgroup>
                  ) : (
                    opciones
                  );
                })}
              </select>
            </label>
            <button type="button" className="btn-primary" disabled={!secciones.length} onClick={() => window.print()}>
              Descargar PDF
            </button>
          </div>
        </div>
        <p className="formulario-nota">
          Al descargar se abre la ventana de impresión: elige «Guardar como PDF» como destino.
        </p>
      </header>

      {!semestre && <p className="formulario-error">No hay ningún semestre activo.</p>}
      {error && <p className="formulario-error">{error}</p>}
      {semestre && !datos && !error && <div className="formulario-cargando">Cargando…</div>}
      {datos && !secciones.length && (
        <p className="formulario-nota">
          {completo.length
            ? 'Ningún grupo cumple con los filtros.'
            : 'Todavía no hay grupos en la malla.'}
        </p>
      )}

      {secciones.map(({ departamento, renglones, pendientes }) => (
        <section className="horarios-depto" key={departamento.id}>
          <div className="horarios-titulo">
            <div>
              <h2>Horarios de {departamento.nombre}</h2>
              <p>
                {etiquetaSemestre(semestre)} · {renglones.length} {renglones.length === 1 ? 'grupo' : 'grupos'}
                {filtroTxt.map((t) => ` · ${t}`).join('')}
              </p>
            </div>
            <p className="horarios-generado">
              Generado el {fecha}
              {enRevision && (
                <>
                  <br />
                  Malla en revisión: puede cambiar hasta que se publique.
                </>
              )}
            </p>
          </div>

          <table className="panel-tabla horarios-tabla">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Materia y profesor</th>
                <th className="col-centro">Sem.</th>
                <th>Días</th>
                <th>Horario</th>
                <th>Salón</th>
                <th className="col-num">Cupo</th>
              </tr>
            </thead>
            {renglones.map((r) => (
              <tbody key={r.key}>
                <tr>
                  <td className="horarios-grupo">{r.grupo}</td>
                  <td>
                    <div className="horarios-materia">{r.materia}</div>
                    <div className={r.sinProfesor ? 'horarios-profesor horarios-falta' : 'horarios-profesor'}>
                      <b>Profesor:</b> {r.profesores}
                    </div>
                    {r.compartido.length > 0 && (
                      <div className="horarios-nota">Compartido con {r.compartido.join(', ')}</div>
                    )}
                  </td>
                  <td className="col-centro">{r.semestre}</td>
                  {r.horario.length ? (
                    <>
                      <td>
                        {r.horario.map((h) => (
                          <div key={h.horas}>{h.dias}</div>
                        ))}
                      </td>
                      <td className="horarios-horas">
                        {r.horario.map((h) => (
                          <div key={h.horas}>{h.horas}</div>
                        ))}
                      </td>
                      <td>{r.salon}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="horarios-falta">
                      Sin horario
                    </td>
                  )}
                  <td className="col-num">{r.cupo ?? '–'}</td>
                </tr>
              </tbody>
            ))}
          </table>

          {pendientes.length > 0 && (
            <div className="horarios-pendientes">
              <h3>Pendientes</h3>
              <ul>
                {pendientes.map((r) => (
                  <li key={r.key}>
                    <b>{r.grupo}</b> {r.materia}: {r.faltan.join(' y ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
