import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { guardarDemanda, leerDemanda } from '../lib/api';
import { etiquetaSemestre } from '../lib/semestre';
import { departamentoInicial } from '../lib/roles';
import { filasDesdePdf, filasDesdeTexto, semestreDeNombreArchivo } from '../lib/parserDemanda';
import SelectorDepartamento from '../components/SelectorDepartamento';

// Carga de la estimación de demanda que manda Servicios Escolares cada
// semestre (un PDF por departamento). Se lee en el navegador, se enseña una
// vista previa donde se puede corregir cualquier fila, y solo al confirmar se
// guarda (api/demanda.php, una transacción que reemplaza la estimación
// anterior del departamento/semestre).
//
// Con soloConsulta es el reporte "Demanda del semestre": la misma tabla, sin
// nada que subir.
//
// Desde 2026-10-02 se pueden agregar a mano materias que no vienen en el
// reporte, en la misma vista previa (después de subir el PDF, o partiendo de
// la estimación ya guardada). El API no distingue: es una fila más con las
// columnas del reporte en 0.

/**
 * pdf.js se carga solo cuando alguien sube un PDF (pesa ~1 MB). Se usa la
 * build legacy, que funciona en navegadores más viejos, y su worker se importa
 * como módulo normal: así pdf.js corre en el hilo principal y no depende de
 * que el servidor del ITAM sirva archivos .mjs con el tipo correcto, que un
 * worker de módulo exige. Para PDFs de 1-2 páginas no se nota.
 */
async function abrirPdf(archivo) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);
  globalThis.pdfjsWorker = worker;
  return pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()) }).promise;
}

const NOMBRE_TIPO = { primavera: 'Primavera', verano: 'Verano', otono: 'Otoño' };
const nombreSemestre = (s) => (s ? `${NOMBRE_TIPO[s.tipo] ?? s.tipo} ${s.anio}` : '');

const COLUMNAS = [
  ['alumnos_total', 'A.T.'],
  ['nuevo_ingreso', 'N.I.'],
  ['demanda_ajustada', 'Suma'],
  ['grupos_periodo_anterior', 'Anterior'],
  ['grupos_sugeridos', 'Sug'],
];

// Una materia que no viene en el reporte y se agrega a mano (2026-10-02):
// Servicios Escolares no la estimó, así que las columnas del reporte van en 0
// y lo único que se captura son los grupos sugeridos.
const NUEVA_VACIA = { clave: '', nombre: '', creditos: '', grupos_sugeridos: 1 };
const AVISO_MANUAL = 'Agregada a mano: no viene en el reporte de Servicios Escolares.';

function filaManual({ clave, nombre, creditos, grupos_sugeridos }) {
  return {
    clave,
    nombre,
    creditos: Number(creditos),
    alumnos_total: 0,
    nuevo_ingreso: 0,
    pct_baja: 0,
    pct_reprobacion: 0,
    con_prerrequisito: 0,
    demanda_ajustada: 0,
    capacidad_planeacion: 0,
    grupos_periodo_anterior: 0,
    grupos_sugeridos: Number(grupos_sugeridos),
    avisos: [AVISO_MANUAL],
    incluir: true,
  };
}

export default function CargaDemanda({ onVolver, soloConsulta = false }) {
  const { token, profesor, departamentos, semestre } = useAuth();

  const [departamentoId, setDepartamentoId] = useState(() =>
    departamentoInicial(profesor, departamentos),
  );
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  // Vista previa: lo leído del PDF o del texto pegado, todavía sin guardar.
  const [previa, setPrevia] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [modoPegar, setModoPegar] = useState(false);
  const [textoPegado, setTextoPegado] = useState('');
  const [nueva, setNueva] = useState(NUEVA_VACIA);
  const [errorNueva, setErrorNueva] = useState('');

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError('');
      try {
        if (!semestre) throw new Error('No hay ningún semestre activo.');
        const r = await leerDemanda(token, semestre.id, departamentoId);
        if (!cancelado) setDatos(r);
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

  const catalogo = useMemo(
    () => new Map((datos?.materias ?? []).map((m) => [m.clave, m])),
    [datos],
  );
  const nombreDepto = departamentos.find((d) => d.id === departamentoId)?.nombre ?? '';
  // El prefijo de clave del departamento (MAT, ACT, EST), sacado de su catálogo.
  const prefijoDepto = datos?.materias[0]?.clave.split('-')[0] ?? null;

  /** Resultado del parser -> filas de vista previa, comparadas contra el catálogo. */
  function prepararPrevia({ filas, ignorados, semestre: semestrePdf }, origen, nombreArchivo, sinReporte = false) {
    const avisos = [];
    setNueva(NUEVA_VACIA);
    setErrorNueva('');
    const detectado = semestrePdf ?? semestreDeNombreArchivo(nombreArchivo);
    if (detectado && (detectado.tipo !== semestre.tipo || detectado.anio !== semestre.anio)) {
      avisos.push(
        `El archivo parece ser de ${nombreSemestre(detectado)}, pero el semestre activo es ${etiquetaSemestre(semestre)}. Revisa que sea el reporte correcto antes de guardar.`,
      );
    }
    for (const linea of ignorados) avisos.push(`No se pudo leer este renglón: ${linea}`);
    if (filas.length === 0 && !sinReporte) {
      avisos.push('No se encontró ninguna materia. ¿Es el reporte de "Estimación de la demanda"?');
    }
    const otrosPrefijos = prefijoDepto
      ? filas.filter((f) => f.clave.split('-')[0] !== prefijoDepto)
      : [];
    if (otrosPrefijos.length > 0) {
      avisos.push(
        `Hay ${otrosPrefijos.length} claves de otro departamento (${otrosPrefijos[0].clave}…). ¿Elegiste el departamento correcto?`,
      );
    }
    setPrevia({
      origen,
      avisos,
      filas: filas.map((f) => ({ ...f, incluir: true })),
    });
    setMensaje('');
    setError('');
  }

  async function subirPdf(e) {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setLeyendo(true);
    setError('');
    try {
      const doc = await abrirPdf(archivo);
      prepararPrevia(await filasDesdePdf(doc), archivo.name, archivo.name);
    } catch (err) {
      setError(
        `No se pudo leer el PDF (${err.message}). Puedes copiar la tabla y usar "Pegar la tabla" en su lugar.`,
      );
    } finally {
      setLeyendo(false);
    }
  }

  function leerPegado() {
    prepararPrevia(filasDesdeTexto(textoPegado), 'texto pegado', '');
  }

  /**
   * Abre la vista previa con lo que ya está guardado, para agregarle materias
   * sin volver a subir el PDF. Hace falta partir de lo guardado porque el
   * guardado REEMPLAZA la estimación completa (api/demanda.php).
   */
  function editarCargada() {
    const filas = (datos?.filas ?? []).map((f) => ({
      clave: f.clave,
      nombre: f.nombre,
      creditos: Number(f.creditos),
      alumnos_total: Number(f.alumnos_total),
      nuevo_ingreso: Number(f.nuevo_ingreso),
      pct_baja: Number(f.pct_baja ?? 0),
      pct_reprobacion: Number(f.pct_reprobacion ?? 0),
      con_prerrequisito: Number(f.con_prerrequisito),
      demanda_ajustada: Number(f.demanda_ajustada ?? 0),
      capacidad_planeacion: Number(f.capacidad_planeacion ?? 0),
      grupos_periodo_anterior: Number(f.grupos_periodo_anterior),
      grupos_sugeridos: Number(f.grupos_sugeridos),
      avisos: [],
    }));
    prepararPrevia(
      { filas, ignorados: [], semestre: null },
      filas.length > 0 ? 'la estimación ya guardada' : 'captura a mano',
      '',
      true,
    );
  }

  // Lo que se escribe en "clave" se completa con el catálogo: si la materia ya
  // existe, su nombre y créditos salen de ahí.
  function cambiarNueva(campo, valor) {
    setErrorNueva('');
    setNueva((n) => {
      const sig = { ...n, [campo]: valor };
      if (campo === 'clave') {
        const enCatalogo = catalogo.get(valor.trim().toUpperCase());
        if (enCatalogo) {
          sig.nombre = enCatalogo.nombre;
          sig.creditos = enCatalogo.creditos;
        }
      }
      return sig;
    });
  }

  function agregarMateria(e) {
    e.preventDefault();
    const clave = nueva.clave.trim().toUpperCase();
    const patron = prefijoDepto ? new RegExp(`^${prefijoDepto}-\\d{4,6}$`) : /^[A-Z]{2,5}-\d{4,6}$/;
    if (!patron.test(clave)) {
      setErrorNueva(`La clave debe ser como ${prefijoDepto ?? 'MAT'}-12345.`);
      return;
    }
    const yaEsta = previa.filas.find((f) => f.clave === clave);
    if (yaEsta) {
      if (!yaEsta.incluir) {
        editarFila(clave, { incluir: true });
        setNueva(NUEVA_VACIA);
        return;
      }
      setErrorNueva(`${clave} ya está en la tabla: edítala ahí.`);
      return;
    }
    const enCatalogo = catalogo.get(clave);
    const nombre = nueva.nombre.trim() || enCatalogo?.nombre || '';
    if (!nombre) {
      setErrorNueva('Escribe el nombre: es una materia nueva en el catálogo.');
      return;
    }
    if (!(Number(nueva.creditos) >= 1)) {
      setErrorNueva('Los créditos deben ser mayores que 0.');
      return;
    }
    if (!(Number(nueva.grupos_sugeridos) >= 0)) {
      setErrorNueva('Los grupos sugeridos no pueden ser negativos.');
      return;
    }
    setPrevia((p) => ({
      ...p,
      filas: [...p.filas, filaManual({ ...nueva, clave, nombre })],
    }));
    setNueva(NUEVA_VACIA);
  }

  // Para sugerir en "clave" las materias del catálogo que no están en la tabla.
  const sugerenciasNueva = previa
    ? (datos?.materias ?? []).filter((m) => !previa.filas.some((f) => f.clave === m.clave))
    : [];

  const editarFila = (clave, cambios) =>
    setPrevia((p) => ({ ...p, filas: p.filas.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)) }));

  function estadoDe(f) {
    const actual = catalogo.get(f.clave);
    if (!actual) return 'nueva';
    if ((f.nombre && f.nombre !== actual.nombre) || Number(f.creditos) !== Number(actual.creditos)) {
      return 'cambia';
    }
    return 'igual';
  }

  async function guardar() {
    const incluidas = previa.filas.filter((f) => f.incluir);
    const sinNombre = incluidas.filter((f) => !f.nombre && estadoDe(f) === 'nueva');
    if (sinNombre.length > 0) {
      setError(`Escribe el nombre de ${sinNombre.map((f) => f.clave).join(', ')}: son materias nuevas.`);
      return;
    }
    const quitadas = (datos.filas ?? []).filter((d) => !incluidas.some((f) => f.clave === d.clave));
    const pregunta =
      `¿Guardar la estimación de ${incluidas.length} materias para ${etiquetaSemestre(semestre)}?` +
      (quitadas.length > 0
        ? ` Reemplaza a la que ya estaba: ${quitadas.length} materias que no vienen en este reporte se quedan sin demanda.`
        : '');
    if (!window.confirm(pregunta)) return;

    setGuardando(true);
    setError('');
    let r;
    try {
      r = await guardarDemanda(
        token,
        semestre.id,
        departamentoId,
        // Solo lo que guarda el API: sin los campos de la vista previa
        // (incluir, avisos) ni Hrs, que es derivada.
        incluidas.map((f) => ({
          clave: f.clave,
          nombre: f.nombre,
          creditos: f.creditos,
          alumnos_total: f.alumnos_total,
          nuevo_ingreso: f.nuevo_ingreso,
          pct_baja: f.pct_baja,
          pct_reprobacion: f.pct_reprobacion,
          con_prerrequisito: f.con_prerrequisito,
          demanda_ajustada: f.demanda_ajustada,
          capacidad_planeacion: f.capacidad_planeacion,
          grupos_periodo_anterior: f.grupos_periodo_anterior,
          grupos_sugeridos: f.grupos_sugeridos,
        })),
      );
    } catch (err) {
      setError(err.message);
      setGuardando(false);
      return;
    }

    // A partir de aquí la estimación YA está guardada. Si la recarga falla, eso
    // no puede decir "no se guardó": la vista previa ya se cerró y reintentar
    // no tendría de dónde.
    try {
      setMensaje(
        `Guardado: ${r.demanda} materias con demanda` +
          (r.nuevas ? `, ${r.nuevas} materias nuevas en el catálogo` : '') +
          (r.actualizadas ? `, ${r.actualizadas} con nombre o créditos actualizados` : '') +
          (r.eliminadas ? `, ${r.eliminadas} ya no tienen demanda` : '') +
          '.',
      );
      setPrevia(null);
      setDatos(await leerDemanda(token, semestre.id, departamentoId));
    } catch (err) {
      setError(`La estimación sí se guardó, pero no se pudo recargar la tabla (${err.message}). Vuelve a abrir esta vista para verla.`);
    } finally {
      setGuardando(false);
    }
  }

  const puedeSubir = !soloConsulta && datos?.semestre_activo;
  const totalSugeridos = (datos?.filas ?? []).reduce((n, f) => n + Number(f.grupos_sugeridos), 0);

  return (
    <div className="formulario-screen demanda-screen">
      <header className="formulario-header">
        <button
          className="btn-link"
          onClick={() => {
            if (previa && !window.confirm('Tienes una vista previa sin guardar. ¿Salir de todos modos?')) return;
            onVolver();
          }}
        >
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>{soloConsulta ? 'Demanda del semestre' : 'Cargar la estimación de demanda'}</strong>
            <span>{etiquetaSemestre(semestre)}</span>
          </div>
        </div>
      </header>

      <SelectorDepartamento
        valor={departamentoId}
        disabled={cargando || Boolean(previa)}
        onCambiar={setDepartamentoId}
      />

      {error && <p className="formulario-error">{error}</p>}
      {mensaje && <p className="formulario-mensaje">{mensaje}</p>}

      {puedeSubir && !previa && (
        <section className="formulario-seccion">
          <h2>Subir el reporte de Servicios Escolares</h2>
          <p className="formulario-nota">
            El PDF de "Estimación de la demanda" de {nombreDepto || 'tu departamento'} (por ejemplo{' '}
            <em>Mat 202603.pdf</em>). Antes de guardar vas a ver la tabla leída y podrás corregirla.
          </p>
          <label className="btn-primary demanda-subir">
            {leyendo ? 'Leyendo el PDF…' : 'Elegir el PDF'}
            <input type="file" accept="application/pdf,.pdf" hidden disabled={leyendo} onChange={subirPdf} />
          </label>
          <details open={modoPegar} onToggle={(e) => setModoPegar(e.currentTarget.open)}>
            <summary className="formulario-nota">¿El PDF no se lee bien? Pegar la tabla</summary>
            <p className="formulario-nota">
              Copia las filas de la tabla (desde Excel o desde el visor de PDF) y pégalas aquí, en el
              mismo orden de columnas del reporte.
            </p>
            <textarea
              value={textoPegado}
              onChange={(e) => setTextoPegado(e.target.value)}
              placeholder="MAT-12200  Cálculo Univariado  234  236  25.67%  …"
              rows={6}
            />
            <div>
              <button className="btn-secondary" disabled={!textoPegado.trim()} onClick={leerPegado}>
                Leer la tabla pegada
              </button>
            </div>
          </details>
          <p className="formulario-nota">
            ¿Falta una materia que no viene en el reporte?{' '}
            <button type="button" className="btn-link" disabled={cargando} onClick={editarCargada}>
              {datos?.filas.length
                ? 'Agregarla a la estimación ya guardada'
                : 'Capturar materias a mano, sin PDF'}
            </button>
            {' '}— o súbela junto con el PDF: en la vista previa también puedes agregar materias.
          </p>
        </section>
      )}

      {!soloConsulta && datos && !datos.semestre_activo && (
        <p className="formulario-aviso">Este semestre ya está cerrado: su demanda solo se puede consultar.</p>
      )}

      {previa && (
        <section className="formulario-seccion">
          <h2>Vista previa — todavía no se ha guardado nada</h2>
          <p className="formulario-nota">
            Leído de <strong>{previa.origen}</strong>: {previa.filas.length} materias. Corrige lo que haga
            falta y quita las filas que no quieras cargar.
          </p>
          {previa.avisos.map((a) => (
            <p className="formulario-aviso" key={a}>
              {a}
            </p>
          ))}
          <div className="demanda-leyenda">
            <span className="demanda-estado nueva">Nueva</span> se agrega al catálogo (oculta en el
            formulario, por revisar) ·{' '}
            <span className="demanda-estado cambia">Cambia</span> nombre o créditos distintos al catálogo ·{' '}
            <span className="demanda-estado igual">Igual</span>
          </div>
          <div className="disponibilidad-grid-wrap">
            <table className="panel-tabla demanda-tabla">
              <thead>
                <tr>
                  <th>Cargar</th>
                  <th></th>
                  <th>Clave</th>
                  <th>Materia</th>
                  <th>Créditos</th>
                  {COLUMNAS.map(([, etiqueta]) => (
                    <th key={etiqueta}>{etiqueta}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previa.filas.map((f) => {
                  const estado = estadoDe(f);
                  const actual = catalogo.get(f.clave);
                  return (
                    <tr key={f.clave} className={f.incluir ? '' : 'fila-descartada'}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Cargar ${f.clave}`}
                          checked={f.incluir}
                          onChange={(e) => editarFila(f.clave, { incluir: e.target.checked })}
                        />
                      </td>
                      <td>
                        <span className={`demanda-estado ${estado}`}>
                          {{ nueva: 'Nueva', cambia: 'Cambia', igual: 'Igual' }[estado]}
                        </span>
                      </td>
                      <td className="materia-clave">{f.clave}</td>
                      <td>
                        <input
                          className="input-inline"
                          value={f.nombre}
                          placeholder={actual?.nombre ?? 'Escribe el nombre'}
                          aria-label={`Nombre de ${f.clave}`}
                          onChange={(e) => editarFila(f.clave, { nombre: e.target.value })}
                        />
                        {estado === 'cambia' && f.nombre && f.nombre !== actual.nombre && (
                          <span className="demanda-antes">antes: {actual.nombre}</span>
                        )}
                        {actual && !Number(actual.activa) && (
                          <span className="demanda-antes">inactiva en el catálogo</span>
                        )}
                        {f.avisos.map((a) => (
                          <span className={a === AVISO_MANUAL ? 'demanda-antes' : 'demanda-aviso'} key={a}>
                            {a}
                          </span>
                        ))}
                      </td>
                      <td>
                        <input
                          className="input-num"
                          type="number"
                          min={1}
                          value={f.creditos}
                          aria-label={`Créditos de ${f.clave}`}
                          onChange={(e) => editarFila(f.clave, { creditos: Number(e.target.value) })}
                        />
                        {actual && Number(actual.creditos) !== Number(f.creditos) && (
                          <span className="demanda-antes">antes: {actual.creditos}</span>
                        )}
                      </td>
                      {COLUMNAS.map(([campo]) => (
                        <td key={campo} className={campo === 'grupos_sugeridos' && Number(f[campo]) === 0 ? 'sug-cero' : ''}>
                          {campo === 'grupos_sugeridos' ? (
                            <input
                              className="input-num"
                              type="number"
                              min={0}
                              value={f[campo]}
                              aria-label={`Grupos sugeridos de ${f.clave}`}
                              onChange={(e) => editarFila(f.clave, { [campo]: Number(e.target.value) })}
                            />
                          ) : (
                            f[campo]
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form className="demanda-agregar" onSubmit={agregarMateria} noValidate>
            <h3>Agregar una materia que no viene en el reporte</h3>
            <p className="formulario-nota">
              Si ya está en el catálogo basta con la clave. Las columnas del reporte quedan en 0; solo
              se captura cuántos grupos sugieres abrir.
            </p>
            <div className="demanda-agregar-campos">
              <label>
                Clave
                <input
                  list="demanda-catalogo"
                  value={nueva.clave}
                  placeholder={`${prefijoDepto ?? 'MAT'}-12345`}
                  onChange={(e) => cambiarNueva('clave', e.target.value)}
                />
                <datalist id="demanda-catalogo">
                  {sugerenciasNueva.map((m) => (
                    <option key={m.clave} value={m.clave}>
                      {m.nombre}
                    </option>
                  ))}
                </datalist>
              </label>
              <label className="demanda-agregar-nombre">
                Materia
                <input
                  value={nueva.nombre}
                  maxLength={255}
                  placeholder="Nombre (solo si es nueva)"
                  onChange={(e) => cambiarNueva('nombre', e.target.value)}
                />
              </label>
              <label>
                Créditos
                <input
                  className="input-num"
                  type="number"
                  min={1}
                  value={nueva.creditos}
                  onChange={(e) => cambiarNueva('creditos', e.target.value)}
                />
              </label>
              <label>
                Sug
                <input
                  className="input-num"
                  type="number"
                  min={0}
                  value={nueva.grupos_sugeridos}
                  onChange={(e) => cambiarNueva('grupos_sugeridos', e.target.value)}
                />
              </label>
              <button type="submit" className="btn-secondary" disabled={!nueva.clave.trim()}>
                Agregar
              </button>
            </div>
            {errorNueva && (
              <p className="formulario-error" role="alert">
                {errorNueva}
              </p>
            )}
          </form>

          <footer className="formulario-acciones">
            <button className="btn-link" disabled={guardando} onClick={() => setPrevia(null)}>
              Descartar
            </button>
            <button className="btn-primary" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : `Guardar ${previa.filas.filter((f) => f.incluir).length} materias`}
            </button>
          </footer>
        </section>
      )}

      {!previa && (
        <section className="formulario-seccion">
          <h2>Estimación cargada</h2>
          {cargando ? (
            <p className="formulario-nota">Cargando…</p>
          ) : !datos || datos.filas.length === 0 ? (
            <p className="formulario-nota">
              Todavía no hay estimación de demanda cargada para este departamento y semestre.
            </p>
          ) : (
            <>
              <p className="formulario-nota">
                {datos.filas.length} materias · {totalSugeridos} grupos sugeridos en total. Las materias con
                0 grupos sugeridos van resaltadas.
              </p>
              <div className="disponibilidad-grid-wrap">
                <table className="panel-tabla demanda-tabla">
                  <thead>
                    <tr>
                      <th>Clave</th>
                      <th>Materia</th>
                      <th>Créditos</th>
                      {COLUMNAS.map(([, etiqueta]) => (
                        <th key={etiqueta}>{etiqueta}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.filas.map((f) => (
                      <tr key={f.clave} className={Number(f.grupos_sugeridos) === 0 ? 'fila-sug-cero' : ''}>
                        <td className="materia-clave">{f.clave}</td>
                        <td>{f.nombre}</td>
                        <td>{f.creditos}</td>
                        {COLUMNAS.map(([campo]) => (
                          <td key={campo}>{Number(f[campo])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
