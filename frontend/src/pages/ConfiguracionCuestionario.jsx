import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';

const SECCIONES = [
  { valor: 'cobertura_departamental', etiqueta: 'Cobertura dept.' },
  { valor: 'catalogo_general', etiqueta: 'Catálogo' },
  { valor: 'oculta', etiqueta: 'Oculta' },
];

const MODO_LABELS = {
  todas: 'Ve el cuestionario del departamento',
  personalizada: 'Lista personalizada',
  ninguna: 'No elige materias — solo horario',
};

// Mismo mínimo que valida el formulario del profesor. Si una lista
// personalizada queda por debajo, esa persona no va a poder enviar.
const MIN_GENERAL = 5;

export default function ConfiguracionCuestionario({ onVolver }) {
  const { token, profesor, nombreDepartamento } = useAuth();
  const [pestana, setPestana] = useState('departamento');

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [semestre, setSemestre] = useState(null);
  const [materias, setMaterias] = useState([]);
  const [config, setConfig] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);

  const [mostrarSeleccion, setMostrarSeleccion] = useState(true);
  const [horasMinimas, setHorasMinimas] = useState(10);

  const departamentoId = profesor.departamento_id;

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const [semestres, materiasDepto] = await Promise.all([
          apiFetch('/semestre?select=id,tipo,anio,etiqueta&order=id.desc&limit=1', token),
          apiFetch(
            `/materia?select=id,clave,nombre&departamento_id=eq.${departamentoId}&activa=eq.true&order=clave.asc`,
            token,
          ),
        ]);
        const sem = semestres[0];
        if (!sem) throw new Error('No hay ningún semestre configurado todavía.');

        const [filasConfig, configDepto] = await Promise.all([
          apiFetch(
            `/materia_cuestionario?select=materia_id,seccion,alias_de_id,etiqueta,orden,revisado&semestre_id=eq.${sem.id}`,
            token,
          ),
          apiFetch(
            `/departamento_semestre_config?select=mostrar_seleccion_materias,horas_minimas_verde&departamento_id=eq.${departamentoId}&semestre_id=eq.${sem.id}`,
            token,
          ),
        ]);

        if (cancelado) return;
        setSemestre(sem);
        setMaterias(materiasDepto);
        setConfig(Object.fromEntries(filasConfig.map((c) => [c.materia_id, c])));
        setMostrarSeleccion(configDepto[0]?.mostrar_seleccion_materias ?? true);
        setHorasMinimas(configDepto[0]?.horas_minimas_verde ?? 10);
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
  }, [token, departamentoId]);

  // Una materia sin fila se comporta como catálogo general (igual que en el
  // formulario del profesor), y cuenta como "por revisar".
  const filaDe = useCallback(
    (materiaId) =>
      config[materiaId] ?? {
        seccion: 'catalogo_general',
        alias_de_id: null,
        etiqueta: null,
        revisado: false,
      },
    [config],
  );

  const ordenadas = useMemo(() => {
    // Las que faltan por revisar van primero: son el trabajo pendiente.
    return [...materias].sort((a, b) => {
      const ra = filaDe(a.id).revisado;
      const rb = filaDe(b.id).revisado;
      if (ra !== rb) return ra ? 1 : -1;
      return a.clave.localeCompare(b.clave);
    });
  }, [materias, filaDe]);

  const porRevisar = materias.filter((m) => !filaDe(m.id).revisado).length;
  const conteos = SECCIONES.map((s) => ({
    ...s,
    n: materias.filter((m) => filaDe(m.id).seccion === s.valor).length,
  }));

  // Candidatas a "alias de": las que sí se muestran en el cuestionario.
  const visibles = materias.filter((m) => filaDe(m.id).seccion !== 'oculta');

  async function guardarFila(materiaId, cambios) {
    setGuardandoId(materiaId);
    setError('');
    const anterior = config[materiaId];
    const fila = { ...filaDe(materiaId), ...cambios, materia_id: materiaId, semestre_id: semestre.id };
    // Un alias solo tiene sentido en una materia oculta; el CHECK de la base
    // rechazaría la combinación, así que se limpia antes de mandarla.
    if (fila.seccion !== 'oculta') fila.alias_de_id = null;

    setConfig((prev) => ({ ...prev, [materiaId]: fila }));
    try {
      await apiFetch('/materia_cuestionario', token, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(fila),
      });
    } catch (err) {
      setError(err.message);
      // Revertir: dejar la pantalla mostrando algo que no se guardó es peor
      // que el error mismo.
      setConfig((prev) => {
        const siguiente = { ...prev };
        if (anterior) siguiente[materiaId] = anterior;
        else delete siguiente[materiaId];
        return siguiente;
      });
    } finally {
      setGuardandoId(null);
    }
  }

  async function marcarRestantesRevisadas() {
    const pendientes = materias.filter((m) => !filaDe(m.id).revisado);
    if (pendientes.length === 0) return;
    if (
      !window.confirm(
        `¿Marcar ${pendientes.length} materias como correctas tal como están ahora? Puedes seguir cambiándolas después.`,
      )
    ) {
      return;
    }
    setError('');
    const filas = pendientes.map((m) => ({
      ...filaDe(m.id),
      materia_id: m.id,
      semestre_id: semestre.id,
      revisado: true,
    }));
    try {
      await apiFetch('/materia_cuestionario', token, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(filas),
      });
      setConfig((prev) => {
        const siguiente = { ...prev };
        for (const f of filas) siguiente[f.materia_id] = f;
        return siguiente;
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function guardarConfigDepto(cambios) {
    setError('');
    const siguiente = {
      departamento_id: departamentoId,
      semestre_id: semestre.id,
      mostrar_seleccion_materias: mostrarSeleccion,
      horas_minimas_verde: horasMinimas,
      ...cambios,
    };
    if (cambios.mostrar_seleccion_materias !== undefined) {
      setMostrarSeleccion(cambios.mostrar_seleccion_materias);
    }
    if (cambios.horas_minimas_verde !== undefined) setHorasMinimas(cambios.horas_minimas_verde);
    try {
      await apiFetch('/departamento_semestre_config', token, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(siguiente),
      });
    } catch (err) {
      setError(err.message);
    }
  }

  if (cargando) return <div className="formulario-cargando">Cargando…</div>;

  return (
    <div className="formulario-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Configurar el cuestionario</strong>
            <span>
              {nombreDepartamento(departamentoId)} · {etiquetaSemestre(semestre)}
            </span>
          </div>
        </div>
      </header>

      {error && <p className="formulario-error">{error}</p>}

      <div className="pestanas">
        <button
          className={pestana === 'departamento' ? 'pestana activa' : 'pestana'}
          onClick={() => setPestana('departamento')}
        >
          Cuestionario del departamento
        </button>
        <button
          className={pestana === 'profesores' ? 'pestana activa' : 'pestana'}
          onClick={() => setPestana('profesores')}
        >
          Por profesor
        </button>
      </div>

      {pestana === 'departamento' ? (
        <>
          <section className="formulario-seccion">
            <label className="check-linea">
              <input
                type="checkbox"
                checked={mostrarSeleccion}
                onChange={(e) =>
                  guardarConfigDepto({ mostrar_seleccion_materias: e.target.checked })
                }
              />
              Mostrar selección de materias en el cuestionario
            </label>
            <p className="formulario-nota">
              Si lo apagas, tus profesores solo declaran disponibilidad de horario.
            </p>
            <label htmlFor="horas_minimas">Horas en verde mínimas para poder enviar</label>
            <input
              id="horas_minimas"
              type="number"
              min={0}
              max={40}
              step={0.5}
              value={horasMinimas}
              onChange={(e) => setHorasMinimas(Number(e.target.value))}
              onBlur={(e) => guardarConfigDepto({ horas_minimas_verde: Number(e.target.value) })}
            />
          </section>

          {porRevisar > 0 && (
            <section className="formulario-seccion aviso-revision">
              <p>
                <strong>{porRevisar} materias por revisar.</strong> No estaban en el cuestionario
                anterior o su nombre es ambiguo. Revisa que estén en la sección correcta.
              </p>
              <button className="btn-secondary" onClick={marcarRestantesRevisadas}>
                Marcar las restantes como correctas
              </button>
            </section>
          )}

          <section className="formulario-seccion">
            <p className="formulario-nota">
              {conteos.map((c) => `${c.n} en ${c.etiqueta.toLowerCase()}`).join(' · ')}
            </p>
            <div className="disponibilidad-grid-wrap">
              <table className="panel-tabla">
                <thead>
                  <tr>
                    <th>Clave</th>
                    <th>Nombre en el cuestionario</th>
                    <th>Sección</th>
                    <th>Alias de…</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.map((m) => {
                    const fila = filaDe(m.id);
                    return (
                      <tr key={m.id} className={fila.revisado ? '' : 'fila-por-revisar'}>
                        <td>{m.clave}</td>
                        <td>
                          <input
                            className="input-inline"
                            defaultValue={fila.etiqueta ?? m.nombre}
                            onBlur={(e) => {
                              const valor = e.target.value.trim();
                              // Guardar el nombre oficial como etiqueta sería
                              // ruido: null significa "usa materia.nombre".
                              const etiqueta = valor === m.nombre || valor === '' ? null : valor;
                              if (etiqueta !== (fila.etiqueta ?? null)) {
                                guardarFila(m.id, { etiqueta });
                              }
                            }}
                          />
                        </td>
                        <td>
                          <div className="tri-toggle">
                            {SECCIONES.map((s) => (
                              <button
                                key={s.valor}
                                type="button"
                                className={fila.seccion === s.valor ? 'active' : ''}
                                disabled={guardandoId === m.id}
                                onClick={() => guardarFila(m.id, { seccion: s.valor, revisado: true })}
                              >
                                {s.etiqueta}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td>
                          {/* Solo tiene sentido en una materia oculta, y el
                              CHECK de la base rechaza la otra combinación. Un
                              select deshabilitado en 43 de 51 filas se lee como
                              si la columna estuviera rota, así que mejor no
                              mostrarlo cuando no aplica. */}
                          {fila.seccion === 'oculta' ? (
                            <select
                              value={fila.alias_de_id ?? ''}
                              disabled={guardandoId === m.id}
                              onChange={(e) =>
                                guardarFila(m.id, {
                                  alias_de_id: e.target.value ? Number(e.target.value) : null,
                                  revisado: true,
                                })
                              }
                            >
                              <option value="">— no aparece en ningún lado —</option>
                              {visibles
                                .filter((v) => v.id !== m.id)
                                .map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.clave} {filaDe(v.id).etiqueta ?? v.nombre}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span className="celda-vacia">—</span>
                          )}
                        </td>
                        <td>{fila.revisado ? '✓' : '•'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <PorProfesor
          token={token}
          departamentoId={departamentoId}
          materiasVisibles={visibles}
          filaDe={filaDe}
          onError={setError}
        />
      )}
    </div>
  );
}

// Excepciones por profesor (RF15). El modelo mental es "override sobre el
// default del departamento": casi todos se quedan en `todas`, y solo se abre a
// quien de verdad necesita una lista distinta.
function PorProfesor({ token, departamentoId, materiasVisibles, filaDe, onError }) {
  const [cargando, setCargando] = useState(true);
  const [profesores, setProfesores] = useState([]);
  const [elegibles, setElegibles] = useState({});
  const [abierto, setAbierto] = useState(null);
  // Por profesor y no global: con un solo booleano, guardar a uno deshabilitaba
  // los botones de las 44 filas y parecía que la pantalla se había trabado.
  const [guardandoId, setGuardandoId] = useState(null);
  const [confirmacion, setConfirmacion] = useState('');

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try {
        const roster = await apiFetch(
          `/profesor?select=id,nombre,tipo_contrato,modo_materias_elegibles,estado_especial&departamento_id=eq.${departamentoId}&tipo_contrato=not.is.null&activo=eq.true&order=nombre.asc`,
          token,
        );
        const listas = await apiFetch(
          `/profesor_materia_elegible?select=profesor_id,materia_id`,
          token,
        );
        if (cancelado) return;
        const porProfesor = {};
        for (const e of listas) {
          (porProfesor[e.profesor_id] ??= new Set()).add(e.materia_id);
        }
        setProfesores(roster);
        setElegibles(porProfesor);
      } catch (err) {
        if (!cancelado) onError(err.message);
      } finally {
        if (!cancelado) setCargando(false);
      }
    }
    cargar();
    return () => {
      cancelado = true;
    };
  }, [token, departamentoId, onError]);

  async function cambiarModo(p, modo) {
    setGuardandoId(p.id);
    setConfirmacion('');
    onError('');
    try {
      await apiFetch(`/profesor?id=eq.${p.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ modo_materias_elegibles: modo }),
      });

      if (modo === 'personalizada') {
        // Se siembra con TODO el cuestionario: si se dejara vacía, esa persona
        // abriría el formulario sin una sola materia y sin ninguna pista de por
        // qué. Personalizar es "empieza con todo y quita".
        const actuales = elegibles[p.id];
        if (!actuales || actuales.size === 0) {
          const filas = materiasVisibles.map((m) => ({ profesor_id: p.id, materia_id: m.id }));
          if (filas.length > 0) {
            await apiFetch('/profesor_materia_elegible', token, {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates' },
              body: JSON.stringify(filas),
            });
          }
          setElegibles((prev) => ({ ...prev, [p.id]: new Set(materiasVisibles.map((m) => m.id)) }));
        }
      } else {
        // Volver al default borra la excepción: si solo cambiáramos el modo,
        // la lista quedaría latente y reaparecería la próxima vez que alguien
        // pusiera "personalizada".
        await apiFetch(`/profesor_materia_elegible?profesor_id=eq.${p.id}`, token, {
          method: 'DELETE',
        });
        setElegibles((prev) => ({ ...prev, [p.id]: new Set() }));
      }

      setProfesores((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, modo_materias_elegibles: modo } : x)),
      );
      setConfirmacion(`${p.nombre}: ${MODO_LABELS[modo].toLowerCase()}. Guardado.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setGuardandoId(null);
    }
  }

  async function alternarMateria(p, materiaId, incluir) {
    onError('');
    const actuales = new Set(elegibles[p.id] ?? []);
    if (incluir) actuales.add(materiaId);
    else actuales.delete(materiaId);
    setElegibles((prev) => ({ ...prev, [p.id]: actuales }));
    try {
      if (incluir) {
        await apiFetch('/profesor_materia_elegible', token, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ profesor_id: p.id, materia_id: materiaId }),
        });
      } else {
        await apiFetch(
          `/profesor_materia_elegible?profesor_id=eq.${p.id}&materia_id=eq.${materiaId}`,
          token,
          { method: 'DELETE' },
        );
      }
    } catch (err) {
      onError(err.message);
    }
  }

  async function alternarTodas(p, incluir) {
    onError('');
    setElegibles((prev) => ({
      ...prev,
      [p.id]: incluir ? new Set(materiasVisibles.map((m) => m.id)) : new Set(),
    }));
    try {
      if (incluir) {
        await apiFetch('/profesor_materia_elegible', token, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(materiasVisibles.map((m) => ({ profesor_id: p.id, materia_id: m.id }))),
        });
      } else {
        await apiFetch(`/profesor_materia_elegible?profesor_id=eq.${p.id}`, token, {
          method: 'DELETE',
        });
      }
    } catch (err) {
      onError(err.message);
    }
  }

  if (cargando) return <div className="formulario-cargando">Cargando…</div>;

  return (
    <section className="formulario-seccion">
      <p className="formulario-nota">
        Por defecto todos ven el mismo cuestionario del departamento. Usa <strong>Cambiar</strong> en
        la fila de alguien solo si necesita una lista distinta.
      </p>
      {confirmacion && <p className="formulario-mensaje">{confirmacion}</p>}
      <div className="disponibilidad-grid-wrap">
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>Profesor</th>
              <th>Qué materias ve</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profesores.map((p) => {
              const modo = p.modo_materias_elegibles;
              const n = elegibles[p.id]?.size ?? 0;
              const estaAbierto = abierto === p.id;
              return (
                <Fila
                  key={p.id}
                  profesor={p}
                  modo={modo}
                  n={n}
                  total={materiasVisibles.length}
                  abierto={estaAbierto}
                  guardando={guardandoId === p.id}
                  materiasVisibles={materiasVisibles}
                  filaDe={filaDe}
                  elegibles={elegibles[p.id]}
                  onAbrir={() => setAbierto(estaAbierto ? null : p.id)}
                  onCambiarModo={(m) => cambiarModo(p, m)}
                  onAlternar={(materiaId, incluir) => alternarMateria(p, materiaId, incluir)}
                  onTodas={(incluir) => alternarTodas(p, incluir)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Fila({
  profesor,
  modo,
  n,
  total,
  abierto,
  guardando,
  materiasVisibles,
  filaDe,
  elegibles,
  onAbrir,
  onCambiarModo,
  onAlternar,
  onTodas,
}) {
  const badge =
    modo === 'personalizada' ? `Lista personalizada (${n} de ${total})` : MODO_LABELS[modo];
  const pocasMaterias = modo === 'personalizada' && n < MIN_GENERAL;

  return (
    <>
      <tr>
        <td>
          {profesor.nombre}
          {profesor.estado_especial && (
            <span className="materia-alias"> · {profesor.estado_especial}</span>
          )}
        </td>
        <td>
          <span className={`badge badge-${modo === 'todas' ? 'enviado' : 'borrador'}`}>{badge}</span>
          {pocasMaterias && (
            <span className="materia-alias">
              {' '}
              · con menos de {MIN_GENERAL} materias no va a poder enviar
            </span>
          )}
        </td>
        <td className="panel-acciones">
          <button className="btn-secondary" onClick={onAbrir}>
            {abierto ? 'Cerrar' : 'Cambiar'}
          </button>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={3}>
            <div className="editor-profesor">
              <div className="tri-toggle">
                {['todas', 'personalizada', 'ninguna'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={modo === m ? 'active' : ''}
                    disabled={guardando}
                    onClick={() => onCambiarModo(m)}
                  >
                    {MODO_LABELS[m]}
                  </button>
                ))}
              </div>

              {modo === 'personalizada' && (
                <div className="elegibles">
                  <div className="elegibles-encabezado">
                    <span>
                      {n} de {total} materias seleccionadas
                    </span>
                    <span className="elegibles-acciones">
                      <button type="button" className="btn-link" onClick={() => onTodas(true)}>
                        Marcar todas
                      </button>
                      <button type="button" className="btn-link" onClick={() => onTodas(false)}>
                        Desmarcar todas
                      </button>
                    </span>
                  </div>
                  {n === 0 && (
                    <p className="formulario-aviso aviso-compacto">
                      Sin ninguna materia marcada, esta persona abre el cuestionario y no ve nada que
                      elegir, sin explicación. Si la idea es que solo declare horario, usa
                      “No elige materias”.
                    </p>
                  )}
                  <div className="elegibles-lista">
                    {materiasVisibles.map((m) => {
                      const cfg = filaDe(m.id);
                      return (
                        <label className="elegible-fila" key={m.id}>
                          <input
                            type="checkbox"
                            checked={elegibles?.has(m.id) ?? false}
                            onChange={(e) => onAlternar(m.id, e.target.checked)}
                          />
                          <span className="elegible-clave">{m.clave}</span>
                          <span className="elegible-nombre">{cfg.etiqueta ?? m.nombre}</span>
                          {cfg.seccion === 'cobertura_departamental' ? (
                            <span className="etiqueta-cobertura">cobertura dept.</span>
                          ) : (
                            <span />
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
