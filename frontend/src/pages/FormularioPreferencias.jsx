import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

const NIVELES = ['verde', 'amarillo', 'rojo'];
const TIPO_CONTRATO_LABELS = { tiempo_completo: 'Tiempo Completo', asignatura: 'Asignatura' };

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

export default function FormularioPreferencias({ onVolver }) {
  const { token, profesor, nombreDepartamento } = useAuth();

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

  const esAsignatura = profesor.tipo_contrato === 'asignatura';
  const soloLectura = estado === 'enviado';

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
        if (profesor.departamento_id) {
          const config = await apiFetch(
            `/departamento_semestre_config?select=mostrar_seleccion_materias,horas_minimas_verde&departamento_id=eq.${profesor.departamento_id}&semestre_id=eq.${sem.id}`,
            token,
          );
          configDepto = config[0] ?? null;
        }
        if (cancelado) return;
        setHorasMinimasVerde(configDepto?.horas_minimas_verde ?? 10);
        const modoOk = profesor.modo_materias_elegibles !== 'ninguna';
        const configOk = configDepto?.mostrar_seleccion_materias !== false;
        const mostrar = modoOk && configOk && Boolean(profesor.departamento_id);
        setMostrarMaterias(mostrar);

        if (mostrar) {
          const [materiasDepto, demanda] = await Promise.all([
            apiFetch(
              `/materia?select=id,clave,nombre,creditos&departamento_id=eq.${profesor.departamento_id}&activa=eq.true`,
              token,
            ),
            apiFetch(
              `/estimacion_demanda?select=materia_id,grupos_sugeridos&semestre_id=eq.${sem.id}`,
              token,
            ),
          ]);
          const demandaPorMateria = new Map(demanda.map((d) => [d.materia_id, d.grupos_sugeridos]));
          let catalogo = materiasDepto
            .filter((m) => demandaPorMateria.has(m.id))
            .map((m) => ({ ...m, grupos_sugeridos: demandaPorMateria.get(m.id) }));

          if (profesor.modo_materias_elegibles === 'personalizada') {
            const elegibles = await apiFetch(
              `/profesor_materia_elegible?select=materia_id&profesor_id=eq.${profesor.id}`,
              token,
            );
            const idsElegibles = new Set(elegibles.map((e) => e.materia_id));
            catalogo = catalogo.filter((m) => idsElegibles.has(m.id));
          }
          if (!cancelado) setMaterias(catalogo);
        }

        // Preferencia ya existente de este profesor para este semestre.
        const preferencias = await apiFetch(
          `/preferencia?select=*&semestre_id=eq.${sem.id}`,
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
            setNivelMaterias(Object.fromEntries(prefMaterias.map((m) => [m.materia_id, m.nivel])));
            setNivelDisponibilidad(
              Object.fromEntries(
                disponibilidad.map((d) => [claveDisponibilidad(d.dia, d.franja_id), d.nivel]),
              ),
            );
          }
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
  }, [token, profesor]);

  const verdesMaterias = useMemo(
    () => Object.values(nivelMaterias).filter((n) => n === 'verde').length,
    [nivelMaterias],
  );
  const horasVerdeSemana = useMemo(
    () => Object.values(nivelDisponibilidad).filter((n) => n === 'verde').length * 0.5,
    [nivelDisponibilidad],
  );
  // Sin materia_id en la tabla, no tiene sentido preguntar "¿cuántos cursos
  // puedes dar?" ni mostrar la sección — se pospone hasta que haya catálogo
  // real cargado (TODO.md §2).
  const hayMateriasParaElegir = mostrarMaterias && materias.length > 0;

  function alternarMateria(materiaId, nivel) {
    if (soloLectura) return;
    setNivelMaterias((prev) => {
      const siguiente = { ...prev };
      if (siguiente[materiaId] === nivel) delete siguiente[materiaId];
      else siguiente[materiaId] = nivel;
      return siguiente;
    });
  }

  function ciclarDisponibilidad(dia, franjaId) {
    if (soloLectura) return;
    const clave = claveDisponibilidad(dia, franjaId);
    setNivelDisponibilidad((prev) => {
      const actual = prev[clave];
      const siguiente = { ...prev };
      const idx = actual ? NIVELES.indexOf(actual) : -1;
      if (idx === NIVELES.length - 1) delete siguiente[clave];
      else siguiente[clave] = NIVELES[idx + 1];
      return siguiente;
    });
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
    // D18 (GUIA-DECISIONES.md): mínimo de horas en verde por semana,
    // configurable por departamento/semestre. Solo bloquea el envío final,
    // nunca guardar borrador — un borrador a medias es válido.
    if (nuevoEstado === 'enviado' && horasVerdeSemana < horasMinimasVerde) {
      setError(
        `Debes marcar mínimo ${horasMinimasVerde} hrs en verde en tu disponibilidad antes de enviar (llevas ${horasVerdeSemana}).`,
      );
      return;
    }
    setGuardando(true);
    try {
      let id = preferenciaId;
      const payloadPreferencia = {
        profesor_id: profesor.id,
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
      const filasMaterias = Object.entries(nivelMaterias).map(([materiaId, nivel]) => ({
        preferencia_id: id,
        materia_id: Number(materiaId),
        nivel,
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

  return (
    <div className="formulario-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>{profesor.nombre}</strong>
            <span>
              {nombreDepartamento(profesor.departamento_id)} ·{' '}
              {TIPO_CONTRATO_LABELS[profesor.tipo_contrato] ?? profesor.tipo_contrato} ·{' '}
              {semestre?.etiqueta}
            </span>
          </div>
          <span className={`badge badge-${estado}`}>
            {estado === 'enviado' ? 'Enviado' : 'Borrador'}
          </span>
        </div>
      </header>

      {error && <p className="formulario-error">{error}</p>}
      {mensaje && <p className="formulario-mensaje">{mensaje}</p>}
      {soloLectura && (
        <p className="formulario-aviso">
          Ya enviaste tus preferencias — solo lectura. Si necesitas cambiar algo, pídele a tu Jefe de
          Departamento que la reabra.
        </p>
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
            Mínimo sugerido: 5 materias en verde. {verdesMaterias} en verde ahora mismo — no bloquea el
            envío, es solo una guía. Solo se muestran materias de tu departamento por ahora.
          </p>
          <div className="materias-lista">
            {materias.map((m) => (
              <div className="materia-fila" key={m.id}>
                <div className="materia-info">
                  <strong>{m.clave}</strong>
                  <span>{m.nombre}</span>
                  {m.grupos_sugeridos === 0 && (
                    <span className="materia-sin-demanda">(sin demanda estimada este semestre)</span>
                  )}
                </div>
                <TriToggle
                  valor={nivelMaterias[m.id]}
                  disabled={soloLectura}
                  onCambiar={(nivel) => alternarMateria(m.id, nivel)}
                />
              </div>
            ))}
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
        <div className="disponibilidad-grid-wrap">
          <table className="disponibilidad-grid">
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
                        const nivel = nivelDisponibilidad[clave];
                        return (
                          <td key={d.valor}>
                            <button
                              type="button"
                              className={`slot ${nivel ?? ''}`}
                              disabled={soloLectura}
                              onClick={() => ciclarDisponibilidad(d.valor, f.id)}
                              aria-label={`${d.etiqueta} ${f.hora_inicio.slice(0, 5)}: ${nivel ?? 'sin marcar'}`}
                            />
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

function TriToggle({ valor, disabled, onCambiar }) {
  return (
    <div className="tri-toggle">
      <button
        type="button"
        className={`v ${valor === 'verde' ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => onCambiar('verde')}
      >
        Verde
      </button>
      <button
        type="button"
        className={`a ${valor === 'amarillo' ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => onCambiar('amarillo')}
      >
        Amarillo
      </button>
      <button
        type="button"
        className={`r ${valor === 'rojo' ? 'active' : ''}`}
        disabled={disabled}
        onClick={() => onCambiar('rojo')}
      >
        Rojo
      </button>
    </div>
  );
}
