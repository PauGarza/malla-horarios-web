import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { leerReporteHoras } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { TIPO_CONTRATO_LABELS, departamentoInicial } from '../lib/roles';
import { DIAS, claveDisponibilidad, franjasDeDepartamento } from '../lib/formulario';
import SelectorDepartamento from '../components/SelectorDepartamento';
import EtiquetaFlotante from '../components/EtiquetaFlotante';

// Reporte de horas: la rejilla lunes-viernes × franjas del formulario, pero
// cada celda dice cuántos profesores la marcaron, y entre más, más oscura. Es
// para ver de un vistazo en qué horarios sobra gente y en cuáles no hay nadie
// (api/reporte.php?recurso=horas). Clic en una celda: quiénes son.
//
// Llegan las celdas de cada profesor sin sumar y se cuentan aquí, para que
// cambiar el nivel o los filtros no vuelva a pedir nada al servidor.

// Qué se cuenta. "Verde o amarillo" es la disponibilidad amplia: lo que el
// motor podría usar aunque al profesor le cueste.
const MODOS = [
  { valor: 'verde', etiqueta: 'Verde', niveles: ['verde'], color: [46, 139, 71] },
  { valor: 'verde_amarillo', etiqueta: 'Verde o amarillo', niveles: ['verde', 'amarillo'], color: [46, 139, 71] },
  { valor: 'amarillo', etiqueta: 'Amarillo', niveles: ['amarillo'], color: [184, 134, 11] },
  { valor: 'rojo', etiqueta: 'Rojo', niveles: ['rojo'], color: [192, 57, 43] },
];

const ESTADOS = [
  { valor: 'enviado', etiqueta: 'Enviado' },
  { valor: 'borrador', etiqueta: 'Borrador' },
];

const NIVEL_LABELS = { verde: 'verde', amarillo: 'amarillo', rojo: 'rojo' };

function alternarEnSet(set, id) {
  const siguiente = new Set(set);
  if (siguiente.has(id)) siguiente.delete(id);
  else siguiente.add(id);
  return siguiente;
}

// La intensidad va de 0.12 (una persona: se tiene que distinguir de "nadie",
// que queda en blanco) a 1 (la celda más pedida). Es relativa al máximo de lo
// que se ve, no al total de profesores: con pocos enviados la escala completa
// se sigue usando.
function estiloCelda(n, maximo, modo) {
  if (n === 0 || maximo === 0) return undefined;
  const alfa = 0.12 + 0.88 * (n / maximo);
  const [r, g, b] = modo.color;
  // El amarillo es claro aun a tope: con texto blanco no se lee nunca.
  const textoClaro = alfa >= 0.55 && modo.valor !== 'amarillo';
  return { background: `rgba(${r}, ${g}, ${b}, ${alfa})`, color: textoClaro ? 'white' : '#1c2733' };
}

export default function ReporteHoras({ onVolver }) {
  const { token, profesor, departamentos, semestre, franjas, nombreDepartamento } = useAuth();

  const [departamentoId, setDepartamentoId] = useState(() =>
    departamentoInicial(profesor, departamentos),
  );
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const [modoValor, setModoValor] = useState('verde');
  const [estados, setEstados] = useState(() => new Set(ESTADOS.map((e) => e.valor)));
  const [contratos, setContratos] = useState(() => new Set(Object.keys(TIPO_CONTRATO_LABELS)));
  // La celda abierta: { clave, etiqueta, boton }.
  const [detalle, setDetalle] = useState(null);
  const cerrarDetalle = useCallback(() => setDetalle(null), []);

  const modo = MODOS.find((m) => m.valor === modoValor);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError('');
      setDetalle(null);
      try {
        if (!semestre) throw new Error('No hay ningún semestre configurado todavía.');
        const r = await leerReporteHoras(token, semestre.id, departamentoId);
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

  const contratosPresentes = useMemo(
    () =>
      Object.keys(TIPO_CONTRATO_LABELS).filter((c) => (datos?.profesores ?? []).some((p) => p.tipo_contrato === c)),
    [datos],
  );

  // Los profesores que cuentan con los filtros puestos. Quien no ha empezado
  // no tiene celdas, así que ni se ofrece como filtro.
  const profesoresContados = useMemo(() => {
    if (!datos) return new Map();
    return new Map(
      datos.profesores
        .filter((p) => estados.has(p.estado) && contratos.has(p.tipo_contrato))
        .map((p) => [p.id, p]),
    );
  }, [datos, estados, contratos]);

  // clave de celda -> [{ profesor, nivel }], ya filtrado por nivel.
  const porCelda = useMemo(() => {
    const mapa = new Map();
    if (!datos) return mapa;
    for (const [profesorId, dia, franjaId, nivel] of datos.celdas) {
      const p = profesoresContados.get(profesorId);
      if (!p || !modo.niveles.includes(nivel)) continue;
      const clave = claveDisponibilidad(dia, franjaId);
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push({ profesor: p, nivel });
    }
    for (const lista of mapa.values()) {
      lista.sort((a, b) => a.profesor.nombre.localeCompare(b.profesor.nombre, 'es'));
    }
    return mapa;
  }, [datos, profesoresContados, modo]);

  const maximo = useMemo(
    () => Math.max(0, ...Array.from(porCelda.values(), (l) => l.length)),
    [porCelda],
  );

  function alternarDetalle(evento, clave, etiqueta) {
    if (detalle?.clave === clave) {
      setDetalle(null);
      return;
    }
    setDetalle({ clave, etiqueta, boton: evento.currentTarget });
  }

  const listaAbierta = detalle ? (porCelda.get(detalle.clave) ?? []) : [];
  const enviados = datos ? datos.profesores.filter((p) => p.estado === 'enviado').length : 0;

  return (
    <div className="respuestas-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Reporte de horas</strong>
            <span>
              {nombreDepartamento(departamentoId)} · {etiquetaSemestre(semestre)}
              {datos && ` · ${enviados} de ${datos.profesores.length} enviados`}
            </span>
          </div>
        </div>
      </header>

      <SelectorDepartamento valor={departamentoId} onCambiar={setDepartamentoId} disabled={cargando} />

      {datos && (
        <div className="respuestas-filtros">
          <fieldset className="filtro-grupo">
            <legend>Qué contar</legend>
            <div className="filtro-opciones">
              {MODOS.map((m) => (
                <label className="check-linea" key={m.valor}>
                  <input
                    type="radio"
                    name="modo-horas"
                    checked={modoValor === m.valor}
                    onChange={() => setModoValor(m.valor)}
                  />
                  {m.etiqueta}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="filtro-grupo">
            <legend>Profesores</legend>
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

      {datos && (
        <div className="calor-escala">
          <span>Nadie</span>
          <span
            className="calor-escala-barra"
            style={{
              background: `linear-gradient(to right, white, rgba(${modo.color.join(', ')}, 1))`,
            }}
            aria-hidden="true"
          />
          <span>
            {maximo} {maximo === 1 ? 'profesor' : 'profesores'}
          </span>
          <span className="formulario-nota">
            de {profesoresContados.size} contados · clic en una celda para ver quiénes
          </span>
        </div>
      )}

      {error && <p className="formulario-error">{error}</p>}

      {cargando ? (
        <div className="formulario-cargando">Cargando…</div>
      ) : (
        datos && (
          <div className="disponibilidad-grid-wrap">
            <table className="disponibilidad-grid calor-grid">
              <thead>
                <tr>
                  <th>Hora</th>
                  {DIAS.map((d) => (
                    <th key={d.valor}>{d.etiqueta}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {franjasDepto.map((f, i) => {
                  const filaAnterior = franjasDepto[i - 1];
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
                          if (f.dias && !f.dias.includes(d.valor)) {
                            return <td key={d.valor} className="slot-no-aplica" aria-hidden="true" />;
                          }
                          const clave = claveDisponibilidad(d.valor, f.id);
                          const n = porCelda.get(clave)?.length ?? 0;
                          const etiqueta = `${d.etiqueta} ${f.hora_inicio.slice(0, 5)}`;
                          if (n === 0) {
                            return (
                              <td key={d.valor} className="calor-celda calor-cero">
                                <span className="visually-hidden">{etiqueta}: nadie</span>
                              </td>
                            );
                          }
                          return (
                            <td key={d.valor} className="calor-celda">
                              <button
                                type="button"
                                style={estiloCelda(n, maximo, modo)}
                                aria-expanded={detalle?.clave === clave}
                                aria-label={`${etiqueta}: ${n} ${n === 1 ? 'profesor' : 'profesores'}`}
                                onClick={(e) => alternarDetalle(e, clave, etiqueta)}
                              >
                                {n}
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
        )
      )}

      {detalle && (
        <EtiquetaFlotante
          boton={detalle.boton}
          titulo={`${listaAbierta.length} ${listaAbierta.length === 1 ? 'profesor' : 'profesores'}`}
          subtitulo={`${detalle.etiqueta} · ${modo.etiqueta.toLowerCase()}`}
          etiquetaAria={`Profesores disponibles ${detalle.etiqueta}`}
          onCerrar={cerrarDetalle}
        >
          <ul>
            {listaAbierta.map(({ profesor: p, nivel }) => (
              <li key={p.id}>
                {modo.niveles.length > 1 && (
                  <i className={`legend-${nivel} etiqueta-punto`} aria-label={NIVEL_LABELS[nivel]} />
                )}
                {p.nombre}
                <span className="materia-alias"> · {TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato}</span>
              </li>
            ))}
          </ul>
        </EtiquetaFlotante>
      )}
    </div>
  );
}
