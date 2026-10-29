import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  cambiarProfesorMalla,
  descartarAvisoMalla,
  leerMalla,
  leerVersionesMalla,
  moverClaseMalla,
  preferirVersionMalla,
  quitarVersionPreferida,
  soltarClaseMalla,
} from '../lib/api';
import { montarMalla } from '../lib/mallaVista';
import { veMallaDeTodaLaDivision } from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';
import { agruparVersiones, compararMallas, etiquetaVersion, fechaVersion } from '../lib/versionesMalla';

// La malla del semestre para la jefatura (paso 13 de
// malla-horarios/docs/flujo-del-sistema.md): los grupos que dejó el motor y
// los publicados, con los choques y avisos recalculados contra los datos de
// hoy. Lo que trae api/malla.php; el dibujo y la revisión viven en
// lib/mallaVista.js, que pinta en un contenedor que React no toca.
//
// La jefatura hace aquí la edición final (2026-10-27): cambia el profesor desde
// la tarjeta de un grupo y lo mueve de horario o salón arrastrándolo. Cada jefe
// en su departamento; la jefatura de división y admin, en los tres. Publicar
// llega después. Lo que se edita queda conservado (2026-10-27): la siguiente
// subida del motor no lo rehace, salvo que se suelte desde el detalle del grupo.
//
// Versiones anteriores (2026-10-29, D60): el selector «Versión» abre la malla
// que dejó una subida anterior, en solo lectura y comparada con la actual, y
// deja marcarla como la que prefiere la jefatura (lib/versionesMalla.js).

const TODOS = 'todos';
const ACTUAL = '';

/** Los departamentos que se piden a api/malla.php; null = el de la cuenta. */
const deptosDe = (veTodos, alcance, departamentos) =>
  !veTodos ? null : alcance === TODOS ? departamentos.map((d) => d.id) : [Number(alcance)];

export default function MallaHorarios({ onVolver }) {
  const { token, profesor, departamentos, semestre } = useAuth();
  const veTodos = veMallaDeTodaLaDivision(profesor.rol);
  const [alcance, setAlcance] = useState(TODOS);
  const [version, setVersion] = useState(ACTUAL);
  const [versiones, setVersiones] = useState([]);
  const [recargar, setRecargar] = useState(0);
  const actual = useRef(null); // la malla de hoy, para comparar una versión contra ella
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
      versiones: [
        { valor: ACTUAL, etiqueta: 'Actual' },
        ...versiones.map((v) => ({ valor: String(v.corrida_id), etiqueta: etiquetaVersion(v) })),
      ],
      version,
      // Volver a la actual la pide otra vez: lo que se editó antes de ir a una versión ya está guardado.
      onVersion: (v) => (v === ACTUAL ? setRecargar((n) => n + 1) : setVersion(v)),
      onProfesor: (grupoId, profesorId) => cambiarProfesorMalla(token, semestre.id, deptos, grupoId, profesorId),
      onMover: (grupoId, cambio) => moverClaseMalla(token, semestre.id, deptos, grupoId, cambio),
      onDescartar: (cuerpo) => descartarAvisoMalla(token, semestre.id, deptos, cuerpo),
      onSoltar: (grupoId) => soltarClaseMalla(token, semestre.id, deptos, grupoId),
      onPreferir: (corridaId, nota) =>
        preferirVersionMalla(token, semestre.id, deptos, corridaId, nota).then((r) => {
          leerVersionesMalla(token, semestre.id, deptos).then((x) => setVersiones(agruparVersiones(x.versiones)), () => {});
          return r.preferida;
        }),
      onQuitar: (corridaId) =>
        quitarVersionPreferida(token, semestre.id, deptos, corridaId).then(() => {
          leerVersionesMalla(token, semestre.id, deptos).then((x) => setVersiones(agruparVersiones(x.versiones)), () => {});
        }),
    };
  }, [onVolver, veTodos, departamentos, alcance, version, versiones, token, semestre]);

  // La malla de hoy y la lista de versiones del alcance. Al cambiar de alcance, o al volver de
  // una versión, se pinta la actual.
  useEffect(() => {
    if (!semestre) return undefined;
    let cancelado = false;
    const deptos = deptosDe(veTodos, alcance, departamentos);
    setDatos(null);
    setError('');
    setVersion(ACTUAL);
    // Las dos juntas, para que el selector ya esté al montar la malla. Sin la lista (o antes
    // de que exista la tabla) la malla se ve igual, sin selector.
    Promise.all([
      leerMalla(token, semestre.id, deptos),
      leerVersionesMalla(token, semestre.id, deptos).catch(() => ({ versiones: [] })),
    ])
      .then(([d, x]) => {
        if (cancelado) return;
        actual.current = d;
        setVersiones(agruparVersiones(x.versiones));
        setDatos(d);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestre, veTodos, alcance, departamentos, recargar]);

  // Una versión anterior: ella y la actual de nuevo, para que el comparativo sea contra lo de
  // ahora aunque se haya editado algo antes de abrirla.
  useEffect(() => {
    if (version === ACTUAL) return undefined;
    let cancelado = false;
    const deptos = deptosDe(veTodos, alcance, departamentos);
    setDatos(null);
    setError('');
    Promise.all([leerMalla(token, semestre.id, deptos, Number(version)), leerMalla(token, semestre.id, deptos)])
      .then(([v, d]) => {
        if (cancelado) return;
        actual.current = d;
        setDatos(v);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
    // alcance y departamentos: al cambiar, el efecto de arriba ya regresa a la actual.
  }, [version]);

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
    let o = opciones.current;
    const v = datos.version;
    if (v) {
      // Una versión anterior solo se ve: sin arrastre, sin cambio de profesor, sin descartar.
      const { onPreferir, onQuitar } = o;
      o = {
        ...o,
        onMover: undefined,
        onProfesor: undefined,
        onSoltar: undefined,
        onDescartar: undefined,
        vistaVersion: {
          etiqueta: fechaVersion(v.subido_at),
          comparativo: actual.current ? compararMallas(datos.entrada, datos.grupos, actual.current.grupos) : null,
          preferida: v.preferida,
          onPreferir: (nota) => onPreferir(v.corrida_id, nota),
          onQuitar: () => onQuitar(v.corrida_id),
        },
      };
    }
    const vista = montarMalla(raiz.current, datos, o);
    return () => vista.destruir();
    // actual y opciones van por ref: se fijan antes que datos.
  }, [datos]);

  return (
    <div className="malla-pagina">
      {!datos && (
        <div className="malla-cargando">
          {!semestre ? (
            <p className="formulario-error">No hay ningún semestre activo.</p>
          ) : error ? (
            <p className="formulario-error">{error}</p>
          ) : version !== ACTUAL ? (
            'Cargando la versión anterior…'
          ) : (
            `Cargando la malla de ${etiquetaSemestre(semestre)}…`
          )}
          {(!semestre || error) && (
            <button type="button" className="btn-link" onClick={version !== ACTUAL && error ? () => setRecargar((n) => n + 1) : onVolver}>
              {version !== ACTUAL && error ? '← Volver a la actual' : '← Volver'}
            </button>
          )}
        </div>
      )}
      <div className="malla" ref={raiz} style={alto ? { height: alto } : undefined} />
    </div>
  );
}
