import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { abrirSemestre, leerSemestres, reactivarSemestre } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';

// El ciclo de semestres (admin y jefa de división). Hay exactamente UN
// semestre activo: el que se está planeando. Abrir el siguiente lo activa y
// deja el anterior cerrado, de consulta. Cada departamento arranca con una
// copia de su formulario anterior, sin publicar.

const TIPOS = [
  { valor: 'primavera', etiqueta: 'Primavera' },
  { valor: 'verano', etiqueta: 'Verano' },
  { valor: 'otono', etiqueta: 'Otoño' },
];

/**
 * La sugerencia de siguiente semestre: primavera o verano -> otoño del mismo
 * año; otoño -> primavera del siguiente. Es solo el valor inicial: en la
 * pantalla se puede elegir cualquiera, verano incluido.
 */
function siguienteSemestre(actual) {
  if (!actual) {
    const hoy = new Date();
    return hoy.getMonth() < 6
      ? { tipo: 'otono', anio: hoy.getFullYear() }
      : { tipo: 'primavera', anio: hoy.getFullYear() + 1 };
  }
  return actual.tipo === 'otono'
    ? { tipo: 'primavera', anio: actual.anio + 1 }
    : { tipo: 'otono', anio: actual.anio };
}

export default function Semestres({ onVolver }) {
  const { token, departamentos, recargarPerfil } = useAuth();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [nuevo, setNuevo] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const d = await leerSemestres(token);
      setDatos(d);
      const activo = d.semestres.find((s) => s.estado === 'activo');
      setNuevo(siguienteSemestre(activo ? { tipo: activo.tipo, anio: Number(activo.anio) } : null));
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!datos) {
    return (
      <div className="formulario-screen">
        {error ? <p className="formulario-error">{error}</p> : <div className="formulario-cargando">Cargando…</div>}
      </div>
    );
  }

  const activo = datos.semestres.find((s) => s.estado === 'activo');
  const cerrados = datos.semestres.filter((s) => s.estado !== 'activo');
  const resumenDe = (semestreId, deptoId) =>
    datos.resumen[semestreId]?.[deptoId] ?? { publicado: false, enviadas: 0, borradores: 0, demanda: 0 };
  // El API dice qué departamentos le toca ver a quien llama (null = todos):
  // la jefatura de división hoy solo ve Matemáticas.
  const visibles = datos.departamentos_visibles
    ? departamentos.filter((d) => datos.departamentos_visibles.includes(d.id))
    : departamentos;

  const borradoresActivo = activo
    ? visibles.reduce((n, d) => n + resumenDe(activo.id, d.id).borradores, 0)
    : 0;
  const etiquetaNuevo = nuevo ? `${TIPOS.find((t) => t.valor === nuevo.tipo)?.etiqueta} ${nuevo.anio}` : '';

  async function abrir() {
    const pregunta =
      `¿Abrir ${etiquetaNuevo} como el semestre activo?\n\n` +
      (activo ? `${etiquetaSemestre(activo)} se cierra y queda solo de consulta.\n` : '') +
      'Cada departamento arranca con una copia de su formulario anterior, SIN publicar, y la misma ' +
      'disponibilidad de salones. No se copian respuestas, bloqueos ni demanda.' +
      (borradoresActivo > 0
        ? `\n\nOjo: en ${etiquetaSemestre(activo)} hay ${borradoresActivo} formularios en borrador que nadie envió.`
        : '');
    if (!window.confirm(pregunta)) return;
    setTrabajando(true);
    setError('');
    try {
      await abrirSemestre(token, nuevo.tipo, nuevo.anio);
    } catch (err) {
      setError(err.message);
      setTrabajando(false);
      return;
    }
    setMensaje(`${etiquetaNuevo} es ahora el semestre activo.`);
    await recargarTras(etiquetaNuevo);
  }

  async function reactivar(s) {
    if (
      !window.confirm(
        `¿Volver a activar ${etiquetaSemestre(s)}? ${activo ? `${etiquetaSemestre(activo)} se cierra. ` : ''}Úsalo solo para corregir algo; después vuelve a activar el que corresponde.`,
      )
    ) {
      return;
    }
    setTrabajando(true);
    setError('');
    try {
      await reactivarSemestre(token, s.id);
    } catch (err) {
      setError(err.message);
      setTrabajando(false);
      return;
    }
    setMensaje(`${etiquetaSemestre(s)} es ahora el semestre activo.`);
    await recargarTras(etiquetaSemestre(s));
  }

  // El cambio de semestre YA quedó hecho cuando esto corre: si la recarga
  // falla, no puede decir que falló el cambio — reintentarlo daría "ya es el
  // activo" y confundiría más.
  async function recargarTras(etiqueta) {
    try {
      await Promise.all([cargar(), recargarPerfil()]);
    } catch (err) {
      setError(`${etiqueta} sí quedó activo, pero no se pudo recargar la pantalla (${err.message}). Recarga la página.`);
    } finally {
      setTrabajando(false);
    }
  }

  const tablaResumen = (s) => (
    <table className="panel-tabla">
      <thead>
        <tr>
          <th>Departamento</th>
          <th>Formulario</th>
          <th>Enviados</th>
          <th>Borradores</th>
          <th>Demanda</th>
        </tr>
      </thead>
      <tbody>
        {visibles.map((d) => {
          const r = resumenDe(s.id, d.id);
          return (
            <tr key={d.id}>
              <td>{d.nombre}</td>
              <td>
                <span className={`badge ${r.publicado ? 'badge-enviado' : 'badge-no_iniciado'}`}>
                  {r.publicado ? 'Publicado' : 'Sin publicar'}
                </span>
              </td>
              <td>{r.enviadas}</td>
              <td>{r.borradores}</td>
              <td>{r.demanda ? `${r.demanda} materias` : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="formulario-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Semestres</strong>
            <span>El semestre activo es en el que se trabaja; los cerrados quedan de consulta.</span>
          </div>
        </div>
      </header>

      {error && <p className="formulario-error">{error}</p>}
      {mensaje && <p className="formulario-mensaje">{mensaje}</p>}

      <section className="formulario-seccion">
        <div className="materias-bloque-encabezado">
          <h2>{activo ? etiquetaSemestre(activo) : 'Ningún semestre activo'}</h2>
          {activo && <span className="badge badge-enviado">Activo</span>}
        </div>
        {activo && tablaResumen(activo)}
      </section>

      <section className="formulario-seccion">
        <h2>Abrir el siguiente semestre</h2>
        <p className="formulario-nota">
          Se hace una vez por semestre, cuando empieza la planeación (alrededor de septiembre para
          primavera y de marzo para otoño).
        </p>
        {nuevo && (
          <div className="semestre-nuevo">
            <select
              aria-label="Tipo de semestre"
              value={nuevo.tipo}
              onChange={(e) => setNuevo((n) => ({ ...n, tipo: e.target.value }))}
            >
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
            <input
              type="number"
              aria-label="Año"
              className="input-num"
              min={2020}
              max={2100}
              value={nuevo.anio}
              onChange={(e) => setNuevo((n) => ({ ...n, anio: Number(e.target.value) }))}
            />
            <button className="btn-primary" disabled={trabajando} onClick={abrir}>
              Abrir {etiquetaNuevo}
            </button>
          </div>
        )}
      </section>

      {cerrados.length > 0 && (
        <section className="formulario-seccion">
          <h2>Semestres cerrados</h2>
          {cerrados.map((s) => (
            <details key={s.id} className="semestre-cerrado">
              <summary>
                <strong>{etiquetaSemestre(s)}</strong>
                {s.cerrado_at && <span className="formulario-nota"> · cerrado el {s.cerrado_at.slice(0, 10)}</span>}
              </summary>
              {tablaResumen(s)}
              <button className="btn-link" disabled={trabajando} onClick={() => reactivar(s)}>
                Volver a activar este semestre
              </button>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
