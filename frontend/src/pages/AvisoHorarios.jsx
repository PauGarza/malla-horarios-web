import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { accionAviso, leerAviso, leerEnvioAviso } from '../lib/api';
import { TIPO_CONTRATO_LABELS, departamentoInicial, soloConsultaAvisos, veMallaDeTodaLaDivision } from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';
import SelectorDepartamento from '../components/SelectorDepartamento';
import EditorCorreo from '../components/EditorCorreo';
import { textoSesiones } from '../components/HorarioProfesor';

// Avisar a los profesores sus materias y horarios (2026-11-03). El correo se arma
// siempre en el servidor (api/lib/aviso.php): la vista previa, la prueba y el envío
// real salen de lo mismo. Las fechas son del semestre, las mismas para todos los
// departamentos; lo demás es de cada departamento.

const CONTRATOS = ['tiempo_completo', 'medio_tiempo', 'asignatura'];
const FECHAS_VACIAS = { inicio: '', bajas: '', fin: '', examenes_inicio: '', examenes_fin: '' };
const CAMPOS_FECHA = [
  ['[FECHA DE INICIO DEL SEMESTRE]', ['inicio']],
  ['[FECHA LÍMITE DE BAJAS]', ['bajas']],
  ['[FECHA DE FIN DEL SEMESTRE]', ['fin']],
  ['[FECHAS DE EXÁMENES FINALES]', ['examenes_inicio', 'examenes_fin']],
];
const CAMPO_LISTA = '[LISTA DE CLASES]';
const PAUSA_ENTRE_CORREOS = 300;

const fechasDe = (f) => Object.fromEntries(Object.keys(FECHAS_VACIAS).map((k) => [k, f?.[k] ?? '']));
// Con el día de la semana, para comprobar que cuadre con el calendario. Se arma con
// la fecha local: new Date('2027-01-11') sería UTC y en México caería un día antes.
const diaCompleto = (ymd) => {
  if (!ymd) return '';
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};
const cuando = (iso) =>
  iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
const sePuedeEnviar = (p) => Boolean(p.correo) && p.n_clases > 0;
const conCambio = (p) => p.estado === 'cambio' || p.estado === 'sin_clases';
const usaCampo = (v, campo) => v.cuerpo.includes(campo) || v.asunto.includes(campo);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Al abrir: marcados los que faltan por avisar, menos los que el jefe quitó y guardó. */
function seleccionInicial(profesores, excluidos) {
  const fuera = new Set(excluidos ?? []);
  return new Set(profesores.filter((p) => sePuedeEnviar(p) && p.estado === 'sin_avisar' && !fuera.has(p.id)).map((p) => p.id));
}

export default function AvisoHorarios({ onVolver }) {
  const { token, profesor, departamentos, semestre } = useAuth();
  // La jefatura de división revisa; las acciones son de los jefes. Actuaría no entra en
  // este proceso (decisión de la usuaria, 2026-11-03).
  const soloConsulta = soloConsultaAvisos(profesor.rol);
  const opcionesDepartamento = useMemo(() => departamentos.filter((d) => d.clave_prefijo !== 'ACT'), [departamentos]);
  const [departamentoId, setDepartamentoId] = useState(() => departamentoInicial(profesor, departamentos));
  const [datos, setDatos] = useState(null);
  const [fechas, setFechas] = useState(FECHAS_VACIAS);
  const [borrador, setBorrador] = useState(null);
  const [sucio, setSucio] = useState(false);
  const [pestanaId, setPestanaId] = useState(null);
  const [seleccion, setSeleccion] = useState(() => new Set());
  // Sube para que el editor vuelva a pintar su contenido: no es controlado.
  const [reinicioEditor, setReinicioEditor] = useState(0);
  const [buscar, setBuscar] = useState('');
  const [soloCambios, setSoloCambios] = useState(false);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [ddlAbierto, setDdlAbierto] = useState(false);
  const [ddlPerfilAbierto, setDdlPerfilAbierto] = useState(false);
  const [pestanaRedaccion, setPestanaRedaccion] = useState('correo');
  const [buscarPerfil, setBuscarPerfil] = useState('');
  // Los desmarcados: quienes no ven Mi horario aunque la vista esté activa.
  const [perfilFuera, setPerfilFuera] = useState(() => new Set());
  const [ejemploId, setEjemploId] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [correoPrueba, setCorreoPrueba] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [confirmacion, setConfirmacion] = useState(null);
  const [envio, setEnvio] = useState(null);
  const [modal, setModal] = useState(null);
  const detener = useRef(false);

  const semestreId = semestre?.id;
  const accion = useCallback(
    (cuerpo) => accionAviso(token, semestreId, departamentoId, cuerpo),
    [token, semestreId, departamentoId],
  );

  const refrescar = useCallback(async () => {
    const d = await leerAviso(token, semestreId, departamentoId);
    setDatos(d);
    setFechas(fechasDe(d.fechas));
    return d;
  }, [token, semestreId, departamentoId]);

  // Al abrir o cambiar de departamento: lo guardado reemplaza lo que hubiera en pantalla.
  useEffect(() => {
    if (!semestreId || !departamentoId) return undefined;
    let cancelado = false;
    setDatos(null);
    setBorrador(null);
    setError('');
    setMensaje('');
    setEnvio(null);
    leerAviso(token, semestreId, departamentoId)
      .then((d) => {
        if (cancelado) return;
        setDatos(d);
        setFechas(fechasDe(d.fechas));
        setBorrador(d.borrador);
        setSucio(false);
        setPestanaId(d.borrador.versiones[0]?.id ?? null);
        setSeleccion(seleccionInicial(d.profesores, d.borrador.excluidos));
        setPerfilFuera(new Set(d.perfil.excluidos ?? []));
        setEjemploId(d.profesores.find((p) => p.n_clases > 0)?.id ?? d.profesores[0]?.id ?? null);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestreId, departamentoId]);

  // El ejemplo se vuelve a armar mientras se edita, con una pausa para no pedirlo en cada tecla.
  useEffect(() => {
    if (!borrador || !ejemploId) {
      setPrevia(null);
      return undefined;
    }
    let cancelado = false;
    const t = window.setTimeout(() => {
      accion({ accion: 'vista_previa', borrador, profesor_id: ejemploId, perfil_excluidos: [...perfilFuera] })
        .then((r) => {
          if (!cancelado) setPrevia(r);
        })
        .catch((err) => {
          if (!cancelado) setPrevia({ motivo: err.message });
        });
    }, 600);
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }, [accion, borrador, ejemploId, perfilFuera, datos?.fechas]);

  const versiones = useMemo(() => borrador?.versiones ?? [], [borrador]);
  const version = versiones.find((v) => v.id === pestanaId) ?? versiones[0] ?? null;
  const profesores = useMemo(() => datos?.profesores ?? [], [datos]);
  const versionDe = useCallback(
    (p) => versiones.find((v) => v.contratos.includes(p.tipo_contrato)) ?? null,
    [versiones],
  );

  const elegidos = useMemo(
    () => profesores.filter((p) => seleccion.has(p.id) && sePuedeEnviar(p) && versionDe(p)),
    [profesores, seleccion, versionDe],
  );
  const conCambios = useMemo(() => profesores.filter(conCambio), [profesores]);
  const sinVersion = CONTRATOS.filter(
    (c) => !versiones.some((v) => v.contratos.includes(c)) && profesores.some((p) => p.tipo_contrato === c),
  );

  const filas = useMemo(() => {
    if (!version) return [];
    const q = buscar.trim().toLowerCase();
    return profesores.filter(
      (p) =>
        version.contratos.includes(p.tipo_contrato) &&
        (!soloCambios || conCambio(p)) &&
        (!q || p.nombre.toLowerCase().includes(q) || (p.correo ?? '').toLowerCase().includes(q)),
    );
  }, [profesores, version, buscar, soloCambios]);

  // Los destinatarios de la pestaña, sin los filtros: es lo que resume el desplegable.
  const profesoresVersion = version ? profesores.filter((p) => version.contratos.includes(p.tipo_contrato)) : [];
  const elegidosVersion = version ? elegidos.filter((p) => version.contratos.includes(p.tipo_contrato)).length : 0;

  // Quién ve la vista en el perfil, para su desplegable.
  const conVista = profesores.filter((p) => !perfilFuera.has(p.id));
  const guardadosFuera = datos?.perfil.excluidos ?? [];
  const seleccionPerfilCambio =
    guardadosFuera.length !== perfilFuera.size || guardadosFuera.some((id) => !perfilFuera.has(id));
  const filasPerfil = profesores.filter((p) => p.nombre.toLowerCase().includes(buscarPerfil.trim().toLowerCase()));

  function cambiarBorrador(cambios) {
    setBorrador((b) => ({ ...b, ...cambios }));
    setSucio(true);
  }

  function cambiarVersion(id, cambios) {
    setBorrador((b) => ({ ...b, versiones: b.versiones.map((v) => (v.id === id ? { ...v, ...cambios } : v)) }));
    setSucio(true);
  }

  const versionId = version?.id;
  const alCambiarCuerpo = useCallback(
    (cuerpo) => {
      setBorrador((b) => ({ ...b, versiones: b.versiones.map((v) => (v.id === versionId ? { ...v, cuerpo } : v)) }));
      setSucio(true);
    },
    [versionId],
  );

  // El ejemplo sigue a la pestaña: si no, se edita un texto y se ve el de otra versión.
  function elegirPestana(v) {
    setPestanaId(v.id);
    setDdlAbierto(false);
    const actual = profesores.find((p) => p.id === ejemploId);
    if (actual && v.contratos.includes(actual.tipo_contrato)) return;
    const deLaVersion = profesores.filter((p) => v.contratos.includes(p.tipo_contrato));
    const nuevo = deLaVersion.find((p) => p.n_clases > 0) ?? deLaVersion[0];
    if (nuevo) setEjemploId(nuevo.id);
  }

  function agregarVersion() {
    const libres = CONTRATOS.filter((c) => !versiones.some((v) => v.contratos.includes(c)));
    const id = `v${Date.now()}`;
    setBorrador((b) => ({
      ...b,
      versiones: [
        ...b.versiones,
        { ...version, id, nombre: `Versión ${b.versiones.length + 1}`, contratos: libres },
      ],
    }));
    setPestanaId(id);
    setSucio(true);
  }

  function quitarVersion() {
    if (!window.confirm(`¿Quitar la versión "${version.nombre}"? Se pierde su texto.`)) return;
    const restantes = versiones.filter((v) => v.id !== version.id);
    setBorrador((b) => ({ ...b, versiones: restantes }));
    setPestanaId(restantes[0].id);
    setSucio(true);
  }

  function restaurarTexto() {
    if (!window.confirm('¿Regresar al texto original del departamento? Se pierde lo que hayas editado en esta versión.')) return;
    const original = datos.plantillas[version.plantilla] ?? Object.values(datos.plantillas)[0];
    cambiarVersion(version.id, { asunto: original.asunto, cuerpo: original.cuerpo });
    setReinicioEditor((n) => n + 1);
  }

  function alternar(id) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    setSucio(true);
  }

  function marcarVarios(lista, marcar) {
    setSeleccion((s) => {
      const n = new Set(s);
      for (const p of lista) {
        if (marcar) n.add(p.id);
        else n.delete(p.id);
      }
      return n;
    });
    setSucio(true);
  }

  async function guardarFechas() {
    const habia = Object.keys(FECHAS_VACIAS).some((k) => datos.fechas[k]);
    if (
      habia &&
      !window.confirm('Estas fechas son las mismas para todos los departamentos. ¿Cambiarlas para todos?')
    ) {
      return;
    }
    setOcupado('fechas');
    setError('');
    setMensaje('');
    try {
      const r = await accion({ accion: 'guardar_fechas', ...fechas });
      setDatos((d) => ({ ...d, fechas: r.fechas }));
      setFechas(fechasDe(r.fechas));
      setMensaje('Fechas guardadas para todos los departamentos.');
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado('');
    }
  }

  /** El borrador tal como se guarda, con los que el jefe desmarcó. */
  const paraGuardar = () => ({
    ...borrador,
    excluidos: profesores
      .filter((p) => sePuedeEnviar(p) && p.estado === 'sin_avisar' && !seleccion.has(p.id))
      .map((p) => p.id),
  });

  async function guardarBorrador() {
    setOcupado('borrador');
    setError('');
    setMensaje('');
    try {
      await accion({ accion: 'guardar', borrador: paraGuardar() });
      setSucio(false);
      setMensaje('Borrador guardado.');
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado('');
    }
  }

  async function mandarPrueba() {
    setOcupado('prueba');
    setError('');
    setMensaje('');
    try {
      const r = await accion({
        accion: 'prueba',
        borrador,
        profesor_id: ejemploId,
        para: correoPrueba,
        perfil_excluidos: [...perfilFuera],
      });
      setMensaje(`Correo de prueba enviado a ${r.para}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado('');
    }
  }

  /** Lo que impide enviar, antes de molestar al servidor correo por correo. */
  function problemasParaEnviar() {
    const hayFechasSinGuardar = Object.keys(FECHAS_VACIAS).some((k) => (datos.fechas[k] ?? '') !== fechas[k]);
    if (hayFechasSinGuardar) return ['Guarda las fechas del semestre antes de enviar.'];
    const problemas = [];
    for (const v of versiones) {
      if (!elegidos.some((p) => versionDe(p)?.id === v.id)) continue;
      const faltan = [];
      if (!v.cuerpo.includes(CAMPO_LISTA)) problemas.push(`"${v.nombre}": el texto no incluye ${CAMPO_LISTA}.`);
      for (const [campo, llaves] of CAMPOS_FECHA) {
        if (usaCampo(v, campo) && llaves.some((k) => !datos.fechas[k])) faltan.push(campo);
      }
      if (usaCampo(v, '[PERIODO]') && !borrador.periodo) faltan.push('[PERIODO]');
      if (usaCampo(v, '[MESES DEL SEMESTRE]') && !borrador.meses) faltan.push('[MESES DEL SEMESTRE]');
      if (faltan.length) problemas.push(`"${v.nombre}": falta capturar ${faltan.join(', ')}.`);
    }
    return problemas;
  }

  async function pedirConfirmacion() {
    setError('');
    setMensaje('');
    const problemas = problemasParaEnviar();
    if (problemas.length) {
      setError(problemas.join(' '));
      return;
    }
    setOcupado('borrador');
    try {
      await accion({ accion: 'guardar', borrador: paraGuardar() });
      setSucio(false);
      setConfirmacion({ activarPerfil: !datos.perfil.activo });
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado('');
    }
  }

  async function cambiarPerfil(activo) {
    const r = await accion({ accion: 'perfil_activo', activo, excluidos: [...perfilFuera] });
    setDatos((d) => ({ ...d, perfil: { ...d.perfil, activo, excluidos: r.excluidos } }));
  }

  function alternarPerfil(id) {
    setPerfilFuera((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function marcarPerfil(lista, ver) {
    setPerfilFuera((s) => {
      const n = new Set(s);
      for (const p of lista) {
        if (ver) n.delete(p.id);
        else n.add(p.id);
      }
      return n;
    });
  }

  async function ejecutarEnvio(lista) {
    detener.current = false;
    setEnvio({ total: lista.length, hechos: 0, ok: 0, errores: [], enCurso: true });
    let ok = 0;
    const errores = [];
    for (let i = 0; i < lista.length; i += 1) {
      if (detener.current) break;
      const p = lista[i];
      try {
        await accion({ accion: 'enviar', profesor_id: p.id, reenviar: p.estado === 'avisado' });
        ok += 1;
      } catch (err) {
        errores.push({ profesor: p, mensaje: err.message });
      }
      setEnvio({ total: lista.length, hechos: i + 1, ok, errores: [...errores], enCurso: true });
      if (i < lista.length - 1) await new Promise((r) => window.setTimeout(r, PAUSA_ENTRE_CORREOS));
    }
    setEnvio((e) => ({ ...e, ok, errores, enCurso: false, detenido: detener.current }));
    try {
      const d = await refrescar();
      // Los que ya recibieron su aviso salen de la selección; los que fallaron se quedan.
      const avisados = new Set(d.profesores.filter((p) => p.estado === 'avisado').map((p) => p.id));
      setSeleccion((s) => new Set([...s].filter((id) => !avisados.has(id))));
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmarEnvio() {
    const activar = confirmacion.activarPerfil;
    setConfirmacion(null);
    // La selección tiene que estar guardada antes: de ella depende qué correos llevan la
    // frase del perfil. Si no se pudo guardar, mejor no enviar nada.
    if (activar || seleccionPerfilCambio) {
      try {
        await cambiarPerfil(activar || datos.perfil.activo);
      } catch (err) {
        setError(`No se envió nada: no se pudo guardar la vista en el perfil (${err.message}).`);
        return;
      }
    }
    await ejecutarEnvio(elegidos);
  }

  async function marcarAvisado(p) {
    if (!window.confirm(`¿Dar por avisado a ${p.nombre}? No se le manda correo y se quita la alerta.`)) return;
    setError('');
    try {
      await accion({ accion: 'marcar_avisado', profesor_id: p.id });
      await refrescar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function verEnvio(p) {
    try {
      const r = await leerEnvioAviso(token, semestreId, departamentoId, p.envio_id);
      setModal({ tipo: 'envio', profesor: p, envio: r });
    } catch (err) {
      setError(err.message);
    }
  }

  function salir() {
    if (sucio && !window.confirm('Tienes cambios sin guardar. ¿Salir de todos modos?')) return;
    onVolver();
  }

  function cambiarDepartamento(id) {
    if (sucio && !window.confirm('Tienes cambios sin guardar. ¿Cambiar de departamento de todos modos?')) return;
    setDepartamentoId(id);
  }

  const ejemplo = profesores.find((p) => p.id === ejemploId);
  const enCurso = Boolean(envio?.enCurso);
  const bloqueado = enCurso || Boolean(ocupado);

  return (
    <div className="aviso-screen">
      <header className="formulario-header">
        <button className="btn-link" onClick={salir} disabled={enCurso}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Avisar horarios a los profesores</strong>
            <span>{etiquetaSemestre(semestre)} · un correo por profesor, con todas sus clases</span>
          </div>
          <SelectorDepartamento
            valor={departamentoId}
            onCambiar={cambiarDepartamento}
            disabled={!datos || bloqueado}
            visible={veMallaDeTodaLaDivision(profesor.rol)}
            opciones={opcionesDepartamento}
          />
        </div>
      </header>

      {!datos && !error && <p className="formulario-nota">Cargando…</p>}
      {!datos && error && (
        <p className="formulario-error" role="alert">
          {error}
        </p>
      )}

      {datos && borrador && (
        <>
          {soloConsulta && (
            <p className="formulario-aviso">
              Esta vista es de consulta: los cambios y los envíos los hacen los jefes de departamento.
            </p>
          )}
          <section className="formulario-seccion">
            <h2>Fechas del semestre</h2>
            <p className="formulario-nota">
              Son las mismas para todos los departamentos: se capturan una vez.
              {datos.fechas.actualizado_por &&
                ` Las guardó ${datos.fechas.actualizado_por} el ${cuando(datos.fechas.actualizado_at)}`}
            </p>
            <fieldset className="aviso-sin-marco aviso-fechas" disabled={soloConsulta}>
              <CampoFecha etiqueta="Inicio del semestre" valor={fechas.inicio} onCambio={(v) => setFechas({ ...fechas, inicio: v })} />
              <CampoFecha etiqueta="Fecha límite de bajas" valor={fechas.bajas} onCambio={(v) => setFechas({ ...fechas, bajas: v })} />
              <CampoFecha etiqueta="Fin del semestre" valor={fechas.fin} onCambio={(v) => setFechas({ ...fechas, fin: v })} />
              <CampoFecha
                etiqueta="Exámenes finales: del"
                valor={fechas.examenes_inicio}
                onCambio={(v) => setFechas({ ...fechas, examenes_inicio: v })}
              />
              <CampoFecha
                etiqueta="Exámenes finales: al"
                valor={fechas.examenes_fin}
                onCambio={(v) => setFechas({ ...fechas, examenes_fin: v })}
              />
            </fieldset>
            {!soloConsulta && (
              <div>
                <button className="btn-secondary" onClick={guardarFechas} disabled={bloqueado}>
                  {ocupado === 'fechas' ? 'Guardando…' : 'Guardar fechas'}
                </button>
              </div>
            )}
          </section>

          <section className="formulario-seccion">
            <h2>Datos del correo</h2>
            <fieldset className="aviso-sin-marco aviso-datos" disabled={soloConsulta}>
              <div>
                <label htmlFor="aviso-periodo">Periodo</label>
                <input id="aviso-periodo" maxLength={80} value={borrador.periodo} onChange={(e) => cambiarBorrador({ periodo: e.target.value })} />
              </div>
              <div>
                <label htmlFor="aviso-meses">Meses del semestre</label>
                <input id="aviso-meses" maxLength={80} value={borrador.meses} onChange={(e) => cambiarBorrador({ meses: e.target.value })} />
              </div>
              <div>
                <label htmlFor="aviso-copias">Copiar a</label>
                <input
                  id="aviso-copias"
                  placeholder="nombre@itam.mx, otro@itam.mx"
                  value={borrador.copias}
                  onChange={(e) => cambiarBorrador({ copias: e.target.value })}
                />
                <p className="formulario-nota">
                  Cada dirección recibe una copia por cada profesor, porque cada correo es personal.
                </p>
              </div>
              <div>
                <label htmlFor="aviso-respuestas">Las respuestas llegan a</label>
                <input
                  id="aviso-respuestas"
                  type="email"
                  maxLength={191}
                  value={borrador.respuestas_a ?? ''}
                  onChange={(e) => cambiarBorrador({ respuestas_a: e.target.value })}
                />
              </div>
            </fieldset>
          </section>

          <section className="formulario-seccion">
            <h2>Versiones del correo</h2>
            <p className="formulario-nota">
              {soloConsulta
                ? 'Cada profesor recibe solo la versión de su tipo.'
                : 'Puedes mandar el mismo correo a todos o uno distinto por tipo de profesor. Cada profesor recibe solo la versión de su tipo.'}
            </p>
            <div className="aviso-pestanas" role="tablist">
              {versiones.map((v) => {
                const n = elegidos.filter((p) => versionDe(p)?.id === v.id).length;
                return (
                  <button
                    key={v.id}
                    role="tab"
                    aria-selected={v.id === version?.id}
                    className={`aviso-pestana ${v.id === version?.id ? 'aviso-pestana-activa' : ''}`}
                    onClick={() => elegirPestana(v)}
                  >
                    {v.nombre} <span>({n})</span>
                  </button>
                );
              })}
              {!soloConsulta && (
                <button className="btn-link" onClick={agregarVersion} disabled={versiones.length >= 10}>
                  + Otra versión
                </button>
              )}
            </div>

            {sinVersion.length > 0 && (
              <p className="formulario-aviso">
                Los profesores de {sinVersion.map((c) => TIPO_CONTRATO_LABELS[c] ?? c).join(' y ')} no están en ninguna
                versión: no recibirán correo.
              </p>
            )}

            {version && (
              <>
                <div className="aviso-datos">
                  <div>
                    <label htmlFor="aviso-version-nombre">Nombre de la versión</label>
                    <input
                      id="aviso-version-nombre"
                      disabled={soloConsulta}
                      maxLength={80}
                      value={version.nombre}
                      onChange={(e) => cambiarVersion(version.id, { nombre: e.target.value })}
                    />
                  </div>
                  <fieldset className="aviso-tipos" disabled={soloConsulta}>
                    <legend>Tipos de profesor</legend>
                    {CONTRATOS.map((c) => {
                      const enOtra = versiones.find((v) => v.id !== version.id && v.contratos.includes(c));
                      return (
                        <label key={c} title={enOtra ? `Ya está en "${enOtra.nombre}"` : undefined}>
                          <input
                            type="checkbox"
                            checked={version.contratos.includes(c)}
                            disabled={Boolean(enOtra)}
                            onChange={(e) =>
                              cambiarVersion(version.id, {
                                contratos: e.target.checked
                                  ? [...version.contratos, c]
                                  : version.contratos.filter((x) => x !== c),
                              })
                            }
                          />{' '}
                          {TIPO_CONTRATO_LABELS[c] ?? c}
                        </label>
                      );
                    })}
                    {versiones.length > 1 && !soloConsulta && (
                      <button className="btn-link" onClick={quitarVersion}>
                        Quitar esta versión
                      </button>
                    )}
                  </fieldset>
                </div>

                <h3 className="aviso-subtitulo">Destinatarios</h3>
                {conCambios.length > 0 && (
                  <div className="formulario-aviso aviso-cambios">
                    <strong>
                      {plural(conCambios.length, 'profesor', 'profesores')} con cambios sin avisar
                    </strong>
                    <span>El horario en la malla ya no es el que se envió.</span>
                    <button
                      className="btn-link"
                      onClick={() => {
                        if (!soloCambios) setDdlAbierto(true);
                        setSoloCambios((v) => !v);
                      }}
                    >
                      {soloCambios ? 'Ver a todos' : 'Ver solo estos'}
                    </button>
                    {!soloConsulta && conCambios.some(sePuedeEnviar) && (
                      <button className="btn-link" onClick={() => marcarVarios(conCambios.filter(sePuedeEnviar), true)}>
                        {conCambios.filter(sePuedeEnviar).length === 1
                          ? 'Seleccionarlo'
                          : `Seleccionar a los ${conCambios.filter(sePuedeEnviar).length}`}
                      </button>
                    )}
                  </div>
                )}
                <Desplegable
                  resumen={
                    soloConsulta
                      ? `Profesores de esta versión: ${profesoresVersion.length}`
                      : `Seleccionados: ${elegidosVersion} de ${profesoresVersion.length}`
                  }
                  abierto={ddlAbierto}
                  onCambiar={setDdlAbierto}
                >
                      <div className="aviso-lista-herramientas">
                        <input
                          type="search"
                          placeholder="Buscar por nombre o correo"
                          aria-label="Buscar profesor"
                          value={buscar}
                          onChange={(e) => setBuscar(e.target.value)}
                        />
                        {!soloConsulta && (
                          <>
                            <button
                              className="btn-link"
                              onClick={() => marcarVarios(filas.filter((p) => sePuedeEnviar(p) && p.estado !== 'avisado'), true)}
                            >
                              Todos
                            </button>
                            <button className="btn-link" onClick={() => marcarVarios(filas, false)}>
                              Ninguno
                            </button>
                          </>
                        )}
                      </div>
                      {!soloConsulta && (
                        <p className="formulario-nota">
                          "Todos" no incluye a quienes ya recibieron este mismo horario: para reenviárselo, márcalos uno
                          por uno.
                        </p>
                      )}
                      <ListaProfesores
                        soloConsulta={soloConsulta}
                        filas={filas}
                        seleccion={seleccion}
                        abiertos={abiertos}
                        ejemploId={ejemploId}
                        onAlternar={alternar}
                        onAbrir={(id) =>
                          setAbiertos((a) => {
                            const n = new Set(a);
                            if (n.has(id)) n.delete(id);
                            else n.add(id);
                            return n;
                          })
                        }
                        onEjemplo={(id) => {
                          setEjemploId(id);
                          // El ejemplo está debajo del desplegable: hay que dejarlo a la vista.
                          setDdlAbierto(false);
                          setPestanaRedaccion('ejemplo');
                        }}
                        onMarcar={marcarAvisado}
                      />
                </Desplegable>

                <div className="aviso-pestanas aviso-pestanas-redaccion" role="tablist">
                  {[
                    ['correo', 'Correo'],
                    ['ejemplo', 'Ejemplo de envío'],
                  ].map(([id, texto]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={pestanaRedaccion === id}
                      className={`aviso-pestana aviso-subpestana ${pestanaRedaccion === id ? 'aviso-pestana-activa' : ''}`}
                      onClick={() => setPestanaRedaccion(id)}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
                {/* Al volver a Correo, el editor se pinta otra vez con lo último escrito. */}
                {pestanaRedaccion === 'correo' && (
                  <div className="aviso-columna">
                    <div>
                      <label htmlFor="aviso-asunto">Asunto</label>
                      <input
                        id="aviso-asunto"
                        disabled={soloConsulta}
                        maxLength={200}
                        value={version.asunto}
                        onChange={(e) => cambiarVersion(version.id, { asunto: e.target.value })}
                      />
                    </div>
                    <EditorCorreo
                      key={`${version.id}-${reinicioEditor}`}
                      valor={version.cuerpo}
                      campos={datos.campos}
                      onCambio={alCambiarCuerpo}
                      soloLectura={soloConsulta}
                    />
                    {!soloConsulta && (
                      <div>
                        <button className="btn-link" onClick={restaurarTexto}>
                          Restaurar el texto original
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {pestanaRedaccion === 'ejemplo' && (
                  <div className="aviso-columna">
                    <label htmlFor="aviso-ejemplo">Ejemplo de envío para</label>
                    <select id="aviso-ejemplo" value={ejemploId ?? ''} onChange={(e) => setEjemploId(Number(e.target.value))}>
                      {profesores.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>
                    <EjemploEnvio previa={previa} />
                    {ejemplo?.envio_id && (
                      <div>
                        <button className="btn-link" onClick={() => verEnvio(ejemplo)}>
                          Ver lo que recibió la última vez
                        </button>
                      </div>
                    )}
                    {!soloConsulta && (
                      <>
                        <div className="aviso-prueba">
                          <div>
                            <label htmlFor="aviso-prueba-correo">Mandar este ejemplo como prueba a</label>
                            <input
                              id="aviso-prueba-correo"
                              type="email"
                              value={correoPrueba}
                              onChange={(e) => setCorreoPrueba(e.target.value)}
                            />
                          </div>
                          <button
                            className="btn-secondary"
                            onClick={mandarPrueba}
                            disabled={bloqueado || !ejemploId || !correoPrueba.trim() || Boolean(previa?.motivo)}
                          >
                            {ocupado === 'prueba' ? 'Enviando…' : 'Enviar prueba'}
                          </button>
                        </div>
                        <p className="formulario-nota">
                          La prueba no le llega al profesor, no lleva copias y no cuenta como enviada.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="formulario-seccion">
            <h2>Vista en el perfil de los profesores</h2>
            <p className="formulario-nota">
              {datos.perfil.activo
                ? 'Activa: los profesores seleccionados ven en su perfil lo último que se les avisó.'
                : 'Apagada: ningún profesor ve su horario en su perfil.'}{' '}
              {!soloConsulta && 'Se activa para todos los profesores seleccionados a la vez, y de inicio están todos.'}
            </p>
            <label>Quién la ve</label>
            <Desplegable
              resumen={`Seleccionados: ${conVista.length} de ${profesores.length}`}
              abierto={ddlPerfilAbierto}
              onCambiar={setDdlPerfilAbierto}
            >
              <div className="aviso-lista-herramientas">
                <input
                  type="search"
                  placeholder="Buscar por nombre"
                  aria-label="Buscar profesor"
                  value={buscarPerfil}
                  onChange={(e) => setBuscarPerfil(e.target.value)}
                />
                {!soloConsulta && (
                  <>
                    <button className="btn-link" onClick={() => marcarPerfil(filasPerfil, true)}>
                      Todos
                    </button>
                    <button className="btn-link" onClick={() => marcarPerfil(filasPerfil, false)}>
                      Ninguno
                    </button>
                  </>
                )}
              </div>
              <div className="aviso-lista">
                {filasPerfil.map((p) => (
                  <label key={p.id} className="aviso-perfil-fila">
                    <input
                      type="checkbox"
                      checked={!perfilFuera.has(p.id)}
                      disabled={soloConsulta}
                      onChange={() => alternarPerfil(p.id)}
                    />
                    <span>{p.nombre}</span>
                    <span className="formulario-nota">
                      {TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato}
                      {p.estado === 'sin_avisar' && ' · aún sin aviso'}
                    </span>
                  </label>
                ))}
              </div>
            </Desplegable>
            {perfilFuera.size > 0 && (
              <p className="formulario-nota">
                A quienes desmarques no les aparecerá en su correo la frase de que pueden consultar su horario en el
                perfil. Si ya recibieron el aviso, ese correo no cambia.
              </p>
            )}
            {!soloConsulta && (
              <div className="aviso-perfil">
                <button
                  className={datos.perfil.activo ? 'btn-secondary' : 'btn-primary'}
                  disabled={bloqueado}
                  onClick={() => cambiarPerfil(!datos.perfil.activo).catch((err) => setError(err.message))}
                >
                  {datos.perfil.activo ? 'Desactivar la vista' : 'Activar la vista'}
                </button>
                {datos.perfil.activo && (
                  <button
                    className="btn-primary"
                    disabled={bloqueado || !seleccionPerfilCambio}
                    onClick={() => cambiarPerfil(true).catch((err) => setError(err.message))}
                  >
                    Guardar selección
                  </button>
                )}
              </div>
            )}
          </section>

          {envio && <ProgresoEnvio envio={envio} onDetener={() => { detener.current = true; }} onReintentar={() => ejecutarEnvio(envio.errores.map((e) => e.profesor))} />}
          {envio && !envio.enCurso && envio.ok > 0 && !datos.perfil.activo && (
            <p className="formulario-aviso">
              Se enviaron correos que dicen que pueden ver su horario en su perfil, pero la vista está apagada.{' '}
              <button className="btn-link" onClick={() => cambiarPerfil(true).catch((err) => setError(err.message))}>
                Activarla ahora
              </button>
            </p>
          )}

          <div className="aviso-barra">
            <div className="aviso-barra-avisos">
              {error && (
                <p className="formulario-error" role="alert">
                  {error}
                </p>
              )}
              {mensaje && (
                <p className="formulario-mensaje" role="status">
                  {mensaje}
                </p>
              )}
            </div>
            {!soloConsulta && (
              <div className="aviso-barra-botones">
                {sucio && <span className="formulario-nota">Cambios sin guardar</span>}
                <button className="btn-secondary" onClick={guardarBorrador} disabled={bloqueado}>
                  {ocupado === 'borrador' ? 'Guardando…' : 'Guardar borrador'}
                </button>
                <button className="btn-primary" onClick={pedirConfirmacion} disabled={bloqueado || elegidos.length === 0}>
                  Enviar a {plural(elegidos.length, 'profesor', 'profesores')}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {confirmacion && (
        <Modal titulo="Confirmar el envío" onCerrar={() => setConfirmacion(null)}>
          <p>
            Se mandará un correo a <strong>{plural(elegidos.length, 'profesor', 'profesores')}</strong>:
          </p>
          <ul>
            {versiones.map((v) => {
              const n = elegidos.filter((p) => versionDe(p)?.id === v.id).length;
              return n > 0 ? (
                <li key={v.id}>
                  {v.nombre}: {n}
                </li>
              ) : null;
            })}
          </ul>
          {elegidos.some((p) => p.estado === 'cambio') && (
            <p>{plural(elegidos.filter((p) => p.estado === 'cambio').length, 'correo sale', 'correos salen')} como actualización del aviso anterior.</p>
          )}
          {elegidos.some((p) => p.estado === 'avisado') && (
            <p>{plural(elegidos.filter((p) => p.estado === 'avisado').length, 'profesor ya recibió', 'profesores ya recibieron')} este mismo horario y lo recibirá de nuevo.</p>
          )}
          {borrador.copias.trim() && (
            <p>
              Copia en cada correo: {borrador.copias}.
            </p>
          )}
          <p>El correo sale de {datos.remitente.correo}.</p>
          {!datos.perfil.activo && (
            <label className="aviso-confirmar-perfil">
              <input
                type="checkbox"
                checked={confirmacion.activarPerfil}
                onChange={(e) => setConfirmacion({ activarPerfil: e.target.checked })}
              />{' '}
              Activar también la vista en el perfil
            </label>
          )}
          <div className="aviso-modal-botones">
            <button className="btn-secondary" onClick={() => setConfirmacion(null)}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={confirmarEnvio}>
              Enviar
            </button>
          </div>
        </Modal>
      )}

      {modal?.tipo === 'envio' && (
        <Modal titulo={`Lo que recibió ${modal.profesor.nombre}`} onCerrar={() => setModal(null)} ancho>
          <Encabezados
            filas={[
              ['Enviado', cuando(modal.envio.creado_at)],
              ['Para', modal.envio.correo],
              ['Cc', modal.envio.copias],
              ['Responder a', modal.envio.responder_a],
              ['Asunto', modal.envio.asunto],
            ]}
          />
          <CuerpoCorreo html={modal.envio.html} />
        </Modal>
      )}

    </div>
  );
}

/** Un botón con el resumen y, al abrirlo, un panel. Se cierra al hacer clic fuera o con Esc. */
function Desplegable({ resumen, abierto, onCambiar, children }) {
  const raiz = useRef(null);
  useEffect(() => {
    if (!abierto) return undefined;
    const alClic = (e) => {
      if (!raiz.current?.contains(e.target)) onCambiar(false);
    };
    const alTecla = (e) => {
      if (e.key === 'Escape') onCambiar(false);
    };
    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alTecla);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alTecla);
    };
  }, [abierto, onCambiar]);

  return (
    <div className="aviso-ddl" ref={raiz}>
      <button
        type="button"
        className="aviso-ddl-boton"
        aria-haspopup="true"
        aria-expanded={abierto}
        onClick={() => onCambiar(!abierto)}
      >
        <span>{resumen}</span>
        <span aria-hidden="true">{abierto ? '▴' : '▾'}</span>
      </button>
      {abierto && <div className="aviso-ddl-panel">{children}</div>}
    </div>
  );
}

function CampoFecha({ etiqueta, valor, onCambio }) {
  return (
    <label className="aviso-fecha">
      {etiqueta}
      <input type="date" value={valor} onChange={(e) => onCambio(e.target.value)} />
      {valor && <span className="aviso-fecha-dia">{diaCompleto(valor)}</span>}
    </label>
  );
}

const ESTADOS = {
  sin_avisar: ['Sin avisar', 'badge-no_iniciado'],
  avisado: ['Avisado', 'badge-enviado'],
  cambio: ['Cambió desde el aviso', 'badge-borrador'],
  sin_clases: ['Ya no tiene clases asignadas', 'badge-borrador'],
};

function ListaProfesores({ soloConsulta, filas, seleccion, abiertos, ejemploId, onAlternar, onAbrir, onEjemplo, onMarcar }) {
  if (filas.length === 0) return <p className="formulario-nota">No hay profesores que mostrar.</p>;
  return (
    <div className="aviso-lista">
      {filas.map((p) => {
        const [estado, clase] = ESTADOS[p.estado];
        const motivo = !p.correo ? 'Sin correo' : p.n_clases === 0 ? 'Sin clases' : '';
        const cambio = conCambio(p);
        return (
          <div key={p.id} className={`aviso-fila ${p.id === ejemploId ? 'aviso-fila-ejemplo' : ''}`}>
            <input
              type="checkbox"
              aria-label={`Enviar a ${p.nombre}`}
              checked={seleccion.has(p.id) && !motivo}
              disabled={Boolean(motivo) || soloConsulta}
              onChange={() => onAlternar(p.id)}
            />
            <div className="aviso-fila-datos">
              <strong>{p.nombre}</strong>
              <span>
                {p.correo ?? 'Sin correo registrado'} · {TIPO_CONTRATO_LABELS[p.tipo_contrato] ?? p.tipo_contrato} ·{' '}
                {plural(p.n_clases, 'clase', 'clases')}
                {p.sin_horario > 0 && ` (${p.sin_horario} sin horario)`}
              </span>
            </div>
            <div className="aviso-fila-estado">
              <span className={`badge ${clase}`}>{estado}</span>
              {p.avisado_at && (
                <span className="formulario-nota">
                  {p.marcado ? 'Marcado' : 'Enviado'} {cuando(p.avisado_at)}
                </span>
              )}
              {p.fallo && <span className="formulario-nota nota-falta">Falló el último intento</span>}
              {motivo && <span className="formulario-nota">{motivo}</span>}
            </div>
            <div className="aviso-fila-acciones">
              <button className="btn-link" onClick={() => onEjemplo(p.id)}>
                Ver ejemplo
              </button>
              {cambio && (
                <>
                  <button className="btn-link" aria-expanded={abiertos.has(p.id)} onClick={() => onAbrir(p.id)}>
                    Antes / Ahora
                  </button>
                  {!soloConsulta && (
                    <button className="btn-link" onClick={() => onMarcar(p)}>
                      Marcar como avisado
                    </button>
                  )}
                </>
              )}
            </div>
            {cambio && abiertos.has(p.id) && (
              <div className="aviso-comparacion">
                <ListaCorta titulo="Antes" clases={p.antes} />
                <ListaCorta titulo="Ahora" clases={p.ahora} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ListaCorta({ titulo, clases }) {
  return (
    <div>
      <strong>{titulo}</strong>
      {clases?.length ? (
        <ul>
          {clases.map((c) => (
            <li key={c.etiqueta}>
              {c.etiqueta} {c.materia}: {c.sesiones.length ? textoSesiones(c.sesiones).join(' · ') : 'sin horario'}
            </li>
          ))}
        </ul>
      ) : (
        <p className="formulario-nota">Sin clases</p>
      )}
    </div>
  );
}

function EjemploEnvio({ previa }) {
  if (!previa) return <p className="formulario-nota">Armando el ejemplo…</p>;
  if (previa.motivo) return <p className="formulario-aviso">{previa.motivo}</p>;
  return (
    <div className="aviso-ejemplo">
      <Encabezados
        filas={[
          ['Versión', previa.version],
          ['De', previa.de],
          ['Para', previa.para],
          ['Cc', previa.cc.join(', ')],
          ['Responder a', previa.responder_a],
          ['Asunto', previa.asunto],
        ]}
      />
      {previa.sin_lista && <p className="formulario-aviso">Este texto no incluye {CAMPO_LISTA}.</p>}
      {previa.faltan.length > 0 && (
        <p className="formulario-aviso">Falta capturar: {previa.faltan.join(', ')}. Aquí se ve el campo sin llenar.</p>
      )}
      <CuerpoCorreo html={previa.html} />
    </div>
  );
}

function Encabezados({ filas }) {
  return (
    <dl className="aviso-encabezados">
      {filas
        .filter(([, valor]) => valor)
        .map(([etiqueta, valor]) => (
          <div key={etiqueta}>
            <dt>{etiqueta}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
    </dl>
  );
}

// En un iframe sin scripts: el correo trae sus propios estilos, y así no se mezclan
// con los de la app. allow-same-origin es solo para poder medir su altura.
function CuerpoCorreo({ html }) {
  const [alto, setAlto] = useState(400);
  return (
    <iframe
      className="aviso-cuerpo-correo"
      title="Cuerpo del correo"
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ height: alto }}
      onLoad={(e) => {
        const doc = e.target.contentDocument;
        if (doc?.documentElement) setAlto(doc.documentElement.scrollHeight + 8);
      }}
    />
  );
}

function ProgresoEnvio({ envio, onDetener, onReintentar }) {
  return (
    <section className="formulario-seccion" aria-live="polite">
      <h2>{envio.enCurso ? 'Enviando…' : envio.detenido ? 'Envío detenido' : 'Envío terminado'}</h2>
      <progress max={envio.total} value={envio.hechos} className="aviso-progreso" />
      <p className="formulario-nota">
        {envio.hechos} de {envio.total} · {plural(envio.ok, 'enviado', 'enviados')}
        {envio.errores.length > 0 && ` · ${plural(envio.errores.length, 'error', 'errores')}`}
        {envio.enCurso && ' · No cierres esta pantalla.'}
      </p>
      {envio.enCurso && (
        <div>
          <button className="btn-secondary" onClick={onDetener}>
            Detener
          </button>
        </div>
      )}
      {envio.errores.length > 0 && (
        <>
          <ul className="aviso-errores">
            {envio.errores.map((e) => (
              <li key={e.profesor.id}>
                {e.profesor.nombre}: {e.mensaje}
              </li>
            ))}
          </ul>
          {!envio.enCurso && (
            <div>
              <button className="btn-secondary" onClick={onReintentar}>
                Reintentar
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Modal({ titulo, onCerrar, ancho, children }) {
  return (
    <div className="aviso-modal-fondo">
      <div className={`aviso-modal ${ancho ? 'aviso-modal-ancho' : ''}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <header>
          <strong>{titulo}</strong>
          <button className="btn-link" onClick={onCerrar}>
            Cerrar
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
