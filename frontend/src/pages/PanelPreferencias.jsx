import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { panel as cargarPanel, reabrirPreferencia } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { veTodosLosDepartamentos } from '../lib/roles';

const ESTADO_LABELS = {
  no_iniciado: 'No ha iniciado',
  borrador: 'Borrador en progreso',
  enviado: 'Enviado',
};

// "Panel de preferencias recibidas" (docs/mockup/cuestionario-profesores.md
// §2): quién respondió, quién falta, antes de correr la asignación. No es el
// panel grande de Jefe de Departamento de RF14 (grupos/asignación/histórico
// de match) — eso sigue sin construir, ver HomePage.
export default function PanelPreferencias({ onVolver, onVerFormulario }) {
  const { token, profesor, semestre, nombreDepartamento } = useAuth();
  // Quién ve los 3 departamentos y no solo el suyo. Se pregunta por
  // comportamiento y no contra un rol concreto (ver lib/roles.js).
  const veTodos = veTodosLosDepartamentos(profesor.rol);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [filas, setFilas] = useState([]);
  const [reabriendoId, setReabriendoId] = useState(null);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      try {
        if (!semestre) throw new Error('No hay ningún semestre configurado todavía.');
        // Una petición: panel.php ya trae el roster unido a la preferencia de
        // cada quien. Antes eran tres (/semestre, /profesor, /preferencia) más
        // un Map en el cliente para juntarlas, y el filtro por departamento lo
        // ponía RLS en vez de un WHERE.
        const datos = await cargarPanel(token, semestre.id);
        if (!cancelado) setFilas(datos.filas);
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
  }, [token, semestre]);

  async function reabrir(fila) {
    setReabriendoId(fila.profesorId);
    setError('');
    try {
      await reabrirPreferencia(token, fila.preferenciaId);
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
            <span>
              {veTodos ? 'Todos los departamentos' : nombreDepartamento(profesor.departamento_id)} ·{' '}
              {etiquetaSemestre(semestre)}
            </span>
          </div>
        </div>
      </header>

      {error && <p className="formulario-error">{error}</p>}

      <div className="disponibilidad-grid-wrap">
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>Profesor</th>
              {veTodos && <th>Departamento</th>}
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.profesorId}>
                <td>
                  {f.nombre}
                  {f.estadoEspecial && <span className="materia-alias"> · {f.estadoEspecial}</span>}
                </td>
                {veTodos && <td>{nombreDepartamento(f.departamentoId) ?? '—'}</td>}
                <td>
                  <span className={`badge badge-${f.estado}`}>{ESTADO_LABELS[f.estado]}</span>
                </td>
                <td>
                  {/* El flex va en un div y no en el <td>: un td con
                      display:flex deja de ser celda y la fila se desfasa. */}
                  <div className="panel-acciones">
                    {f.estado !== 'no_iniciado' && (
                      <button className="btn-secondary" onClick={() => onVerFormulario(f.profesor)}>
                        Ver formulario
                      </button>
                    )}
                    {f.estado === 'enviado' && (
                      <button
                        className="btn-secondary"
                        disabled={reabriendoId === f.profesorId}
                        onClick={() => reabrir(f)}
                      >
                        Activar formulario de nuevo
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={veTodos ? 4 : 3}>No hay profesores con tipo de contrato configurado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
