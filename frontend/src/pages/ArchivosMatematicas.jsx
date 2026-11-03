import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { guardarAjusteProgramadas, leerProgramadas, quitarAjusteProgramadas } from '../lib/api';
import {
  armarArchivos,
  clasesPorDivision,
  escribirProgramadas,
  leerDepartamentales,
  slug,
} from '../lib/archivosMate';
import { etiquetaSemestre } from '../lib/semestre';

// Archivos de Matemáticas (2026-11-03): el Excel de Materias programadas para
// Servicios Escolares y un PDF por división con los grupos de las materias que
// llevan sus carreras. Solo Matemáticas (Estadística no usa este formato), solo
// jefatura y admin. Los datos son los de api/programadas.php; las reglas, en
// lib/archivosMate.js. El Excel se escribe con ExcelJS, que se carga solo al
// descargar; el PDF lo hace el navegador al imprimir, como "Horarios del
// departamento" (la hoja de impresión está en index.css).

const ACCIONES = {
  separar: { opcion: 'Abrir solo, sin clave compartida', texto: () => 'Se abre solo, sin clave compartida', compartido: true },
  vaciar: { opcion: 'Listar sin profesor, horario ni capacidad', texto: () => 'Se lista sin profesor, horario ni capacidad' },
  porcentaje: { opcion: 'Abrir con otro porcentaje', texto: (a) => `Se abre con ${Number(a.valor)}%`, compartido: true },
  confirmado: { opcion: 'El porcentaje de la malla es correcto', texto: () => 'El porcentaje de la malla es correcto' },
};
const EDITOR_VACIO = { grupo: '', accion: 'separar', valor: '', motivo: '' };

async function cargarExcelJS() {
  const mod = await import('exceljs');
  return mod.default ?? mod;
}

function bajarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const fechaLarga = (d) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const cuando = (iso) =>
  iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';

export default function ArchivosMatematicas({ onVolver }) {
  const { token, semestre } = useAuth();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [division, setDivision] = useState('');
  const [calendario, setCalendario] = useState(null); // { nombre, fechas }
  const [errorCalendario, setErrorCalendario] = useState('');
  const [ocupado, setOcupado] = useState(''); // 'calendario' | 'excel' | 'ajuste'
  const [editor, setEditor] = useState(EDITOR_VACIO);
  const [errorAjuste, setErrorAjuste] = useState('');

  useEffect(() => {
    if (!semestre) return undefined;
    let cancelado = false;
    setDatos(null);
    setError('');
    leerProgramadas(token, semestre.id)
      .then((d) => {
        if (!cancelado) setDatos(d);
      })
      .catch((err) => {
        if (!cancelado) setError(err.message);
      });
    return () => {
      cancelado = true;
    };
  }, [token, semestre]);

  const armado = useMemo(() => (datos ? armarArchivos(datos) : null), [datos]);
  const divisiones = useMemo(() => (armado ? clasesPorDivision(armado.grupos) : []), [armado]);
  const elegida = divisiones.find((d) => d.division === division) ?? divisiones[0];
  const etiqueta = etiquetaSemestre(semestre);

  // Los grupos para el formulario de ajustes; separar y porcentaje solo tienen
  // sentido en un grupo que comparte clase con otra clave.
  const opcionesGrupo = useMemo(() => {
    if (!datos) return [];
    const conCompartido = ACCIONES[editor.accion].compartido;
    return datos.grupos
      .filter((g) => !conCompartido || g.compartido.length)
      .map((g) => ({ llave: `${g.clave}-${g.numero}`, g }));
  }, [datos, editor.accion]);

  async function leerCalendario(archivo) {
    setErrorCalendario('');
    if (!archivo) {
      setCalendario(null);
      return;
    }
    setOcupado('calendario');
    try {
      const ExcelJS = await cargarExcelJS();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await archivo.arrayBuffer());
      const fechas = leerDepartamentales(wb);
      if (!fechas) {
        setCalendario(null);
        setErrorCalendario('Ese archivo no tiene la hoja DESGLOSE del calendario de departamentales.');
      } else {
        setCalendario({ nombre: archivo.name, fechas });
      }
    } catch {
      setCalendario(null);
      setErrorCalendario('No se pudo leer el archivo. Tiene que ser el Excel (.xlsx) de Servicios Escolares.');
    } finally {
      setOcupado('');
    }
  }

  async function descargarExcel() {
    setOcupado('excel');
    try {
      const ExcelJS = await cargarExcelJS();
      const blob = await escribirProgramadas(ExcelJS, armado.grupos, calendario?.fechas ?? null, etiqueta);
      bajarArchivo(blob, `materias-programadas-mat-${slug(etiqueta)}.xlsx`);
    } catch (err) {
      setError(`No se pudo generar el Excel: ${err.message}`);
    } finally {
      setOcupado('');
    }
  }

  function descargarPdf() {
    // El título de la página es el nombre que propone "Guardar como PDF"
    const antes = document.title;
    document.title = `mate-${slug(etiqueta)}-${slug(elegida.division)}`;
    const regresar = () => {
      document.title = antes;
      window.removeEventListener('afterprint', regresar);
    };
    window.addEventListener('afterprint', regresar);
    window.print();
  }

  async function guardarAjuste() {
    const g = opcionesGrupo.find((o) => o.llave === editor.grupo)?.g;
    if (!g) return;
    setOcupado('ajuste');
    setErrorAjuste('');
    try {
      const r = await guardarAjusteProgramadas(token, semestre.id, {
        materia_id: g.materia_id,
        numero: g.numero,
        accion: editor.accion,
        valor: editor.accion === 'porcentaje' ? Number(editor.valor) : null,
        motivo: editor.motivo,
      });
      setDatos((d) => ({ ...d, ajustes: r.ajustes }));
      setEditor(EDITOR_VACIO);
    } catch (err) {
      setErrorAjuste(err.message);
    } finally {
      setOcupado('');
    }
  }

  async function quitarAjuste(id) {
    setOcupado('ajuste');
    setErrorAjuste('');
    try {
      const r = await quitarAjusteProgramadas(token, semestre.id, id);
      setDatos((d) => ({ ...d, ajustes: r.ajustes }));
    } catch (err) {
      setErrorAjuste(err.message);
    } finally {
      setOcupado('');
    }
  }

  const valorValido = editor.accion !== 'porcentaje' || (editor.valor !== '' && Number(editor.valor) >= 0 && Number(editor.valor) <= 100);
  const faltaParaGuardar = !editor.grupo ? 'Elige un grupo.' : !valorValido ? 'El porcentaje va de 0 a 100.' : '';

  return (
    <div className="respuestas-screen archivos-mate">
      <header className="formulario-header no-imprimir">
        <button className="btn-link" onClick={onVolver}>
          ← Volver
        </button>
        <div className="formulario-header-datos">
          <div>
            <strong>Archivos de Matemáticas</strong>
            <span>
              {etiqueta} · el Excel de Materias programadas para Servicios Escolares y los horarios por división,
              en PDF
            </span>
          </div>
        </div>
      </header>

      {!semestre && <p className="formulario-error">No hay ningún semestre activo.</p>}
      {error && <p className="formulario-error">{error}</p>}
      {semestre && !datos && !error && <div className="formulario-cargando">Cargando…</div>}
      {datos && !datos.grupos.length && <p className="formulario-nota">Todavía no hay grupos de Matemáticas en la malla.</p>}

      {armado && datos.grupos.length > 0 && (
        <>
          <section className="archivos-seccion no-imprimir">
            <h2>Antes de descargar</h2>
            <p className="formulario-nota">
              Los archivos salen de la malla tal como está ahora, con {armado.grupos.length} grupos.
            </p>
            {armado.fuera.length > 0 && (
              <>
                <h3>No salen en los archivos porque los programa otro departamento</h3>
                <ul className="archivos-lista">
                  {armado.fuera.map((f) => (
                    <li key={f.grupo}>
                      <b>{f.grupo}</b> {f.materia} · {f.profesores}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {armado.avisos.length + armado.sinGrupo.length > 0 ? (
              <>
                <h3>Para revisar</h3>
                <ul className="archivos-lista archivos-avisos">
                  {armado.avisos.map((a) => (
                    <li key={a.grupo + a.texto}>
                      <b>{a.grupo}</b> {a.texto}
                    </li>
                  ))}
                  {armado.sinGrupo.map((a) => (
                    <li key={a.id}>
                      <b>
                        {a.clave}-{a.numero}
                      </b>{' '}
                      tiene un ajuste, pero ese grupo ya no está en la malla
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="formulario-nota">No hay nada que revisar.</p>
            )}
          </section>

          <section className="archivos-seccion no-imprimir">
            <h2>Ajustes</h2>
            <p className="formulario-nota">
              Lo que debe decir el Excel aunque la malla diga otra cosa. Solo cambian los archivos: la malla se queda
              igual.
            </p>
            {datos.ajustes.length > 0 && (
              <table className="panel-tabla archivos-tabla">
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Qué cambia</th>
                    <th>Motivo</th>
                    <th>Quién</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {datos.ajustes.map((a) => (
                    <tr key={a.id}>
                      <td className="archivos-nowrap">
                        {a.clave}-{a.numero}
                      </td>
                      <td>{ACCIONES[a.accion]?.texto(a) ?? a.accion}</td>
                      <td>{a.motivo}</td>
                      <td className="archivos-quien">
                        {a.creado_por}
                        <br />
                        {cuando(a.creado_at)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          disabled={ocupado === 'ajuste'}
                          onClick={() => quitarAjuste(a.id)}
                        >
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="asig-campos">
              <label>
                Qué cambia
                <select
                  value={editor.accion}
                  onChange={(e) => setEditor((ed) => ({ ...ed, accion: e.target.value, grupo: '', valor: '' }))}
                >
                  {Object.entries(ACCIONES).map(([v, a]) => (
                    <option key={v} value={v}>
                      {a.opcion}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Grupo
                <select value={editor.grupo} onChange={(e) => setEditor((ed) => ({ ...ed, grupo: e.target.value }))}>
                  <option value="">Elige un grupo…</option>
                  {opcionesGrupo.map(({ llave, g }) => (
                    <option key={llave} value={llave}>
                      {llave} · {g.materia}
                    </option>
                  ))}
                </select>
              </label>
              {editor.accion === 'porcentaje' && (
                <label>
                  Porcentaje
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={editor.valor}
                    onChange={(e) => setEditor((ed) => ({ ...ed, valor: e.target.value }))}
                  />
                </label>
              )}
              <label>
                Motivo (opcional)
                <input
                  type="text"
                  maxLength={300}
                  value={editor.motivo}
                  onChange={(e) => setEditor((ed) => ({ ...ed, motivo: e.target.value }))}
                />
              </label>
            </div>
            <div className="asig-acciones">
              <button
                type="button"
                className="btn-primary"
                disabled={Boolean(faltaParaGuardar) || ocupado === 'ajuste'}
                onClick={guardarAjuste}
              >
                {ocupado === 'ajuste' ? 'Guardando…' : 'Guardar ajuste'}
              </button>
              {faltaParaGuardar && <span className="formulario-nota">{faltaParaGuardar}</span>}
            </div>
            {errorAjuste && <p className="formulario-error">{errorAjuste}</p>}
          </section>

          <section className="archivos-seccion no-imprimir">
            <h2>Excel de Materias programadas</h2>
            <p className="formulario-nota">
              Para que salgan las fechas de los departamentales, sube el calendario de Servicios Escolares (el Excel con
              la hoja DESGLOSE). No se guarda: se lee solo para este archivo. Sin él, el Excel sale sin fechas.
            </p>
            <div className="asig-acciones">
              <label className="archivos-subir">
                Calendario de departamentales
                <input
                  type="file"
                  accept=".xlsx"
                  disabled={ocupado === 'calendario'}
                  onChange={(e) => leerCalendario(e.target.files[0])}
                />
              </label>
              {calendario && (
                <span className="formulario-nota">
                  {calendario.nombre}: fechas de {calendario.fechas.size} materias
                </span>
              )}
            </div>
            {errorCalendario && <p className="formulario-error">{errorCalendario}</p>}
            <div className="asig-acciones">
              <button type="button" className="btn-primary" disabled={Boolean(ocupado)} onClick={descargarExcel}>
                {ocupado === 'excel' ? 'Generando…' : 'Descargar Excel'}
              </button>
            </div>
          </section>

          {elegida && (
            <section className="archivos-seccion archivos-pdf">
              <div className="asig-acciones no-imprimir">
                <h2>Horarios por división</h2>
                <label className="selector-depto">
                  División
                  <select value={elegida.division} onChange={(e) => setDivision(e.target.value)}>
                    {divisiones.map((d) => (
                      <option key={d.division} value={d.division}>
                        {d.division}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn-primary" onClick={descargarPdf}>
                  Descargar PDF
                </button>
              </div>
              <p className="formulario-nota no-imprimir">
                Al descargar se abre la ventana de impresión: elige «Guardar como PDF» como destino. Va una división por
                archivo.
              </p>

              <h1 className="archivos-pdf-titulo">Horarios de Matemáticas · {etiqueta}</h1>
              <p className="archivos-pdf-sub">
                División Académica de {elegida.division} · versión preliminar al {fechaLarga(new Date())}
              </p>
              <table className="archivos-pdf-tabla">
                <thead>
                  <tr>
                    <th className="archivos-col-clave">Clave</th>
                    <th className="archivos-col-grupo">Grupo</th>
                    <th>Materia</th>
                    <th className="archivos-col-dias">Días</th>
                    <th className="archivos-col-horario">Horario</th>
                  </tr>
                </thead>
                <tbody>
                  {elegida.renglones.map((r) => (
                    <tr key={r.key}>
                      <td>{r.clave}</td>
                      <td className="archivos-col-grupo">{r.grupo}</td>
                      <td>{r.materia}</td>
                      <td>{r.dias}</td>
                      <td>{r.horario}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
