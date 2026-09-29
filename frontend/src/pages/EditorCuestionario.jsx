import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { guardarFormulario, leerFormulario, publicarFormulario } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { AUDIENCIAS, vistaParaContrato } from '../lib/formulario';
import {
  LeyendaDisponibilidad,
  MateriaInfo,
  RejillaDisponibilidad,
  TriToggle,
} from '../components/FormularioPiezas';
import { departamentoInicial } from '../lib/roles';
import SelectorDepartamento from '../components/SelectorDepartamento';

// El editor del formulario, "como un Google Forms": la jefatura ve el
// formulario tal como lo verá el profesor y lo edita ahí mismo — títulos,
// textos, secciones de materias, preguntas abiertas, mínimos — y al final
// Guarda y Publica. Hasta que se publica, los profesores no lo ven.
//
// Todo se edita en memoria y se guarda con UN PUT (configuracion.php
// ?recurso=formulario), en una transacción. Así el formulario nunca queda a
// medias, y reordenar/mover no dispara una petición por clic.
//
// Reemplaza a ConfiguracionCuestionario.jsx (2026-09-28), incluida su pestaña
// "Por profesor": ya no hay listas personalizadas, todos ven lo mismo. Lo que
// se decide por persona va en la vista de Respuestas, como bloqueo.

const TIPO_LABELS = {
  num_cursos: 'Número de cursos',
  materias: 'Sección de materias',
  disponibilidad: 'Disponibilidad de horarios',
  abierta: 'Pregunta abierta',
};

const VISTAS = [
  { valor: 'editar', etiqueta: 'Editar' },
  { valor: 'tiempo_completo', etiqueta: 'Vista previa: tiempo completo' },
  { valor: 'asignatura', etiqueta: 'Vista previa: asignatura' },
];

let contadorNuevas = 0;
const claveNueva = () => `nueva-${++contadorNuevas}`;

function normalizarMateria(m) {
  return {
    id: m.id,
    clave: m.clave,
    nombre: m.nombre,
    etiqueta: m.etiqueta ?? null,
    alias_de_id: m.alias_de_id ?? null,
    revisado: Boolean(m.revisado),
    // De la estimación de demanda, si ya se cargó (null = sin demanda).
    grupos_sugeridos: m.grupos_sugeridos ?? null,
  };
}

/** "Sug: 3" junto a la materia: cuántos grupos sugirió Servicios Escolares. */
function Sugeridos({ n }) {
  if (n == null) return null;
  return (
    <span
      className={`badge ${n === 0 ? 'badge-borrador' : 'badge-no_iniciado'}`}
      title="Grupos sugeridos en la estimación de demanda de Servicios Escolares"
    >
      Sug: {n}
    </span>
  );
}

/** Del JSON del servidor al estado del editor. */
function desdeServidor(datos) {
  return {
    publicado: datos.publicado,
    enviadas: datos.enviadas ?? 0,
    texto_introduccion: datos.texto_introduccion ?? '',
    horas_minimas_verde: datos.horas_minimas_verde ?? 10,
    secciones: datos.secciones.map((s) => ({
      ...s,
      key: `s-${s.id}`,
      descripcion: s.descripcion ?? '',
      materias: (s.materias ?? []).map(normalizarMateria),
    })),
    ocultas: datos.ocultas.map(normalizarMateria),
  };
}

const nombreMostrado = (m) => m.etiqueta?.trim() || m.nombre;

/** textarea que crece con su contenido, como en un Google Forms. */
function TextoAuto({ className, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={1} className={`texto-auto ${className ?? ''}`} {...props} />;
}

export default function EditorCuestionario({ onVolver }) {
  const { token, profesor, departamentos, semestre, franjas, recargarPerfil } = useAuth();

  const [departamentoId, setDepartamentoId] = useState(() =>
    departamentoInicial(profesor, departamentos),
  );
  const [form, setForm] = useState(null);
  // Lo último que vino del servidor, para "Descartar cambios".
  const [original, setOriginal] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [vista, setVista] = useState('editar');

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError('');
      try {
        if (!semestre) throw new Error('No hay ningún semestre configurado todavía.');
        const datos = await leerFormulario(token, semestre.id, departamentoId);
        if (cancelado) return;
        setForm(desdeServidor(datos));
        setOriginal(datos);
        setSucio(false);
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

  useEffect(() => {
    if (!sucio) return undefined;
    const avisar = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [sucio]);

  // Todo cambio pasa por aquí: marca el formulario como sucio y borra el
  // "Guardado" viejo, que ya no describe lo que hay en pantalla.
  const cambiar = useCallback((fn) => {
    setForm((prev) => fn(prev));
    setSucio(true);
    setMensaje('');
  }, []);

  // --- Secciones ------------------------------------------------------------

  const editarSeccion = (key, cambios) =>
    cambiar((f) => ({
      ...f,
      secciones: f.secciones.map((s) => (s.key === key ? { ...s, ...cambios } : s)),
    }));

  const moverSeccion = (indice, delta) =>
    cambiar((f) => {
      const destino = indice + delta;
      if (destino < 0 || destino >= f.secciones.length) return f;
      const secciones = [...f.secciones];
      [secciones[indice], secciones[destino]] = [secciones[destino], secciones[indice]];
      return { ...f, secciones };
    });

  function borrarSeccion(seccion) {
    const aviso =
      seccion.tipo === 'materias' && seccion.materias.length > 0
        ? `¿Eliminar "${seccion.titulo}"? Sus ${seccion.materias.length} materias pasan a "Materias ocultas" y las puedes volver a agregar.`
        : `¿Eliminar "${seccion.titulo}"?`;
    if (!window.confirm(aviso)) return;
    cambiar((f) => ({
      ...f,
      secciones: f.secciones.filter((s) => s.key !== seccion.key),
      ocultas: [...f.ocultas, ...(seccion.materias ?? []).map((m) => ({ ...m, revisado: true }))],
    }));
  }

  const agregarSeccion = (tipo, despuesDe) =>
    cambiar((f) => {
      const nueva = {
        key: claveNueva(),
        id: null,
        tipo,
        titulo: tipo === 'materias' ? 'Nueva sección de materias' : 'Nueva pregunta',
        descripcion: '',
        audiencia: 'todos',
        minimo_verdes: null,
        cobertura_departamental: false,
        obligatoria: false,
        materias: tipo === 'materias' ? [] : undefined,
      };
      const secciones = [...f.secciones];
      secciones.splice(despuesDe + 1, 0, nueva);
      return { ...f, secciones };
    });

  // --- Materias -------------------------------------------------------------

  const editarMateria = (materiaId, cambios) =>
    cambiar((f) => {
      const aplicar = (m) => (m.id === materiaId ? { ...m, ...cambios, revisado: true } : m);
      return {
        ...f,
        secciones: f.secciones.map((s) =>
          s.tipo === 'materias' ? { ...s, materias: s.materias.map(aplicar) } : s,
        ),
        ocultas: f.ocultas.map(aplicar),
      };
    });

  const moverMateriaEnSeccion = (seccionKey, indice, delta) =>
    cambiar((f) => ({
      ...f,
      secciones: f.secciones.map((s) => {
        if (s.key !== seccionKey) return s;
        const destino = indice + delta;
        if (destino < 0 || destino >= s.materias.length) return s;
        const materias = [...s.materias];
        [materias[indice], materias[destino]] = [materias[destino], materias[indice]];
        return { ...s, materias };
      }),
    }));

  /** Mueve una materia a otra sección (al final) o a ocultas (destinoKey null). */
  const reubicarMateria = (materiaId, destinoKey) =>
    cambiar((f) => {
      let materia = null;
      const secciones = f.secciones.map((s) => {
        if (s.tipo !== 'materias') return s;
        const encontrada = s.materias.find((m) => m.id === materiaId);
        if (!encontrada) return s;
        materia = encontrada;
        return { ...s, materias: s.materias.filter((m) => m.id !== materiaId) };
      });
      let ocultas = f.ocultas;
      if (!materia) {
        materia = ocultas.find((m) => m.id === materiaId);
        ocultas = ocultas.filter((m) => m.id !== materiaId);
      }
      if (!materia) return f;
      // Un alias solo tiene sentido en una materia oculta.
      const movida = { ...materia, revisado: true, alias_de_id: destinoKey ? null : materia.alias_de_id };
      if (!destinoKey) return { ...f, secciones, ocultas: [...ocultas, movida] };
      return {
        ...f,
        ocultas,
        secciones: secciones.map((s) =>
          s.key === destinoKey ? { ...s, materias: [...s.materias, movida] } : s,
        ),
      };
    });

  // --- Guardar y publicar ---------------------------------------------------

  function cuerpoParaGuardar(f) {
    const materias = [];
    for (const s of f.secciones) {
      if (s.tipo !== 'materias') continue;
      s.materias.forEach((m, i) =>
        materias.push({
          materia_id: m.id,
          seccion: s.id ?? s.key,
          orden: i + 1,
          etiqueta: m.etiqueta?.trim() && m.etiqueta.trim() !== m.nombre ? m.etiqueta.trim() : null,
          revisado: m.revisado,
        }),
      );
    }
    for (const m of f.ocultas) {
      materias.push({
        materia_id: m.id,
        seccion: null,
        orden: null,
        etiqueta: m.etiqueta?.trim() && m.etiqueta.trim() !== m.nombre ? m.etiqueta.trim() : null,
        revisado: m.revisado,
      });
    }
    return {
      texto_introduccion: f.texto_introduccion,
      horas_minimas_verde: f.horas_minimas_verde,
      secciones: f.secciones.map((s) => ({
        id: s.id,
        clave_temporal: s.id ? undefined : s.key,
        tipo: s.tipo,
        titulo: s.titulo,
        descripcion: s.descripcion,
        audiencia: s.audiencia,
        minimo_verdes: s.minimo_verdes,
        cobertura_departamental: s.cobertura_departamental,
        obligatoria: s.obligatoria,
      })),
      materias,
    };
  }

  async function guardar() {
    setError('');
    setMensaje('');
    const sinTitulo = form.secciones.find((s) => !s.titulo.trim());
    if (sinTitulo) {
      setError('Hay una sección sin título. Ponle uno antes de guardar.');
      return false;
    }
    setGuardando(true);
    try {
      const datos = await guardarFormulario(token, semestre.id, departamentoId, cuerpoParaGuardar(form));
      setForm(desdeServidor(datos));
      setOriginal(datos);
      setSucio(false);
      setMensaje('Formulario guardado.');
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarPublicacion(publicar) {
    const pregunta = publicar
      ? '¿Publicar el formulario? A partir de ahora los profesores del departamento lo pueden contestar.'
      : '¿Despublicar el formulario? Los profesores dejan de poder abrirlo; lo que ya contestaron se conserva.';
    if (!window.confirm(pregunta)) return;
    if (publicar && sucio && !(await guardar())) return;
    setGuardando(true);
    setError('');
    try {
      const r = await publicarFormulario(token, semestre.id, departamentoId, publicar);
      setForm((f) => ({ ...f, publicado: r.publicado }));
      setMensaje(r.publicado ? 'Formulario publicado.' : 'Formulario despublicado.');
      // La tarjeta del inicio dice si el formulario propio está abierto.
      recargarPerfil().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  function descartar() {
    if (!window.confirm('¿Descartar todos los cambios sin guardar? El formulario vuelve a como estaba la última vez que se guardó.')) {
      return;
    }
    // publicado se conserva: publicar o despublicar ya se guardó en el momento.
    setForm((f) => ({ ...desdeServidor(original), publicado: f.publicado }));
    setSucio(false);
    setError('');
    setMensaje('Cambios descartados.');
  }

  function salir(accion) {
    if (sucio && !window.confirm('Tienes cambios sin guardar en el formulario. ¿Salir de todos modos?')) {
      return;
    }
    accion();
  }

  // --- Derivados ------------------------------------------------------------

  const aliasPorVisible = useMemo(() => {
    const mapa = {};
    for (const m of form?.ocultas ?? []) {
      if (m.alias_de_id) (mapa[m.alias_de_id] ??= []).push(nombreMostrado(m));
    }
    return mapa;
  }, [form]);

  if (cargando && !form) return <div className="formulario-cargando">Cargando…</div>;
  if (!form) {
    return (
      <div className="formulario-screen">
        <p className="formulario-error">{error}</p>
      </div>
    );
  }

  const seccionesMaterias = form.secciones.filter((s) => s.tipo === 'materias');
  const porRevisar = [...seccionesMaterias.flatMap((s) => s.materias), ...form.ocultas].filter(
    (m) => !m.revisado,
  ).length;

  const encabezado = (
    <header className="formulario-header">
      <button className="btn-link" onClick={() => salir(onVolver)}>
        ← Volver
      </button>
      <div className="formulario-header-datos">
        <div>
          <strong>Editar formulario</strong>
          <span>{etiquetaSemestre(semestre)}</span>
        </div>
        <span className={`badge ${form.publicado ? 'badge-enviado' : 'badge-borrador'}`}>
          {form.publicado ? 'Publicado' : 'Sin publicar'}
        </span>
      </div>
      <div className="editor-herramientas">
        <SelectorDepartamento
          valor={departamentoId}
          disabled={guardando}
          onCambiar={(id) => salir(() => setDepartamentoId(id))}
        />
        <div className="segmentado" role="group" aria-label="Modo">
          {VISTAS.map((v) => (
            <button
              key={v.valor}
              type="button"
              className={vista === v.valor ? 'active' : ''}
              aria-pressed={vista === v.valor}
              onClick={() => setVista(v.valor)}
            >
              {v.etiqueta}
            </button>
          ))}
        </div>
      </div>
    </header>
  );

  const barraAcciones = (
    <footer className="formulario-seccion barra-guardar barra-editor">
      <p className="formulario-nota">
        {sucio ? 'Tienes cambios sin guardar.' : form.publicado ? 'Publicado y al día.' : 'Guardado, sin publicar.'}
      </p>
      <button className="btn-link" disabled={guardando || !sucio} onClick={descartar}>
        Descartar cambios
      </button>
      <button className="btn-secondary" disabled={guardando || !sucio} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
      {form.publicado ? (
        <button className="btn-secondary" disabled={guardando} onClick={() => cambiarPublicacion(false)}>
          Despublicar
        </button>
      ) : (
        <button className="btn-primary" disabled={guardando} onClick={() => cambiarPublicacion(true)}>
          {sucio ? 'Guardar y publicar' : 'Publicar'}
        </button>
      )}
    </footer>
  );

  const avisos = (
    <>
      {error && <p className="formulario-error">{error}</p>}
      {mensaje && <p className="formulario-mensaje">{mensaje}</p>}
      {form.publicado && (
        <p className="formulario-aviso">
          El formulario ya está publicado: lo que guardes les aparece de inmediato a los profesores.
          {form.enviadas > 0 &&
            ` Ya hay ${form.enviadas} formularios enviados; esos no se vuelven a validar, y las materias que agregues les aparecen en amarillo.`}
        </p>
      )}
    </>
  );

  // --- Vista previa ---------------------------------------------------------

  if (vista !== 'editar') {
    const conDisplay = form.secciones.map((s) =>
      s.tipo === 'materias'
        ? {
            ...s,
            materias: s.materias.map((m) => ({
              ...m,
              nombreMostrado: nombreMostrado(m),
              alias: aliasPorVisible[m.id] ?? [],
            })),
          }
        : s,
    );
    const visibles = vistaParaContrato(conDisplay, vista);
    const hayMaterias = visibles.some((s) => s.tipo === 'materias');
    return (
      <div className="formulario-screen">
        {encabezado}
        {avisos}
        <p className="formulario-aviso">
          Así lo ve un profesor de {vista === 'asignatura' ? 'asignatura' : 'tiempo completo'}. Nada es
          editable aquí; regresa a "Editar" para cambiarlo.
        </p>
        {hayMaterias && form.texto_introduccion && (
          <section className="formulario-seccion">
            <p className="formulario-nota texto-libre">{form.texto_introduccion}</p>
          </section>
        )}
        {visibles.map((s) => (
          <section className="formulario-seccion" key={s.key}>
            <PreviaSeccion seccion={s} franjas={franjas} horas={form.horas_minimas_verde} />
          </section>
        ))}
        {barraAcciones}
      </div>
    );
  }

  // --- Edición --------------------------------------------------------------

  const insertador = (indice) => (
    <div className="editor-insertar">
      <button type="button" className="btn-link" onClick={() => agregarSeccion('materias', indice)}>
        + Sección de materias
      </button>
      <button type="button" className="btn-link" onClick={() => agregarSeccion('abierta', indice)}>
        + Pregunta abierta
      </button>
    </div>
  );

  return (
    <div className="formulario-screen editor-screen">
      {encabezado}
      {avisos}

      {porRevisar > 0 && (
        <section className="formulario-seccion aviso-revision">
          <p>
            <strong>{porRevisar} materias por revisar</strong> (resaltadas). No estaban en el
            cuestionario anterior o su nombre es ambiguo: revisa que estén en la sección correcta.
          </p>
          <div>
            <button
              className="btn-secondary"
              onClick={() =>
                cambiar((f) => ({
                  ...f,
                  secciones: f.secciones.map((s) =>
                    s.tipo === 'materias'
                      ? { ...s, materias: s.materias.map((m) => ({ ...m, revisado: true })) }
                      : s,
                  ),
                  ocultas: f.ocultas.map((m) => ({ ...m, revisado: true })),
                }))
              }
            >
              Marcar todas como revisadas
            </button>
          </div>
        </section>
      )}

      <section className="formulario-seccion editor-seccion">
        <div className="editor-seccion-barra">
          <span className="editor-tipo">Introducción</span>
        </div>
        <TextoAuto
          aria-label="Texto de introducción"
          value={form.texto_introduccion}
          placeholder="Texto que aparece arriba del formulario"
          onChange={(e) => cambiar((f) => ({ ...f, texto_introduccion: e.target.value }))}
        />
        <p className="formulario-nota">
          Aparece arriba de todo cuando el formulario tiene materias. Si lo borras, vuelve el texto
          original.
        </p>
      </section>
      {insertador(-1)}

      {form.secciones.map((s, i) => (
        <div key={s.key}>
          <section className={`formulario-seccion editor-seccion editor-${s.tipo}`}>
            <div className="editor-seccion-barra">
              <span className="editor-tipo">{TIPO_LABELS[s.tipo]}</span>
              {(s.tipo === 'materias' || s.tipo === 'abierta') && (
                <label className="editor-audiencia">
                  La ven
                  <select
                    value={s.audiencia}
                    onChange={(e) => editarSeccion(s.key, { audiencia: e.target.value })}
                  >
                    {AUDIENCIAS.map((a) => (
                      <option key={a.valor} value={a.valor}>
                        {a.etiqueta}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="editor-botones">
                <button
                  type="button"
                  className="btn-icono"
                  disabled={i === 0}
                  aria-label={`Subir "${s.titulo}"`}
                  onClick={() => moverSeccion(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-icono"
                  disabled={i === form.secciones.length - 1}
                  aria-label={`Bajar "${s.titulo}"`}
                  onClick={() => moverSeccion(i, 1)}
                >
                  ↓
                </button>
                {(s.tipo === 'materias' || s.tipo === 'abierta') && (
                  <button type="button" className="btn-icono peligro" onClick={() => borrarSeccion(s)}>
                    Eliminar
                  </button>
                )}
              </div>
            </div>

            <input
              className="editor-titulo"
              aria-label="Título"
              value={s.titulo}
              placeholder="Título"
              onChange={(e) => editarSeccion(s.key, { titulo: e.target.value })}
            />
            <TextoAuto
              className="editor-descripcion"
              aria-label="Descripción"
              value={s.descripcion}
              placeholder="Descripción o instrucciones (opcional)"
              onChange={(e) => editarSeccion(s.key, { descripcion: e.target.value })}
            />

            {s.tipo === 'materias' && (
              <SeccionMateriasEditor
                seccion={s}
                otrasSecciones={seccionesMaterias.filter((o) => o.key !== s.key)}
                ocultas={form.ocultas}
                aliasPorVisible={aliasPorVisible}
                onEditarSeccion={(cambios) => editarSeccion(s.key, cambios)}
                onEditarMateria={editarMateria}
                onMover={(indice, delta) => moverMateriaEnSeccion(s.key, indice, delta)}
                onReubicar={reubicarMateria}
              />
            )}

            {s.tipo === 'num_cursos' && (
              <input type="number" disabled value={1} aria-label="Vista previa" className="editor-previa-num" />
            )}

            {s.tipo === 'disponibilidad' && (
              <>
                <label className="editor-opcion">
                  Horas en verde mínimas para poder enviar
                  <input
                    type="number"
                    min={0}
                    max={60}
                    step={0.5}
                    value={form.horas_minimas_verde}
                    onChange={(e) =>
                      cambiar((f) => ({ ...f, horas_minimas_verde: Number(e.target.value) }))
                    }
                  />
                </label>
                <LeyendaDisponibilidad />
                <details className="editor-previa">
                  <summary>Ver la rejilla</summary>
                  <RejillaDisponibilidad franjas={franjas} disabled />
                </details>
              </>
            )}

            {s.tipo === 'abierta' && (
              <>
                <label className="check-linea">
                  <input
                    type="checkbox"
                    checked={s.obligatoria}
                    onChange={(e) => editarSeccion(s.key, { obligatoria: e.target.checked })}
                  />
                  Obligatoria para poder enviar
                </label>
                <textarea disabled placeholder="Aquí escribe su respuesta el profesor" />
              </>
            )}
          </section>
          {insertador(i)}
        </div>
      ))}

      <details className="formulario-seccion editor-ocultas" open={form.ocultas.some((m) => !m.revisado)}>
        <summary>
          <strong>Materias ocultas ({form.ocultas.length})</strong> — materias activas del departamento
          que no aparecen en el formulario
        </summary>
        {form.ocultas.length === 0 ? (
          <p className="formulario-nota">Ninguna: todas las materias activas están en el formulario.</p>
        ) : (
          <div className="materias-lista">
            {form.ocultas.map((m) => (
              <div className={`materia-fila editor-materia ${m.revisado ? '' : 'por-revisar'}`} key={m.id}>
                <div className="materia-info">
                  <span className="materia-nombre">{nombreMostrado(m)}</span>
                  <span className="materia-clave">
                    {m.clave} <Sugeridos n={m.grupos_sugeridos} />
                  </span>
                </div>
                {/* Solo lectura a propósito: el "nombre viejo de" lo cambia un
                    administrador directo en la base (2026-09-28). */}
                {m.alias_de_id && (
                  <span className="editor-mini">
                    Nombre viejo de{' '}
                    {(() => {
                      const v = seccionesMaterias.flatMap((s) => s.materias).find((x) => x.id === m.alias_de_id);
                      return v ? `${v.clave} ${nombreMostrado(v)}` : 'una materia que ya no está en el formulario';
                    })()}
                  </span>
                )}
                <select
                  className="editor-mini"
                  aria-label={`Agregar ${m.clave} a una sección`}
                  value=""
                  onChange={(e) => e.target.value && reubicarMateria(m.id, e.target.value)}
                >
                  <option value="">Agregar a…</option>
                  {seccionesMaterias.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.titulo}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </details>

      {barraAcciones}
    </div>
  );
}

function SeccionMateriasEditor({
  seccion,
  otrasSecciones,
  ocultas,
  aliasPorVisible,
  onEditarSeccion,
  onEditarMateria,
  onMover,
  onReubicar,
}) {
  const disponibles = ocultas;
  return (
    <>
      <div className="editor-opciones">
        <label className="editor-opcion">
          Mínimo de materias en verde
          <input
            type="number"
            min={0}
            max={99}
            value={seccion.minimo_verdes ?? ''}
            placeholder="Sin mínimo"
            onChange={(e) =>
              onEditarSeccion({ minimo_verdes: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </label>
        <label className="check-linea">
          <input
            type="checkbox"
            checked={seccion.cobertura_departamental}
            onChange={(e) => onEditarSeccion({ cobertura_departamental: e.target.checked })}
          />
          Cobertura departamental (el algoritmo lo toma en cuenta)
        </label>
      </div>

      {seccion.materias.length === 0 ? (
        <p className="formulario-nota">
          Esta sección todavía no tiene materias. Agrégalas abajo; sin materias no se le muestra a nadie.
        </p>
      ) : (
        <div className="materias-lista">
          {seccion.materias.map((m, i) => (
            <div className={`materia-fila editor-materia ${m.revisado ? '' : 'por-revisar'}`} key={m.id}>
              <div className="editor-botones">
                <button
                  type="button"
                  className="btn-icono"
                  disabled={i === 0}
                  aria-label={`Subir ${m.clave}`}
                  onClick={() => onMover(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-icono"
                  disabled={i === seccion.materias.length - 1}
                  aria-label={`Bajar ${m.clave}`}
                  onClick={() => onMover(i, 1)}
                >
                  ↓
                </button>
              </div>
              <div className="editor-materia-nombre">
                <input
                  className="input-inline"
                  aria-label={`Nombre de ${m.clave} en el formulario`}
                  value={m.etiqueta ?? m.nombre}
                  onChange={(e) => onEditarMateria(m.id, { etiqueta: e.target.value })}
                />
                <span className="materia-clave">
                  {m.clave}
                  {aliasPorVisible[m.id] && ` · antes ${aliasPorVisible[m.id].join(', ')}`}{' '}
                  <Sugeridos n={m.grupos_sugeridos} />
                </span>
              </div>
              <TriToggle valor="amarillo" disabled onCambiar={() => {}} />
              <select
                className="editor-mini"
                aria-label={`Mover ${m.clave}`}
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  onReubicar(m.id, e.target.value === 'ocultar' ? null : e.target.value);
                }}
              >
                <option value="">Mover a…</option>
                {otrasSecciones.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.titulo}
                  </option>
                ))}
                <option value="ocultar">Quitar del formulario</option>
              </select>
            </div>
          ))}
        </div>
      )}

      {disponibles.length > 0 && (
        <select
          className="editor-agregar-materia"
          aria-label="Agregar materia a esta sección"
          value=""
          onChange={(e) => e.target.value && onReubicar(Number(e.target.value), seccion.key)}
        >
          <option value="">+ Agregar materia…</option>
          {disponibles.map((m) => (
            <option key={m.id} value={m.id}>
              {m.clave} — {nombreMostrado(m)}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

/** Una sección tal como la ve el profesor, sin nada editable. */
function PreviaSeccion({ seccion: s, franjas, horas }) {
  if (s.tipo === 'num_cursos') {
    return (
      <>
        <label>{s.titulo}</label>
        {s.descripcion && <p className="formulario-nota texto-libre">{s.descripcion}</p>}
        <input type="number" disabled value={1} className="editor-previa-num" />
      </>
    );
  }
  if (s.tipo === 'materias') {
    const minimo = s.minimo_verdes == null ? 0 : Math.min(s.minimo_verdes, s.materias.length);
    return (
      <>
        <div className="materias-bloque-encabezado">
          <h2>{s.titulo}</h2>
          {minimo > 0 && <span className="counter low">0 en verde (mínimo {minimo})</span>}
        </div>
        {s.descripcion && <p className="formulario-nota texto-libre">{s.descripcion}</p>}
        <div className="materias-lista">
          {s.materias.map((m) => (
            <div className="materia-fila" key={m.id}>
              <MateriaInfo materia={m} />
              <TriToggle valor="amarillo" disabled onCambiar={() => {}} />
            </div>
          ))}
        </div>
      </>
    );
  }
  if (s.tipo === 'disponibilidad') {
    return (
      <>
        <h2>{s.titulo}</h2>
        <p className="formulario-nota nota-falta">0 hrs en verde marcadas de {horas} hrs mínimo para poder enviar.</p>
        <LeyendaDisponibilidad />
        {s.descripcion && <p className="formulario-nota texto-libre">{s.descripcion}</p>}
        <RejillaDisponibilidad franjas={franjas} disabled />
      </>
    );
  }
  return (
    <>
      <label>
        {s.titulo}
        {s.obligatoria && <span className="obligatoria"> *</span>}
      </label>
      {s.descripcion && <p className="formulario-nota texto-libre">{s.descripcion}</p>}
      <textarea disabled />
    </>
  );
}
