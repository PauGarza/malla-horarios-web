import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { leerMalla } from '../lib/api';
import { PESOS, calcularSatisfaccion } from '../lib/satisfaccion';
import { TIPO_CONTRATO_LABELS, veMallaDeTodaLaDivision } from '../lib/roles';
import { nombreCompleto } from '../lib/reporteHorarios';
import { etiquetaSemestre } from '../lib/semestre';

// Satisfacción de los profesores: qué tanto se parece lo que le tocó a cada
// quien en la malla a lo que pidió en su formulario, del peor al mejor. Lee lo
// mismo que la malla (api/malla.php); el cálculo está en lib/satisfaccion.js y
// la fórmula en DACE/DISENO-REPORTES.md §2. Solo para la jefatura: los
// profesores no lo ven.

const TODOS = 'todos';

/** Los departamentos que se piden a api/malla.php; null = el de la cuenta. */
const deptosDe = (veTodos, alcance, departamentos) =>
  !veTodos ? null : alcance === TODOS ? departamentos.map((d) => d.id) : [Number(alcance)];

const fmt = (s) => (s == null ? '—' : s.toFixed(2));
const horasTxt = (h) => `${h.toLocaleString('es-MX')} h`;

function claseS(s) {
  if (s == null) return 'satisf-nada';
  if (s >= 0.9) return 'satisf-alta';
  if (s >= 0.5) return 'satisf-media';
  return 'satisf-baja';
}

function Conteo({ c }) {
  return (
    <span className="satisf-conteo">
      <span className="num-verde">{c.verde}</span> · <span className="num-amarillo">{c.amarillo}</span> ·{' '}
      <span className="num-rojo">{c.rojo}</span>
    </span>
  );
}

function notas(f) {
  const out = [];
  if (!f.cursos) out.push(f.pidio === 0 ? 'No pidió cursos' : 'Sin cursos');
  if (f.materiasNoVerdes.length) out.push(f.materiasNoVerdes.join(', '));
  const pa = f.porAsignacion;
  if (pa.amarillo + pa.rojo) {
    out.push(`${horasTxt(pa.amarillo + pa.rojo)} fuera de verde por asignación directa (no cuentan)`);
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

  useEffect(() => {
    if (!semestre) return undefined;
    let cancelado = false;
    setDatos(null);
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

  const secciones = useMemo(() => (datos ? calcularSatisfaccion(datos) : []), [datos]);
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
          las materias: 1 es todo en verde y −1 todo en rojo. Lo que la jefatura fijó a propósito en
          una asignación directa no baja la calificación, y los cursos se muestran aparte. Se calcula con
          la malla tal como está ahora.
        </p>
      </header>

      {!semestre && <p className="formulario-error">No hay ningún semestre activo.</p>}
      {error && <p className="formulario-error">{error}</p>}
      {semestre && !datos && !error && <div className="formulario-cargando">Cargando…</div>}
      {datos && !secciones.length && <p className="formulario-nota">Todavía no hay profesores en la malla.</p>}

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
                    <th>Profesor</th>
                    <th>Contrato</th>
                    <th className="col-num">Calificación</th>
                    <th>
                      Horas <span className="th-verde">verde</span> · <span className="th-amarillo">amar.</span> ·{' '}
                      <span className="th-rojo">rojo</span>
                    </th>
                    <th>Materias</th>
                    <th className="col-num">Cursos (tiene / pidió)</th>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {profesores.map((f) => (
                    <tr key={f.id}>
                      <td>{nombreCompleto(f.nombre)}</td>
                      <td>{TIPO_CONTRATO_LABELS[f.contrato] ?? f.contrato ?? ''}</td>
                      <td className={`col-num satisf-s ${claseS(f.s)}`}>{fmt(f.s)}</td>
                      <td>{f.cursos ? <Conteo c={f.horario} /> : ''}</td>
                      <td>{f.cursos ? <Conteo c={f.materia} /> : ''}</td>
                      <td className={`col-num${f.pidio != null && f.cursos < f.pidio ? ' satisf-faltan' : ''}`}>
                        {f.cursos} / {f.pidio ?? '–'}
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
    </div>
  );
}
