import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

// Campos editables de `materia`. departamento_id queda fuera a propósito:
// moverla a otro departamento la sacaría del alcance que le permite RLS al
// Jefe y el guardado se rechazaría a medias.
//
// anual y tipo_salon_requerido siguen en la lista aunque hoy no se muestren en
// la tabla (se ocultaron 2026-09-24 por ruido visual): así se conserva el valor
// que ya tenga la materia en vez de borrarlo al guardar, y volver a enseñarlas
// es solo devolver la columna al <table>.
const CAMPOS = ['clave', 'nombre', 'creditos', 'anual', 'tipo_salon_requerido', 'activa'];

const CREDITOS_NUEVA = 6; // el valor más común del catálogo, para no arrancar en blanco

// materia.clave es única en TODO el sistema, no solo dentro del departamento,
// así que la validación local (que solo ve las materias de este depto) no puede
// atrapar el choque contra una clave de Actuaría o Estadística. Cuando pasa,
// Postgres responde con su propio texto y hay que volverlo legible.
function mensajeLegible(err, fila) {
  const texto = err?.message ?? '';
  if (texto.includes('materia_clave_key')) {
    return `la clave ${fila.clave.trim()} ya existe en el sistema (puede ser de otro departamento). Usa otra.`;
  }
  if (texto.includes('materia_creditos_check')) {
    return `los créditos de ${fila.clave.trim()} deben ser mayores que 0.`;
  }
  return texto;
}

function normalizar(m) {
  return {
    id: m.id,
    esNueva: false,
    clave: m.clave ?? '',
    nombre: m.nombre ?? '',
    creditos: m.creditos ?? 0,
    anual: Boolean(m.anual),
    tipo_salon_requerido: m.tipo_salon_requerido ?? '',
    activa: Boolean(m.activa),
  };
}

function limpiar(fila) {
  return {
    clave: fila.clave.trim(),
    nombre: fila.nombre.trim(),
    creditos: Number(fila.creditos),
    anual: Boolean(fila.anual),
    tipo_salon_requerido: fila.tipo_salon_requerido.trim() || null,
    activa: Boolean(fila.activa),
  };
}

function cambiosDe(actual, original) {
  if (!original) return {};
  const limpio = limpiar(actual);
  const diff = {};
  for (const campo of CAMPOS) {
    let antes = original[campo];
    if (campo === 'tipo_salon_requerido') antes = antes || null;
    // <input type="number"> entrega string: sin normalizar, reescribir el mismo
    // número dejaría la fila marcada como modificada para siempre.
    if (campo === 'creditos') antes = Number(antes);
    if (limpio[campo] !== antes) diff[campo] = limpio[campo];
  }
  return diff;
}

export default function CatalogoMaterias({ onVolver }) {
  const { token, profesor, nombreDepartamento } = useAuth();
  const departamentoId = profesor.departamento_id;
  const contadorNuevas = useRef(0);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [originales, setOriginales] = useState({});
  const [filas, setFilas] = useState([]);
  // Equivalentes como { materiaId: [idsEquivalentes] }. Se lleva el estado
  // actual y el cargado por separado para poder guardarlos con el mismo botón
  // que el resto de la tabla, en vez de escribir al vuelo.
  const [coOferta, setCoOferta] = useState({});
  const [coOfertaOriginal, setCoOfertaOriginal] = useState({});
  const [editandoEquiv, setEditandoEquiv] = useState(null);
  const [soloActivas, setSoloActivas] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try {
        const materias = await apiFetch(
          `/materia?select=id,clave,nombre,creditos,anual,tipo_salon_requerido,activa&departamento_id=eq.${departamentoId}&order=clave.asc`,
          token,
        );
        // Las equivalencias se guardan en las dos direcciones, así que basta
        // con las filas cuyo materia_id es el de esta materia.
        const pares = await apiFetch('/materia_co_oferta?select=materia_id,co_ofertada_id', token);
        if (cancelado) return;

        const delDepto = new Set(materias.map((m) => m.id));
        const porMateria = {};
        for (const p of pares) {
          if (!delDepto.has(p.materia_id)) continue;
          (porMateria[p.materia_id] ??= []).push(p.co_ofertada_id);
        }

        const normalizadas = materias.map(normalizar);
        setFilas(normalizadas);
        setOriginales(Object.fromEntries(normalizadas.map((m) => [m.id, { ...m }])));
        setCoOferta(porMateria);
        setCoOfertaOriginal(JSON.parse(JSON.stringify(porMateria)));
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

  const pendientes = useMemo(
    () => filas.filter((f) => f.esNueva || Object.keys(cambiosDe(f, originales[f.id])).length > 0),
    [filas, originales],
  );

  const clavePorId = useMemo(
    () => new Map(filas.filter((f) => !f.esNueva).map((f) => [f.id, f.clave])),
    [filas],
  );

  // Pares a escribir/borrar al guardar. Cada equivalencia son DOS filas en la
  // base (A→B y B→A), y aquí se arman las dos para que la relación se vea
  // igual desde cualquiera de las dos materias.
  const cambiosEquiv = useMemo(() => {
    const agregar = [];
    const quitar = [];
    const ids = new Set([...Object.keys(coOferta), ...Object.keys(coOfertaOriginal)].map(Number));
    for (const id of ids) {
      const ahora = new Set(coOferta[id] ?? []);
      const antes = new Set(coOfertaOriginal[id] ?? []);
      for (const otro of ahora) if (!antes.has(otro)) agregar.push([id, otro]);
      for (const otro of antes) if (!ahora.has(otro)) quitar.push([id, otro]);
    }
    return { agregar, quitar };
  }, [coOferta, coOfertaOriginal]);

  const hayCambiosEquiv = cambiosEquiv.agregar.length > 0 || cambiosEquiv.quitar.length > 0;
  const materiasConEquivCambiada = useMemo(
    () => new Set([...cambiosEquiv.agregar, ...cambiosEquiv.quitar].map(([a]) => a)),
    [cambiosEquiv],
  );

  function agregarEquivalente(materiaId, otroId) {
    if (!otroId || otroId === materiaId) return;
    setMensaje('');
    setCoOferta((prev) => {
      const siguiente = { ...prev };
      // Las dos direcciones, para que la relación sea simétrica.
      for (const [a, b] of [[materiaId, otroId], [otroId, materiaId]]) {
        const lista = new Set(siguiente[a] ?? []);
        lista.add(b);
        siguiente[a] = [...lista];
      }
      return siguiente;
    });
  }

  function quitarEquivalente(materiaId, otroId) {
    setMensaje('');
    setCoOferta((prev) => {
      const siguiente = { ...prev };
      for (const [a, b] of [[materiaId, otroId], [otroId, materiaId]]) {
        siguiente[a] = (siguiente[a] ?? []).filter((x) => x !== b);
      }
      return siguiente;
    });
  }

  async function guardarEquivalentes() {
    for (const [a, b] of cambiosEquiv.quitar) {
      await apiFetch(`/materia_co_oferta?materia_id=eq.${a}&co_ofertada_id=eq.${b}`, token, {
        method: 'DELETE',
      });
    }
    if (cambiosEquiv.agregar.length > 0) {
      await apiFetch('/materia_co_oferta', token, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(
          cambiosEquiv.agregar.map(([a, b]) => ({ materia_id: a, co_ofertada_id: b })),
        ),
      });
    }
  }

  // Avisa antes de cerrar la pestaña con cambios sin guardar: esta vista
  // guarda por botón, no al vuelo, así que es fácil perderlos.
  useEffect(() => {
    if (pendientes.length === 0 && !hayCambiosEquiv) return undefined;
    const avisar = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [pendientes.length, hayCambiosEquiv]);

  function editar(id, campo, valor) {
    setMensaje('');
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  function agregar() {
    setMensaje('');
    contadorNuevas.current += 1;
    const nueva = {
      id: `nueva-${contadorNuevas.current}`,
      esNueva: true,
      clave: '',
      nombre: '',
      creditos: CREDITOS_NUEVA,
      anual: false,
      tipo_salon_requerido: '',
      activa: true,
    };
    // Al principio y no ordenada por clave: todavía no tiene clave, y si se
    // fuera al final de 51 filas habría que buscarla para llenarla.
    setFilas((prev) => [nueva, ...prev]);
    if (soloActivas) setSoloActivas(false);
  }

  function quitarNueva(id) {
    setFilas((prev) => prev.filter((f) => f.id !== id));
  }

  function descartar() {
    if (!window.confirm('¿Descartar todos los cambios sin guardar?')) return;
    setFilas(
      Object.values(originales)
        .map((m) => ({ ...m }))
        .sort((a, b) => a.clave.localeCompare(b.clave)),
    );
    setCoOferta(JSON.parse(JSON.stringify(coOfertaOriginal)));
    setEditandoEquiv(null);
    setMensaje('');
    setError('');
  }

  // Se valida aquí lo que la base rechazaría de todas formas, para dar un
  // mensaje que diga qué materia y qué campo, en vez de un error de Postgres.
  function validar() {
    const problemas = [];
    const vistas = new Map();
    for (const f of filas) {
      const clave = f.clave.trim();
      const quien = clave || f.nombre.trim() || (f.esNueva ? 'la materia nueva' : `materia ${f.id}`);
      if (!clave) problemas.push(`${quien}: falta la clave`);
      if (!f.nombre.trim()) problemas.push(`${quien}: falta el nombre`);
      if (!Number.isInteger(Number(f.creditos)) || Number(f.creditos) <= 0) {
        problemas.push(`${quien}: los créditos deben ser un entero mayor que 0`);
      }
      if (clave) {
        if (vistas.has(clave)) problemas.push(`la clave ${clave} está repetida en dos filas`);
        vistas.set(clave, true);
      }
    }
    return problemas;
  }

  async function guardar() {
    setError('');
    setMensaje('');
    const problemas = validar();
    if (problemas.length > 0) {
      setError(
        `No se guardó nada. Revisa: ${problemas.slice(0, 4).join('; ')}${problemas.length > 4 ? `; y ${problemas.length - 4} más` : ''}.`,
      );
      return;
    }

    setGuardando(true);
    const nuevosOriginales = {};
    const reemplazos = new Map(); // id temporal -> fila real ya creada
    let creadas = 0;
    let actualizadas = 0;
    let fallo = null;
    let equivGuardadas = false;
    try {
      // Una petición por materia en vez de un upsert masivo: si una falla (ej.
      // una clave que ya existe en otro departamento), las demás ya quedaron
      // guardadas y el mensaje puede decir exactamente cuál falló.
      for (const f of pendientes) {
        fallo = f;
        if (f.esNueva) {
          const [creada] = await apiFetch('/materia', token, {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ ...limpiar(f), departamento_id: departamentoId }),
          });
          const fila = normalizar(creada);
          reemplazos.set(f.id, fila);
          nuevosOriginales[fila.id] = { ...fila };
          creadas += 1;
        } else {
          await apiFetch(`/materia?id=eq.${f.id}`, token, {
            method: 'PATCH',
            body: JSON.stringify(cambiosDe(f, originales[f.id])),
          });
          nuevosOriginales[f.id] = { ...f, ...limpiar(f) };
          actualizadas += 1;
        }
      }
      // Las equivalencias van al final: dependen de que las materias nuevas ya
      // tengan id, y si algo falló arriba es mejor no tocarlas.
      fallo = null;
      if (hayCambiosEquiv) await guardarEquivalentes();
      equivGuardadas = hayCambiosEquiv;

      const partes = [];
      if (creadas > 0) partes.push(`${creadas} ${creadas === 1 ? 'materia creada' : 'materias creadas'}`);
      if (actualizadas > 0) partes.push(`${actualizadas} ${actualizadas === 1 ? 'actualizada' : 'actualizadas'}`);
      if (equivGuardadas) partes.push('equivalencias actualizadas');
      setMensaje(`${partes.join(', ')}.`);
    } catch (err) {
      const hechas = creadas + actualizadas;
      const detalle = fallo
        ? mensajeLegible(err, fallo)
        : `al guardar las equivalencias: ${err.message}`;
      setError(
        hechas > 0
          ? `Se guardaron ${hechas} de ${pendientes.length} y ahí se detuvo: ${detalle}`
          : `No se guardó: ${detalle}`,
      );
    } finally {
      if (equivGuardadas) setCoOfertaOriginal(JSON.parse(JSON.stringify(coOferta)));
      // Lo que sí pasó se consolida aunque haya fallado algo después: dejarlo
      // como "pendiente" haría que el siguiente Guardar lo reintentara y, en
      // el caso de una materia nueva, la duplicaría.
      if (Object.keys(nuevosOriginales).length > 0) {
        setOriginales((prev) => ({ ...prev, ...nuevosOriginales }));
        setFilas((prev) =>
          prev.map((f) => {
            if (reemplazos.has(f.id)) return reemplazos.get(f.id);
            return nuevosOriginales[f.id] ? { ...nuevosOriginales[f.id] } : f;
          }),
        );
      }
      setGuardando(false);
    }
  }

  if (cargando) return <div className="formulario-cargando">Cargando…</div>;

  const visibles = soloActivas ? filas.filter((f) => f.activa) : filas;
  const idsPendientes = new Set(pendientes.map((p) => p.id));
  const haySinGuardar = pendientes.length > 0 || hayCambiosEquiv;

  const partesResumen = [];
  if (pendientes.length > 0) partesResumen.push(`${pendientes.length} materias`);
  if (hayCambiosEquiv) {
    const n = materiasConEquivCambiada.size;
    partesResumen.push(`equivalencias de ${n} ${n === 1 ? 'materia' : 'materias'}`);
  }
  const resumenPendientes = haySinGuardar
    ? `Sin guardar: ${partesResumen.join(' y ')}.`
    : 'Sin cambios pendientes.';

  return (
    <div className="formulario-screen">
      <header className="formulario-header">
        <button
          className="btn-link"
          onClick={() => {
            if (
              pendientes.length > 0 &&
              !window.confirm(
                `Tienes ${pendientes.length} materias con cambios sin guardar. ¿Salir de todos modos?`,
              )
            ) {
              return;
            }
            onVolver();
          }}
        >
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Catálogo de materias</strong>
            <span>
              {nombreDepartamento(departamentoId)} · {filas.length} materias
            </span>
          </div>
        </div>
      </header>

      {error && <p className="formulario-error">{error}</p>}
      {mensaje && <p className="formulario-mensaje">{mensaje}</p>}

      <section className="formulario-seccion">
        <p className="formulario-nota">
          Estos son los datos oficiales de cada materia. Lo que cambies aquí afecta a todo el sistema,
          no solo al cuestionario. Para sacar una materia de circulación sin perder su historial,
          desmárcala como <strong>activa</strong> en vez de cambiarle la clave.
        </p>
        <div className="barra-filtros">
          <label className="check-linea">
            <input
              type="checkbox"
              checked={soloActivas}
              onChange={(e) => setSoloActivas(e.target.checked)}
            />
            Ver solo las activas
          </label>
          <button className="btn-secondary" onClick={agregar}>
            + Agregar materia
          </button>
        </div>
      </section>

      <div className="disponibilidad-grid-wrap">
        <table className="panel-tabla tabla-catalogo">
          <thead>
            <tr>
              <th>Activa</th>
              <th>Clave</th>
              <th>Nombre</th>
              <th>Créditos</th>
              <th>Equivalentes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr
                key={f.id}
                className={
                  f.esNueva
                    ? 'fila-nueva'
                    : idsPendientes.has(f.id) || materiasConEquivCambiada.has(f.id)
                      ? 'fila-editada'
                      : ''
                }
              >
                <td>
                  <input
                    type="checkbox"
                    checked={f.activa}
                    onChange={(e) => editar(f.id, 'activa', e.target.checked)}
                  />
                </td>
                <td>
                  <input
                    className="input-inline input-clave"
                    value={f.clave}
                    placeholder={f.esNueva ? 'MAT-00000' : ''}
                    onChange={(e) => editar(f.id, 'clave', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="input-inline"
                    value={f.nombre}
                    placeholder={f.esNueva ? 'Nombre de la materia' : ''}
                    onChange={(e) => editar(f.id, 'nombre', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="input-inline input-num"
                    type="number"
                    min={1}
                    value={f.creditos}
                    onChange={(e) => editar(f.id, 'creditos', e.target.value)}
                  />
                </td>
                <td className="celda-equivalentes">
                  <CeldaEquivalentes
                    fila={f}
                    equivalentes={coOferta[f.id] ?? []}
                    clavePorId={clavePorId}
                    candidatas={filas.filter(
                      (o) =>
                        !o.esNueva && o.id !== f.id && !(coOferta[f.id] ?? []).includes(o.id),
                    )}
                    editando={editandoEquiv === f.id}
                    onAbrir={() => setEditandoEquiv(editandoEquiv === f.id ? null : f.id)}
                    onAgregar={(otroId) => agregarEquivalente(f.id, otroId)}
                    onQuitar={(otroId) => quitarEquivalente(f.id, otroId)}
                  />
                </td>
                <td>
                  {f.esNueva && (
                    <button className="btn-link" onClick={() => quitarNueva(f.id)}>
                      Quitar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={6}>No hay materias que mostrar.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="formulario-nota nota-pie">
        <strong>Equivalentes</strong> son las claves que se imparten como la misma clase (mismo
        profesor, horario y salón). Solo se pueden ligar materias que ya existen en este catálogo, y
        la relación es de ida y vuelta: si marcas que A equivale a B, B queda equivalente a A.
      </p>

      <footer className="formulario-acciones barra-guardar">
        <span className="formulario-nota">{resumenPendientes}</span>
        <button className="btn-secondary" disabled={guardando || !haySinGuardar} onClick={descartar}>
          Descartar cambios
        </button>
        <button className="btn-primary" disabled={guardando || !haySinGuardar} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </footer>
    </div>
  );
}

// El selector se monta solo en la fila que se está editando: con ~50 materias,
// dejar un <select> con 50 opciones en cada fila son miles de nodos que hacen
// lenta la tabla para algo que casi nunca se toca.
function CeldaEquivalentes({
  fila,
  equivalentes,
  clavePorId,
  candidatas,
  editando,
  onAbrir,
  onAgregar,
  onQuitar,
}) {
  if (fila.esNueva) {
    return <span className="celda-vacia">guarda la materia primero</span>;
  }

  return (
    <div className="equiv-celda">
      <div className="equiv-chips">
        {equivalentes.length === 0 && !editando && <span className="celda-vacia">—</span>}
        {equivalentes.map((id) => (
          <span className="equiv-chip" key={id}>
            {clavePorId.get(id) ?? `#${id}`}
            <button
              type="button"
              aria-label={`Quitar ${clavePorId.get(id) ?? id}`}
              title="Quitar equivalencia"
              onClick={() => onQuitar(id)}
            >
              ×
            </button>
          </span>
        ))}
        <button type="button" className="btn-link equiv-abrir" onClick={onAbrir}>
          {editando ? 'Listo' : '+'}
        </button>
      </div>

      {editando && (
        <select
          className="input-inline"
          value=""
          onChange={(e) => {
            if (e.target.value) onAgregar(Number(e.target.value));
          }}
        >
          <option value="">Elige una materia…</option>
          {candidatas.map((o) => (
            <option key={o.id} value={o.id}>
              {o.clave} — {o.nombre}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
