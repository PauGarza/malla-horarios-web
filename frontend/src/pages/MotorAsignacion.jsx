import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  aplicarSalidaMotor,
  contarSalonesMotor,
  descargarEntradaMotor,
  descargarReferenciaMalla,
  leerCorridasMotor,
  leerVersionesMalla,
  validarSalidaMotor,
} from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';

// Datos para el motor de asignación (D39, D43). El motor se corre fuera del
// sistema y no toca la base: aquí se baja el paquete autoplanear-entrada/2 y
// se sube el autoplanear-salida/2 que devuelve. La subida se valida primero
// (reglas de §5 de la convención) y solo al confirmar se escribe en
// grupo / imparte, sin publicar. La vista de malla leerá de ahí.
//
// Solo admin por ahora. Formato: malla-horarios/docs/convencion-datos-motor.md.
//
// Versiones (2026-10-29, D60): cada subida guarda la malla que deja. Aquí se ve
// si una subida dejó la misma malla que la anterior y qué versión prefiere cada
// jefatura, para bajarla y usarla de referencia en la siguiente corrida.

const TODOS = 'todos';

const NOMBRE_TIPO = {
  // Errores (reglas duras de §5)
  estructura: 'Formato del archivo',
  convencion: 'Versión de la convención',
  semestre: 'Semestre',
  ids: 'Datos que no vienen en la descarga',
  alcance: 'Fuera de los departamentos descargados',
  co_oferta: 'Co-oferta',
  sesiones: 'Horarios fuera de la rejilla',
  salon_no_autorizado: 'Salón no disponible para el departamento',
  salon_tipo: 'Tipo de salón',
  salon_capacidad: 'Capacidad del salón',
  disponibilidad: 'Profesor en una hora roja o sin respuesta',
  bloqueo: 'Materia bloqueada',
  choque_profesor: 'Choque de profesor',
  choque_salon: 'Choque de salón',
  asignacion_fija: 'Asignaciones directas',
  tope_asignatura: 'Tope de horas de asignatura',
  // Avisos (blandas de §5 y §4.4)
  creditos_distintos: 'Bloques distintos a los créditos',
  grupos_de_mas: 'Más grupos que los sugeridos',
  grupos_de_menos: 'Menos grupos que los sugeridos',
  excede_num_cursos: 'Más cursos de los que pidió',
  media_hora_suelta: 'Medias horas sueltas',
  disponibilidad_amarilla: 'Horas en amarillo',
  materia_amarilla: 'Materias en amarillo',
  materia_no_marcada: 'Materias que no marcó',
  materia_roja: 'Materias en rojo',
  borrador_usado: 'Se usó un borrador sin enviar',
  cupo_reducido: 'Cupo reducido por el salón',
};
const nombreTipo = (t) => NOMBRE_TIPO[t] ?? t;

/** "2026-10-13T11:30:00-06:00" -> "20261013-1130", como pide §1 para el nombre del archivo. */
function sello(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}` : 'sin-fecha';
}

function fechaLegible(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function nombreArchivo(entrada) {
  const alcance =
    entrada.departamentos.length === 3 ? 'DACE' : entrada.departamentos.map((d) => d.clave_prefijo).join('-');
  return `entrada_${entrada.semestre.tipo}-${entrada.semestre.anio}_${alcance}_${sello(entrada.generado_at)}.json`;
}

/** Lo que conviene revisar del paquete antes de correr el motor. */
function resumirEntrada(e) {
  const conDemanda = e.materias.filter((m) => m.demanda);
  const estado = (p) => p.preferencia?.estado ?? 'no_iniciado';
  return {
    materias: conDemanda.length,
    // El motor solo evita choques entre materias del mismo plan y semestre si la
    // materia está en algún plan (plan_estudio_materia). Qué versiones cuentan lo
    // decide el motor.
    conSemestre: conDemanda.filter((m) => (m.planes ?? []).length > 0).length,
    sugeridos: conDemanda.reduce((n, m) => n + m.demanda.grupos_sugeridos, 0),
    profesores: e.profesores.length,
    enviados: e.profesores.filter((p) => estado(p) === 'enviado').length,
    borradores: e.profesores.filter((p) => estado(p) === 'borrador').length,
    sinContestar: e.profesores.filter((p) => estado(p) === 'no_iniciado').length,
    asignaciones: e.asignaciones_fijas.length,
    fijos: e.grupos_fijos.length,
    salones: e.salones.length,
  };
}

function bajarArchivo(nombre, datos) {
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Los avisos del motor (§4.4) vienen sueltos; se agrupan por tipo como los del sistema. */
function agruparAvisosMotor(avisos) {
  const porTipo = new Map();
  for (const a of avisos) {
    if (!porTipo.has(a.tipo)) porTipo.set(a.tipo, []);
    porTipo.get(a.tipo).push([a.ref, a.mensaje].filter(Boolean).join(': ') || JSON.stringify(a));
  }
  return [...porTipo].map(([tipo, mensajes]) => ({ tipo, total: mensajes.length, mensajes: mensajes.slice(0, 50) }));
}

function ListaPorTipo({ grupos, clase }) {
  return (
    <div className="motor-tipos">
      {grupos.map((g) => (
        <details key={g.tipo} className={`motor-tipo ${clase}`}>
          <summary>
            <strong>{nombreTipo(g.tipo)}</strong> <span className="motor-cuenta">{g.total}</span>
          </summary>
          <ul>
            {g.mensajes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          {g.total > g.mensajes.length && (
            <p className="formulario-nota">… y {g.total - g.mensajes.length} más.</p>
          )}
        </details>
      ))}
    </div>
  );
}

function Cifra({ valor, texto, alerta }) {
  return (
    <div className={`motor-cifra ${alerta ? 'alerta' : ''}`}>
      <b>{valor}</b>
      <span>{texto}</span>
    </div>
  );
}

export default function MotorAsignacion({ onVolver }) {
  const { token, departamentos, semestre } = useAuth();

  // --- Descarga ---
  const [alcance, setAlcance] = useState(() => String(departamentos[0]?.id ?? TODOS));
  const deptosAlcance =
    alcance === TODOS ? departamentos.map((d) => d.id) : [Number(alcance)];
  const clavesAlcance = deptosAlcance.join(',');
  const [conSalones, setConSalones] = useState(false);
  const [salonesDisponibles, setSalonesDisponibles] = useState(null);
  const [descargando, setDescargando] = useState(false);
  const [descargado, setDescargado] = useState(null);

  // --- Subida ---
  const [archivo, setArchivo] = useState(null); // { nombre, salida }
  const [revision, setRevision] = useState(null);
  const [revisando, setRevisando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  // --- Estado ---
  const [corridas, setCorridas] = useState(null);
  const [preferidas, setPreferidas] = useState([]); // [{ departamento_id, corrida_id, subido_at, preferida }]
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    if (!semestre) return;
    let cancelado = false;
    setSalonesDisponibles(null);
    contarSalonesMotor(token, semestre.id, clavesAlcance.split(','))
      .then((r) => !cancelado && setSalonesDisponibles(r.salones))
      .catch(() => !cancelado && setSalonesDisponibles(null));
    return () => {
      cancelado = true;
    };
  }, [token, semestre, clavesAlcance]);

  const cargarCorridas = useCallback(async () => {
    if (!semestre) return;
    try {
      setCorridas(await leerCorridasMotor(token, semestre.id));
    } catch (err) {
      setError(err.message);
    }
    // Sin la tabla de versiones (antes de su migración) la página sigue igual, sin esa sección.
    try {
      const { versiones } = await leerVersionesMalla(token, semestre.id, departamentos.map((d) => d.id));
      setPreferidas(
        versiones.flatMap((v) =>
          v.departamentos
            .filter((d) => d.preferida)
            .map((d) => ({ departamento_id: d.departamento_id, corrida_id: v.corrida_id, subido_at: v.subido_at, preferida: d.preferida })),
        ),
      );
    } catch {
      setPreferidas([]);
    }
  }, [token, semestre, departamentos]);

  async function bajarReferencia(p) {
    setError('');
    try {
      const ref = await descargarReferenciaMalla(token, semestre.id, [p.departamento_id], p.corrida_id);
      const depto = nombreDepto(p.departamento_id)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-');
      bajarArchivo(`referencia_${semestre.tipo}-${semestre.anio}_${depto}_${sello(p.subido_at)}.json`, ref);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    cargarCorridas();
  }, [cargarCorridas]);

  const nombreDepto = (id) => departamentos.find((d) => d.id === id)?.nombre ?? `Departamento ${id}`;
  const nombreAlcance = (ids) =>
    ids.length === departamentos.length && departamentos.length > 1
      ? 'Los tres (DACE)'
      : ids.map(nombreDepto).join(', ');

  async function descargar() {
    setDescargando(true);
    setError('');
    setMensaje('');
    try {
      const incluir = conSalones && salonesDisponibles !== 0;
      const entrada = await descargarEntradaMotor(token, semestre.id, deptosAlcance, incluir);
      const nombre = nombreArchivo(entrada);
      bajarArchivo(nombre, entrada);
      setDescargado({ nombre, resumen: resumirEntrada(entrada), conSalones: incluir });
    } catch (err) {
      setError(err.message);
    } finally {
      setDescargando(false);
    }
  }

  async function elegirArchivo(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setMensaje('');
    setRevision(null);
    setConfirmado(false);
    let salida;
    try {
      salida = JSON.parse(await f.text());
    } catch {
      setArchivo(null);
      setError(`${f.name} no es un JSON válido.`);
      return;
    }
    setArchivo({ nombre: f.name, salida });
    setRevisando(true);
    try {
      setRevision(await validarSalidaMotor(token, salida));
    } catch (err) {
      setError(err.message);
    } finally {
      setRevisando(false);
    }
  }

  async function aplicar() {
    setAplicando(true);
    setError('');
    try {
      const r = await aplicarSalidaMotor(token, archivo.salida, confirmado);
      setMensaje(
        `Listo: ${r.corrida.grupos_creados} grupos creados` +
          (r.corrida.grupos_reemplazados ? `, ${r.corrida.grupos_reemplazados} reemplazados` : '') +
          '. Quedaron sin publicar.',
      );
      setArchivo(null);
      setRevision(null);
      setConfirmado(false);
      await cargarCorridas();
    } catch (err) {
      setError(err.message);
    } finally {
      setAplicando(false);
    }
  }

  const res = revision?.resumen;
  const errores = revision?.errores ?? [];
  const desfase = revision?.desfase;
  const pideConfirmar = Boolean(res && (desfase?.desfasada || res.reemplaza > 0));
  const puedeAplicar = revision && errores.length === 0 && (!pideConfirmar || confirmado);

  const gruposHoy = corridas?.grupos ?? [];
  const cuentaGrupos = (f) => gruposHoy.filter(f).reduce((n, g) => n + g.n, 0);

  if (!semestre) {
    return (
      <div className="formulario-screen motor-screen">
        <p className="formulario-error">No hay ningún semestre activo.</p>
      </div>
    );
  }

  return (
    <div className="formulario-screen motor-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Datos para el motor</strong>
            <span>{etiquetaSemestre(semestre)}</span>
          </div>
        </div>
      </header>

      <p className="formulario-nota">
        1. Descarga los datos del semestre. 2. Corre el motor con ese archivo, fuera del sistema. 3. Sube
        aquí el resultado: se revisa contra las reglas y, si no tiene errores, se crean los grupos sin
        publicar.
      </p>

      {error && <p className="formulario-error">{error}</p>}
      {mensaje && <p className="formulario-mensaje">{mensaje}</p>}

      {/* ---------------------------------------------------------------- */}
      <section className="formulario-seccion">
        <h2>1. Descargar los datos para el motor</h2>
        <p className="formulario-nota">
          Materias con demanda, profesores con lo que contestaron (con los ajustes de cursos, bloqueos y
          materias de maestría de la jefatura), asignaciones directas y los grupos fijos: los publicados y los que la
          jefatura conservó al editar la malla, que el motor no mueve.
        </p>
        <div className="motor-controles">
          <label>
            Departamentos
            <select value={alcance} onChange={(e) => setAlcance(e.target.value)}>
              {departamentos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
              {departamentos.length > 1 && <option value={TODOS}>Los tres (DACE)</option>}
            </select>
          </label>
          <label className="motor-casilla">
            <input
              type="checkbox"
              checked={conSalones && salonesDisponibles !== 0}
              disabled={salonesDisponibles === 0}
              onChange={(e) => setConSalones(e.target.checked)}
            />
            Incluir salones
            {salonesDisponibles === 0
              ? ' (todavía no hay salones cargados para este semestre)'
              : salonesDisponibles !== null && ` (${salonesDisponibles} con disponibilidad este semestre)`}
          </label>
        </div>
        <p className="formulario-nota">
          {conSalones && salonesDisponibles !== 0
            ? 'El motor asigna profesor, horario y salón.'
            : 'Sin salones: el motor asigna profesor y horario, y los grupos quedan "en asignación" hasta que se carguen los salones del semestre y se vuelva a correr.'}
        </p>
        <button className="btn-primary motor-boton" disabled={descargando} onClick={descargar}>
          {descargando ? 'Armando el paquete…' : 'Descargar'}
        </button>

        {descargado && (
          <div className="motor-descargado">
            <p className="formulario-nota">
              Se descargó <strong>{descargado.nombre}</strong>.
            </p>
            <div className="motor-cifras">
              <Cifra valor={descargado.resumen.materias} texto="materias con demanda" alerta={descargado.resumen.materias === 0} />
              <Cifra
                valor={descargado.resumen.conSemestre}
                texto="con semestre en algún plan"
                alerta={descargado.resumen.conSemestre < descargado.resumen.materias}
              />
              <Cifra valor={descargado.resumen.sugeridos} texto="grupos sugeridos" />
              <Cifra valor={descargado.resumen.profesores} texto="profesores" />
              <Cifra valor={descargado.resumen.enviados} texto="enviaron su formulario" />
              <Cifra valor={descargado.resumen.borradores} texto="en borrador" alerta={descargado.resumen.borradores > 0} />
              <Cifra valor={descargado.resumen.sinContestar} texto="sin contestar" alerta={descargado.resumen.sinContestar > 0} />
              <Cifra valor={descargado.resumen.asignaciones} texto="asignaciones directas" />
              <Cifra valor={descargado.resumen.fijos} texto="clases fijas (publicadas o conservadas)" />
              <Cifra valor={descargado.resumen.salones} texto="salones" alerta={descargado.conSalones && descargado.resumen.salones === 0} />
            </div>
            {descargado.resumen.materias === 0 && (
              <p className="formulario-aviso">
                No hay demanda cargada para este alcance: el motor no tiene grupos que abrir. Carga la
                estimación de demanda primero.
              </p>
            )}
            {descargado.resumen.materias > 0 && descargado.resumen.conSemestre < descargado.resumen.materias && (
              <p className="formulario-aviso">
                {descargado.resumen.materias - descargado.resumen.conSemestre} materias con demanda no están en
                ningún plan de estudios (casi siempre optativas): el motor no cuida que no choquen con las de
                su semestre.
              </p>
            )}
            {descargado.resumen.sinContestar > 0 && (
              <p className="formulario-aviso">
                Hay profesores sin contestar: todas sus horas cuentan como rojo y el motor no les asignará
                nada (salvo asignaciones directas).
              </p>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="formulario-seccion">
        <h2>2. Subir el resultado del motor</h2>
        <p className="formulario-nota">
          El archivo <em>salida_….json</em> (convención <code>autoplanear-salida/2</code>). Primero se revisa;
          nada se escribe hasta que lo apliques.
        </p>
        <label className="btn-secondary motor-boton motor-subir">
          {revisando ? 'Revisando…' : archivo ? 'Elegir otro archivo' : 'Elegir el archivo'}
          <input type="file" accept="application/json,.json" hidden disabled={revisando || aplicando} onChange={elegirArchivo} />
        </label>

        {archivo && revision && (
          <div className="motor-revision">
            <p className="formulario-nota">
              <strong>{archivo.nombre}</strong>
              {revision.motor?.nombre &&
                ` · motor ${revision.motor.nombre}${revision.motor.version ? ` ${revision.motor.version}` : ''}`}
              {revision.motor?.ejecutado_at && ` · corrido el ${fechaLegible(revision.motor.ejecutado_at)}`}
            </p>

            {errores.length > 0 ? (
              <>
                <p className="formulario-error">
                  Rechazado: {errores.reduce((n, g) => n + g.total, 0)} errores en reglas que no se pueden
                  romper. No se puede aplicar; hay que corregir el motor o los datos y volver a correrlo.
                </p>
                <ListaPorTipo grupos={errores} clase="error" />
              </>
            ) : (
              <p className="formulario-mensaje">Cumple todas las reglas duras.</p>
            )}

            {desfase?.desfasada && (
              <p className="formulario-aviso">
                {desfase.reconocida
                  ? `Algo cambió desde la descarga del ${fechaLegible(desfase.descargado_at)} (demanda, preferencias, bloqueos, asignaciones o grupos). El resultado se revisó contra los datos de hoy, pero el motor no los vio.`
                  : 'No se reconoce la descarga de la que salió este resultado (¿se armó a mano?). Se revisó contra los datos de hoy.'}
              </p>
            )}

            {res && (
              <div className="motor-cifras">
                <Cifra valor={res.clases} texto="clases nuevas" />
                <Cifra valor={res.grupos} texto="grupos (claves)" />
                <Cifra valor={res.sin_profesor} texto="sin profesor" alerta={res.sin_profesor > 0} />
                <Cifra valor={res.sin_horario} texto="sin horario" alerta={res.sin_horario > 0} />
                <Cifra valor={res.sin_salon} texto="sin salón" alerta={desfase?.con_salones && res.sin_salon > 0} />
                <Cifra valor={res.sin_asignar} texto="grupos sin asignar" alerta={res.sin_asignar > 0} />
                <Cifra valor={res.bloques.verde} texto="bloques en verde" />
                <Cifra valor={res.bloques.amarillo} texto="bloques en amarillo" />
                <Cifra valor={res.grupos_fijos} texto="clases fijas que no se tocan (publicadas o conservadas)" />
                {res.conserva > 0 && <Cifra valor={res.conserva} texto="grupos que conservó la jefatura" />}
              </div>
            )}

            {revision.sin_asignar.length > 0 && (
              <details className="motor-tipo aviso">
                <summary>
                  <strong>Demanda sin cubrir</strong>{' '}
                  <span className="motor-cuenta">{revision.sin_asignar.length}</span>
                </summary>
                <ul>
                  {revision.sin_asignar.map((x) => (
                    <li key={x.materia_id}>
                      {x.clave}: {x.grupos_faltantes} {x.grupos_faltantes === 1 ? 'grupo' : 'grupos'}
                      {x.motivo && ` — ${x.motivo}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {(revision.avisos.length > 0 || revision.avisos_motor.length > 0) && (
              <>
                <h3>Avisos</h3>
                <p className="formulario-nota">Reglas que se pueden romper: no impiden aplicar.</p>
                <ListaPorTipo grupos={revision.avisos} clase="aviso" />
                <ListaPorTipo grupos={agruparAvisosMotor(revision.avisos_motor)} clase="aviso" />
              </>
            )}

            {errores.length === 0 && (
              <div className="motor-aplicar">
                {pideConfirmar && (
                  <label className="motor-casilla">
                    <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
                    {[
                      res.reemplaza > 0 &&
                        `Se borran los ${res.reemplaza} grupos sin publicar que dejó la corrida anterior de este alcance` +
                          (res.conserva > 0
                            ? ` y que nadie tocó; los ${res.conserva} que la jefatura conservó en la malla se quedan.`
                            : '.'),
                      desfase?.desfasada && 'Lo aplico aunque los datos hayan cambiado desde la descarga.',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </label>
                )}
                <button className="btn-primary motor-boton" disabled={!puedeAplicar || aplicando} onClick={aplicar}>
                  {aplicando ? 'Aplicando…' : 'Aplicar el resultado'}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="formulario-seccion">
        <h2>Resultados aplicados</h2>
        {corridas === null ? (
          <p className="formulario-nota">Cargando…</p>
        ) : (
          <>
            <p className="formulario-nota">
              Hoy hay {cuentaGrupos(() => true)} grupos en {etiquetaSemestre(semestre)}:{' '}
              {cuentaGrupos((g) => g.estado === 'asignado')} asignados,{' '}
              {cuentaGrupos((g) => g.estado === 'en_asignacion')} en asignación y{' '}
              {cuentaGrupos((g) => g.publicado)} publicados. La vista de malla para revisarlos y publicarlos
              es el siguiente paso.
            </p>
            {corridas.corridas.length === 0 ? (
              <p className="formulario-nota">Todavía no se ha aplicado ningún resultado este semestre.</p>
            ) : (
              <div className="disponibilidad-grid-wrap">
                <table className="panel-tabla">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Departamentos</th>
                      <th>Motor</th>
                      <th>Creados</th>
                      <th>Reemplazados</th>
                      <th>Sin asignar</th>
                      <th>Avisos</th>
                      <th>Subió</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corridas.corridas.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {fechaLegible(c.subido_at)}
                          {c.desfasada && <span className="badge badge-borrador">desfasado</span>}
                          {c.igual_a_la_anterior && (
                            <span className="badge" title="Dejó en la malla exactamente lo mismo que la subida anterior">
                              igual a la anterior
                            </span>
                          )}
                        </td>
                        <td>{nombreAlcance(c.departamentos)}</td>
                        <td>{c.motor ? `${c.motor.nombre ?? ''} ${c.motor.version ?? ''}`.trim() : '—'}</td>
                        <td>{c.grupos_creados}</td>
                        <td>{c.grupos_reemplazados}</td>
                        <td>{c.grupos_sin_asignar}</td>
                        <td>{c.avisos_motor + c.avisos_sistema}</td>
                        <td>{c.subido_por}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="formulario-seccion">
        <h2>Versiones que prefiere la jefatura</h2>
        <p className="formulario-nota">
          Cada resultado aplicado queda guardado y la jefatura puede volver a verlo desde la malla. Si marca uno
          como el que prefiere, aparece aquí: se descarga y se le pasa al motor como referencia, para que la
          siguiente corrida se le parezca lo más posible con los datos de hoy.
        </p>
        {preferidas.length === 0 ? (
          <p className="formulario-nota">Ninguna jefatura ha marcado una versión.</p>
        ) : (
          <div className="disponibilidad-grid-wrap">
            <table className="panel-tabla">
              <thead>
                <tr>
                  <th>Departamento</th>
                  <th>Versión del</th>
                  <th>La marcó</th>
                  <th>Nota</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {preferidas.map((p) => (
                  <tr key={`${p.departamento_id}-${p.corrida_id}`}>
                    <td>{nombreDepto(p.departamento_id)}</td>
                    <td>{fechaLegible(p.subido_at)}</td>
                    <td>
                      {p.preferida.por} ({fechaLegible(p.preferida.at)})
                    </td>
                    <td>{p.preferida.nota ?? '—'}</td>
                    <td>
                      <button type="button" className="btn-link" onClick={() => bajarReferencia(p)}>
                        Descargar como referencia
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
