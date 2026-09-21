import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

const ESTADO_LABELS = {
  no_iniciado: 'No ha iniciado',
  borrador: 'Borrador en progreso',
  enviado: 'Enviado',
};

// "Panel de preferencias recibidas" (docs/mockup/cuestionario-profesores.md
// §2): quién respondió, quién falta, antes de correr la asignación. No es el
// panel grande de Jefe de Departamento de RF14 (grupos/asignación/histórico
// de match) — eso sigue sin construir, ver HomePage.
export default function PanelPreferencias({ onVolver }) {
  const { token, profesor, nombreDepartamento } = useAuth();
  const esAdmin = profesor.rol === 'admin';

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filas, setFilas] = useState([]);
  const [reabriendoId, setReabriendoId] = useState(null);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        const [semestres, profesores] = await Promise.all([
          apiFetch('/semestre?select=id,etiqueta&order=id.desc&limit=1', token),
          apiFetch('/profesor?select=id,nombre,departamento_id&tipo_contrato=not.is.null&order=nombre.asc', token),
        ]);
        const sem = semestres[0];
        if (!sem) throw new Error('No hay ningún semestre configurado todavía.');

        const preferencias = await apiFetch(
          `/preferencia?select=id,profesor_id,estado,enviado_at&semestre_id=eq.${sem.id}`,
          token,
        );
        const porProfesor = new Map(preferencias.map((p) => [p.profesor_id, p]));

        if (!cancelado) {
          setFilas(
            profesores.map((p) => {
              const pref = porProfesor.get(p.id);
              return {
                profesorId: p.id,
                nombre: p.nombre,
                departamentoId: p.departamento_id,
                preferenciaId: pref?.id ?? null,
                estado: pref?.estado ?? 'no_iniciado',
              };
            }),
          );
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
  }, [token]);

  async function reabrir(fila) {
    setReabriendoId(fila.profesorId);
    setError('');
    try {
      await apiFetch(`/preferencia?id=eq.${fila.preferenciaId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ estado: 'borrador', enviado_at: null }),
      });
      setFilas((prev) =>
        prev.map((f) => (f.profesorId === fila.profesorId ? { ...f, estado: 'borrador' } : f)),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setReabriendoId(null);
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
            <strong>Preferencias recibidas</strong>
            <span>{esAdmin ? 'Todos los departamentos' : nombreDepartamento(profesor.departamento_id)}</span>
          </div>
        </div>
      </header>

      {error && <p className="formulario-error">{error}</p>}

      <div className="disponibilidad-grid-wrap">
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>Profesor</th>
              {esAdmin && <th>Departamento</th>}
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.profesorId}>
                <td>{f.nombre}</td>
                {esAdmin && <td>{nombreDepartamento(f.departamentoId) ?? '—'}</td>}
                <td>
                  <span className={`badge badge-${f.estado}`}>{ESTADO_LABELS[f.estado]}</span>
                </td>
                <td>
                  {f.estado === 'enviado' && (
                    <button
                      className="btn-secondary"
                      disabled={reabriendoId === f.profesorId}
                      onClick={() => reabrir(f)}
                    >
                      Activar formulario de nuevo
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={esAdmin ? 4 : 3}>No hay profesores con tipo de contrato configurado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
