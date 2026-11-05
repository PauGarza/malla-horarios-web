import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { leerAviso, leerHorarioProfesor } from '../lib/api';
import { TIPO_CONTRATO_LABELS, departamentoInicial } from '../lib/roles';
import SelectorDepartamento from '../components/SelectorDepartamento';
import HorarioProfesor from '../components/HorarioProfesor';

// Solo admin (2026-11-03): cómo vería un profesor su horario en Mi perfil, para
// revisarlo antes de presentárselo a los jefes.

export default function VistaPreviaHorario({ onVolver }) {
  const { token, profesor, departamentos, semestre, nombreDepartamento } = useAuth();
  const [departamentoId, setDepartamentoId] = useState(() => departamentoInicial(profesor, departamentos));
  const [profesores, setProfesores] = useState(null);
  const [profesorId, setProfesorId] = useState(null);
  const [horario, setHorario] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!semestre || !departamentoId) return undefined;
    let cancelado = false;
    setProfesores(null);
    setProfesorId(null);
    setHorario(null);
    setError('');
    leerAviso(token, semestre.id, departamentoId)
      .then((d) => {
        if (cancelado) return;
        const lista = d.profesores.filter((p) => p.n_clases > 0 || p.estado !== 'sin_avisar');
        setProfesores(lista);
        setProfesorId(lista[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestre, departamentoId]);

  useEffect(() => {
    if (!profesorId) return undefined;
    let cancelado = false;
    setHorario(null);
    leerHorarioProfesor(token, semestre.id, departamentoId, profesorId)
      .then((d) => {
        if (!cancelado) setHorario(d);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestre, departamentoId, profesorId]);

  const elegido = profesores?.find((p) => p.id === profesorId);

  return (
    <div className="formulario-screen perfil-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <strong className="perfil-titulo">Vista previa del horario en el perfil</strong>
        <div className="horarios-acciones">
          <SelectorDepartamento
            valor={departamentoId}
            onCambiar={setDepartamentoId}
            disabled={!profesores && !error}
            opciones={departamentos.filter((d) => d.clave_prefijo !== 'ACT')}
          />
          {profesores && profesores.length > 0 && (
            <label className="selector-depto">
              Profesor
              <select value={profesorId ?? ''} onChange={(e) => setProfesorId(Number(e.target.value))}>
                {profesores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <p className="formulario-aviso">
        Solo tú ves esta pantalla. Los profesores ven su horario en su perfil cuando la jefatura de su departamento
        activa la vista.
      </p>
      {error && (
        <p className="formulario-error" role="alert">
          {error}
        </p>
      )}
      {profesores && profesores.length === 0 && !error && (
        <p className="formulario-nota">Este departamento todavía no tiene profesores con clases asignadas.</p>
      )}

      {elegido && (
        <section className="formulario-seccion">
          <h2>Mis datos</h2>
          <dl className="perfil-datos">
            <div>
              <dt>Nombre</dt>
              <dd>{elegido.nombre}</dd>
            </div>
            <div>
              <dt>Departamento</dt>
              <dd>{nombreDepartamento(departamentoId)}</dd>
            </div>
            <div>
              <dt>Tipo de contrato</dt>
              <dd>{TIPO_CONTRATO_LABELS[elegido.tipo_contrato] ?? elegido.tipo_contrato}</dd>
            </div>
          </dl>
        </section>
      )}

      {horario && (
        <section className="formulario-seccion">
          <h2>Mi horario</h2>
          {horario.origen === 'malla' && (
            <p className="formulario-nota nota-falta">
              Aún no se le envía el aviso: esto es cómo se vería con la malla actual. No lo verá hasta recibirlo.
            </p>
          )}
          {horario.clases.length > 0 ? (
            <HorarioProfesor clases={horario.clases} />
          ) : (
            <p className="formulario-nota">No tiene clases en su último aviso.</p>
          )}
        </section>
      )}
    </div>
  );
}
