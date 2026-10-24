import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { cambiarProfesorMalla, leerMalla } from '../lib/api';
import { montarMalla } from '../lib/mallaVista';
import { veTodosLosDepartamentos } from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';

// La malla del semestre para la jefatura (paso 13 de
// malla-horarios/docs/flujo-del-sistema.md): los grupos que dejó el motor y
// los publicados, con los choques y avisos recalculados contra los datos de
// hoy. Lo que trae api/malla.php; el dibujo y la revisión viven en
// lib/mallaVista.js, que pinta en un contenedor que React no toca.
//
// Desde la tarjeta de un grupo se le cambia el profesor (2026-10-23); mover
// grupos y publicar llegan después.

const TODOS = 'todos';

/** Los departamentos que se piden a api/malla.php; null = el de la cuenta. */
const deptosDe = (veTodos, alcance, departamentos) =>
  !veTodos ? null : alcance === TODOS ? departamentos.map((d) => d.id) : [Number(alcance)];

export default function MallaHorarios({ onVolver }) {
  const { token, profesor, departamentos, semestre } = useAuth();
  const veTodos = veTodosLosDepartamentos(profesor.rol);
  const [alcance, setAlcance] = useState(TODOS);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const raiz = useRef(null);
  const [alto, setAlto] = useState(null);

  // Lo que la malla necesita además de los datos. Por ref: un render del padre
  // (otra función onVolver) no tiene que volver a montarla.
  const opciones = useRef(null);
  useEffect(() => {
    const deptos = deptosDe(veTodos, alcance, departamentos);
    opciones.current = {
      onVolver: () => onVolver(),
      alcances: veTodos
        ? [...departamentos.map((d) => ({ valor: String(d.id), etiqueta: d.nombre })), { valor: TODOS, etiqueta: 'Los tres' }]
        : null,
      alcance,
      onAlcance: setAlcance,
      onProfesor: (grupoId, profesorId) => cambiarProfesorMalla(token, semestre.id, deptos, grupoId, profesorId),
    };
  }, [onVolver, veTodos, departamentos, alcance, token, semestre]);

  useEffect(() => {
    if (!semestre) return undefined;
    let cancelado = false;
    setDatos(null);
    setError('');
    leerMalla(token, semestre.id, deptosDe(veTodos, alcance, departamentos))
      .then((d) => {
        if (!cancelado) setDatos(d);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestre, veTodos, alcance, departamentos]);

  // La malla ocupa lo que queda de la ventana debajo de la barra superior: así
  // cabe la semana completa sin desplazar la página.
  useLayoutEffect(() => {
    const medir = () => {
      if (raiz.current) setAlto(window.innerHeight - raiz.current.getBoundingClientRect().top);
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  useEffect(() => {
    if (!datos || !raiz.current) return undefined;
    const vista = montarMalla(raiz.current, datos, opciones.current);
    return () => vista.destruir();
  }, [datos]);

  return (
    <div className="malla-pagina">
      {!datos && (
        <div className="malla-cargando">
          {!semestre ? (
            <p className="formulario-error">No hay ningún semestre activo.</p>
          ) : error ? (
            <p className="formulario-error">{error}</p>
          ) : (
            `Cargando la malla de ${etiquetaSemestre(semestre)}…`
          )}
          {(!semestre || error) && (
            <button type="button" className="btn-link" onClick={onVolver}>
              ← Volver
            </button>
          )}
        </div>
      )}
      <div className="malla" ref={raiz} style={alto ? { height: alto } : undefined} />
    </div>
  );
}
