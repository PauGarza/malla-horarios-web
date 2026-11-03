// "Archivos de Matemáticas" (pages/ArchivosMatematicas.jsx): el Excel de
// Materias programadas para Servicios Escolares y las tablas de los PDF por
// división, con los datos de api/programadas.php.
//
// Son las reglas de los scripts con que se hicieron a mano los de Primavera
// 2027 (materias_programadas.py y generar_reporte.py), con los mismos textos:
//   - Quedan fuera los grupos que programa otro departamento (Actuaría): los
//     que tienen profesor y ninguno es de Matemáticas.
//   - Los ajustes de la jefatura (separar, vaciar, porcentaje, confirmado)
//     cambian solo los archivos.
//   - Excel: un bloque por clave, en orden de clave. La clase compartida NO se
//     junta: sale en el bloque de cada una de sus claves. Arriba de cada
//     bloque, con qué porcentaje se abre cada clave compartida y las fechas de
//     los departamentales.
//   - PDF: una tabla por división con los grupos de las materias que llevan
//     sus carreras; una clase compartida va en un solo renglón.
//
// Sin dependencias del navegador: el Excel se escribe con el ExcelJS que se
// le pasa, para poder cargarlo solo al descargar.

import { CARRERAS, DIVISIONES, carrerasActuales } from './carrerasDivisiones';

const DIAS = { lunes: 'Lu', martes: 'Ma', miercoles: 'Mi', jueves: 'Ju', viernes: 'Vi' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];
const VECES = { 2: 'doble', 3: 'triple', 4: 'cuádruple' };

const minutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const nombreGrupo = (clave, numero) => `${clave}-${numero}`;
// Orden por código, como sorted() de Python: localeCompare se salta guiones y puntos
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** 'primavera-2027', 'otono-2026': para el nombre de los archivos. */
export const slug = (texto) =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
/** '3 noviembre 2026' */
export const fechaVersion = (d) => `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;

// -----------------------------------------------------------------------------
// Grupos
// -----------------------------------------------------------------------------

/** Días, horario y profesores en forma de reporte; lo raro va a `avisos`. */
function prepararGrupo(g, avisos) {
  const etq = nombreGrupo(g.clave, g.numero);
  const sesiones = g.sesiones || [];
  const horas = [...new Set(sesiones.map((s) => `${s.inicio}-${s.fin}`))];
  const avisar = (texto) => avisos.push({ grupo: etq, texto });
  if (!sesiones.length) {
    avisar('Sin horario');
  } else if (horas.length > 1) {
    // Por diseño un grupo va a la misma hora todos sus días
    avisar(`Horas distintas según el día: ${horas.join(' | ')}`);
  } else if (sesiones.some((s) => s.bloques * 30 !== minutos(s.fin) - minutos(s.inicio))) {
    avisar(`Un día tiene un hueco entre bloques (${horas[0]})`);
  }

  let profs = (g.profesores || []).map((p) =>
    p.por_asignar ? { nombre: 'Por asignar', cu: '' } : { nombre: p.nombre, cu: p.cu || '' });
  if (!profs.length || profs.every((p) => p.nombre === 'Por asignar')) {
    profs = [{ nombre: 'Por asignar', cu: '' }];
    avisar('Sin profesor asignado');
  }
  for (const p of profs) if (p.nombre !== 'Por asignar' && !p.cu) avisar(`Sin clave única en el sistema: ${p.nombre}`);

  return {
    grupo_id: g.grupo_id,
    materia_id: g.materia_id,
    clave: g.clave,
    materia: g.materia,
    numero: g.numero,
    cupo: g.cupo_maximo,
    porcentaje: g.porcentaje,
    compartido: (g.compartido || []).map((c) => ({ ...c })),
    planes: g.planes || [],
    dias: sesiones.map((s) => DIAS[s.dia] || s.dia).join(' '),
    horas,
    profs,
    vaciado: false,
  };
}

/**
 * Los grupos que programa otro departamento (Actuaría, con profesores sin
 * cuenta): tienen profesor y ninguno es de Matemáticas. "Por asignar" no
 * cuenta para un lado ni para el otro.
 */
function esDeOtroDepartamento(g, mat) {
  const reales = (g.profesores || []).filter((p) => !p.por_asignar);
  return reales.length > 0 && reales.every((p) => p.departamento_id !== mat);
}

const ORDEN_AJUSTE = { separar: 0, vaciar: 1, porcentaje: 2, confirmado: 3 };

/**
 * Aplica los ajustes de la jefatura sobre los grupos (los cambia). Devuelve
 * los grupos cuyo porcentaje confirmó la jefatura y los ajustes que ya no
 * tienen grupo (cambió la malla o el grupo quedó fuera).
 *
 *   separar     el grupo se abre solo: se quita de la clase en los dos lados
 *   vaciar      se lista solo con clave, grupo y materia
 *   porcentaje  % con que se abre el grupo (se corrige también en sus compañeros)
 *   confirmado  el % que trae la malla es correcto
 */
function aplicarAjustes(grupos, ajustes) {
  const porNombre = new Map(grupos.map((g) => [nombreGrupo(g.clave, g.numero), g]));
  const confirmados = new Set();
  const sinGrupo = [];
  const ordenados = [...ajustes].sort((a, b) => (ORDEN_AJUSTE[a.accion] ?? 9) - (ORDEN_AJUSTE[b.accion] ?? 9));
  for (const a of ordenados) {
    const nombre = nombreGrupo(a.clave, a.numero);
    const g = porNombre.get(nombre);
    if (!g) {
      sinGrupo.push(a);
      continue;
    }
    const companeros = g.compartido.map((c) => porNombre.get(nombreGrupo(c.clave, c.numero))).filter(Boolean);
    if (a.accion === 'separar') {
      for (const otro of companeros) {
        otro.compartido = otro.compartido.filter((c) => nombreGrupo(c.clave, c.numero) !== nombre);
        if (!otro.compartido.length) otro.porcentaje = null;
      }
      g.compartido = [];
      g.porcentaje = null;
    } else if (a.accion === 'vaciar') {
      Object.assign(g, { profs: [{ nombre: '', cu: '' }], dias: '', horas: [], cupo: null, vaciado: true });
    } else if (a.accion === 'porcentaje') {
      g.porcentaje = a.valor;
      for (const otro of companeros) {
        for (const c of otro.compartido) if (nombreGrupo(c.clave, c.numero) === nombre) c.porcentaje = a.valor;
      }
    } else if (a.accion === 'confirmado') {
      confirmados.add(nombre);
    }
  }
  return { confirmados, sinGrupo };
}

// -----------------------------------------------------------------------------
// Carreras y planes
// -----------------------------------------------------------------------------

const codigoYLetra = (plan) => {
  const i = plan.lastIndexOf('-');
  return [plan.slice(0, i), plan.slice(i + 1)];
};

/**
 * ¿La materia del grupo la lleva esa carrera? El plan actual es el vigente
 * del código actual; si no está ahí pero sí en uno anterior (otra letra, o el
 * código viejo de la carrera), también cuenta.
 */
function laLlevaLaCarrera(g, codigos) {
  return g.planes.some((p) => codigos.includes(codigoYLetra(p.clave)[0]));
}

/** Clave nueva = está en el plan vigente de alguna carrera actual. */
function clavesNuevas(grupos) {
  const actuales = new Set(Object.keys(carrerasActuales()));
  return new Set(
    grupos.filter((g) => g.planes.some((p) => p.vigente && actuales.has(codigoYLetra(p.clave)[0]))).map((g) => g.clave),
  );
}

// -----------------------------------------------------------------------------
// Clases compartidas
// -----------------------------------------------------------------------------

const textoPct = (p) => (p == null ? '?' : String(Number(p)));

/** [{ clave, nombre, porcentaje }] de la clase del grupo, él incluido; [] si no se comparte. */
function miembros(g) {
  if (!g.compartido.length) return [];
  const lst = [{ clave: g.clave, nombre: g.materia, porcentaje: g.porcentaje }].concat(
    g.compartido.map((c) => ({ clave: c.clave, nombre: c.nombre, porcentaje: c.porcentaje })),
  );
  return lst.sort((a, b) => (b.porcentaje ?? 0) - (a.porcentaje ?? 0) || cmp(a.clave, b.clave));
}

function textoCoOferta(firma) {
  const n = firma.length;
  const partes = firma.map((m) => `${textoPct(m.porcentaje)}% a ${m.clave} ${m.nombre}`);
  const cuantas = VECES[n] ? `${VECES[n]} clave` : `${n} claves`;
  return `Abrir con ${cuantas}: ` + partes.slice(0, -1).join(', ') + ` y ${partes[n - 1]}`;
}

/** Avisos si el % no sigue 0% a la clave vieja / 100% a la nueva. */
function revisarRegla(firma, nuevas) {
  const hayNueva = firma.some((m) => nuevas.has(m.clave));
  const avisos = [];
  for (const { clave, porcentaje } of firma) {
    if (!clave.startsWith('MAT-') || porcentaje == null) continue;
    const p = Number(porcentaje);
    if (nuevas.has(clave) && p === 0) avisos.push(`${clave} es de plan vigente y se abre con 0%`);
    if (!nuevas.has(clave) && p === 100 && hayNueva) avisos.push(`${clave} solo está en planes anteriores y se abre con 100%`);
  }
  return avisos;
}

// -----------------------------------------------------------------------------
// Departamentales (hoja DESGLOSE del calendario de Servicios Escolares)
// -----------------------------------------------------------------------------

/** 1430, '1330' o '930' -> '14:30', '13:30', '09:30'. */
function hora(v) {
  const t = String(Math.trunc(Number(v))).padStart(4, '0');
  return `${t.slice(0, 2)}:${t.slice(2)}`;
}

/** El valor de una celda de ExcelJS: el resultado de una fórmula, el texto de un texto con formato. */
function valor(v) {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

/**
 * clave -> [{ fecha: Date, dia: 'Ma', inicio: '14:30', fin: '16:00' }] por fecha.
 * null si el libro no tiene la hoja DESGLOSE.
 */
export function leerDepartamentales(workbook) {
  const ws = workbook.getWorksheet('DESGLOSE');
  if (!ws) return null;
  const fechas = new Map();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const [depto, clave, fecha, dia, ini, fin] = row.values.slice(1, 7).map(valor);
    if (!depto || !clave || !(fecha instanceof Date) || ini == null || fin == null) return;
    const llave = `${String(depto).trim()}-${String(clave).trim()}`;
    const d = String(dia ?? '').trim();
    if (!fechas.has(llave)) fechas.set(llave, []);
    fechas.get(llave).push({
      fecha,
      dia: d.charAt(0).toUpperCase() + d.slice(1).toLowerCase(),
      inicio: hora(ini),
      fin: hora(fin),
    });
  });
  for (const lst of fechas.values()) lst.sort((a, b) => a.fecha - b.fecha);
  return fechas;
}

// ExcelJS da las fechas a medianoche UTC: el día se lee en UTC
const ddmm = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

function textoFechas(lst) {
  const horas = new Set(lst.map((x) => `${x.inicio}-${x.fin}`));
  if (horas.size === 1) {
    return 'Fechas departamentales: ' + lst.map((x) => `${x.dia} ${ddmm(x.fecha)}`).join(', ') + ` de ${[...horas][0]}`;
  }
  return 'Fechas departamentales: ' + lst.map((x) => `${x.dia} ${ddmm(x.fecha)} de ${x.inicio}-${x.fin}`).join(', ');
}

// -----------------------------------------------------------------------------
// Armado
// -----------------------------------------------------------------------------

/**
 * Todo lo que necesitan la vista y los archivos, de la respuesta de
 * api/programadas.php:
 *   grupos       los que van en los archivos, ya con los ajustes
 *   fuera        los que programa otro departamento: [{ grupo, materia, profesores }]
 *   avisos       [{ grupo, texto }] para revisar
 *   sinGrupo     ajustes cuyo grupo ya no está
 *   confirmados  'MAT-24100-001' cuyo % confirmó la jefatura
 *   nuevas       claves de plan vigente (para la regla 0% / 100%)
 */
export function armarArchivos(datos) {
  const avisos = [];
  const fuera = [];
  const grupos = [];
  for (const g of datos.grupos) {
    if (esDeOtroDepartamento(g, datos.departamento_id)) {
      fuera.push({
        grupo: nombreGrupo(g.clave, g.numero),
        materia: g.materia,
        profesores: g.profesores.filter((p) => !p.por_asignar).map((p) => p.nombre).join(' / '),
      });
      continue;
    }
    grupos.push(prepararGrupo(g, avisos));
  }
  const { confirmados, sinGrupo } = aplicarAjustes(grupos, datos.ajustes || []);
  // Un grupo vaciado no tiene horario ni profesor a propósito
  const vaciados = new Set(grupos.filter((g) => g.vaciado).map((g) => nombreGrupo(g.clave, g.numero)));
  const filtrados = avisos.filter((a) => !vaciados.has(a.grupo));
  const nuevas = clavesNuevas(grupos);
  return { grupos, fuera, avisos: filtrados.concat(avisosExcel(grupos, nuevas, confirmados)), sinGrupo, confirmados, nuevas };
}

/** Los bloques del Excel por clave: [{ clave, info: [texto], grupos }]. */
function bloquesPorClave(grupos, departamentales) {
  const porClave = new Map();
  for (const g of grupos) {
    if (!porClave.has(g.clave)) porClave.set(g.clave, []);
    porClave.get(g.clave).push(g);
  }
  const bloques = [];
  for (const clave of [...porClave.keys()].sort(cmp)) {
    const gs = porClave.get(clave).sort((a, b) => cmp(a.numero, b.numero));
    // Una línea por combinación de clases compartidas; si conviven varias (o
    // grupos sin compartir), cada línea dice a qué grupos aplica
    const firmas = new Map();
    for (const g of gs) {
      const firma = miembros(g);
      const llave = JSON.stringify(firma);
      if (!firmas.has(llave)) firmas.set(llave, { firma, numeros: [] });
      firmas.get(llave).numeros.push(g.numero);
    }
    const compartidas = [...firmas.values()].filter((f) => f.firma.length);
    const sinCompartir = firmas.get('[]');
    const gruposTxt = (nums) => (nums.length === 1 ? 'Grupo ' : 'Grupos ') + nums.join(', ');
    const info = [];
    for (const f of compartidas) {
      const texto = textoCoOferta(f.firma);
      info.push(firmas.size > 1 ? `${gruposTxt(f.numeros)}: ` + texto[0].toLowerCase() + texto.slice(1) : texto);
    }
    if (compartidas.length && sinCompartir) info.push(`${gruposTxt(sinCompartir.numeros)}: sin clave compartida`);
    if (departamentales && departamentales.has(clave)) info.push(textoFechas(departamentales.get(clave)));
    bloques.push({ clave, info, grupos: gs, compartidas });
  }
  return bloques;
}

/** Lo que el Excel saldría diciendo mal: regla 0% / 100% y grupos sin capacidad. */
function avisosExcel(grupos, nuevas, confirmados) {
  const avisos = [];
  const revisadas = new Set();
  for (const { clave, grupos: gs, compartidas } of bloquesPorClave(grupos, null)) {
    for (const f of compartidas) {
      // La misma clase sale en el bloque de cada clave: se revisa una vez
      const llave = JSON.stringify(f.firma);
      if (revisadas.has(llave)) continue;
      revisadas.add(llave);
      if (f.numeros.some((n) => confirmados.has(nombreGrupo(clave, n)))) continue;
      const claves = f.firma.map((m) => m.clave).join(' / ');
      for (const texto of revisarRegla(f.firma, nuevas)) avisos.push({ grupo: claves, texto });
    }
    for (const g of gs) {
      if (g.cupo == null && !g.vaciado) avisos.push({ grupo: nombreGrupo(clave, g.numero), texto: 'Sin capacidad en el sistema' });
    }
  }
  return avisos;
}

// -----------------------------------------------------------------------------
// PDF por división
// -----------------------------------------------------------------------------

/**
 * [{ division, renglones: [{ key, clave, grupo, materia, dias, horario }] }]
 * en el orden de DIVISIONES, solo las que tienen grupos. Un grupo que llevan
 * varias carreras de la división sale una vez; una clase compartida, en un
 * renglón con sus claves juntas (primero las de la división). Los grupos
 * vaciados no salen: sin horario no le dicen nada a la división.
 */
export function clasesPorDivision(grupos) {
  const nombres = new Map(grupos.map((g) => [g.clave, g.materia]));
  const porDivision = new Map();
  for (const [codigo, codigos] of Object.entries(carrerasActuales())) {
    const division = CARRERAS[codigo].division;
    for (const g of grupos) {
      if (g.vaciado || !laLlevaLaCarrera(g, codigos)) continue;
      if (!porDivision.has(division)) porDivision.set(division, new Map());
      porDivision.get(division).set(g.grupo_id, g);
    }
  }
  const resultado = [];
  for (const division of DIVISIONES) {
    const gs = porDivision.get(division);
    if (!gs) continue;
    const clases = new Map();
    for (const g of gs.values()) {
      const propio = nombreGrupo(g.clave, g.numero);
      const todos = [propio, ...g.compartido.map((c) => nombreGrupo(c.clave, c.numero))].sort(cmp);
      const llave = todos.join('|');
      if (!clases.has(llave)) clases.set(llave, { todos, enDiv: new Set(), g });
      clases.get(llave).enDiv.add(propio);
    }
    const renglones = [...clases.values()].map(({ todos, enDiv, g }) => {
      const orden = [...enDiv].sort(cmp).concat(todos.filter((x) => !enDiv.has(x)));
      const claves = orden.map((x) => x.slice(0, x.lastIndexOf('-')));
      const numeros = orden.map((x) => x.slice(x.lastIndexOf('-') + 1));
      const materias = [...new Set(claves.filter((c) => nombres.has(c)).map((c) => nombres.get(c)))];
      return {
        key: orden.join('|'),
        orden: [claves[0], numeros[0]],
        clave: claves.join(' / '),
        grupo: new Set(numeros).size === 1 ? numeros[0] : numeros.join(' / '),
        materia: materias.join(' / '),
        dias: g.dias,
        horario: g.horas.map((h) => h.replace('-', '–')).join(' | '),
      };
    });
    renglones.sort((a, b) => cmp(a.orden[0], b.orden[0]) || cmp(a.orden[1], b.orden[1]));
    resultado.push({ division, renglones });
  }
  return resultado;
}

// -----------------------------------------------------------------------------
// Excel de Materias programadas
// -----------------------------------------------------------------------------

const ENCABEZADO = ['CRN', 'CLAVE', 'GPO.', 'MATERIA', 'PROFESOR', 'CLAVE PROFESOR', 'DÍAS', 'HORARIO', 'CAPACIDAD'];
const ANCHOS = [8, 11, 6, 34, 36, 10, 10, 12, 10];
// Los renglones de clases compartidas y fechas van combinados de MATERIA a HORARIO
const INFO_DESDE = 4;
const INFO_HASTA = 8;
const DELGADA = { style: 'thin', color: { argb: 'FF000000' } };
const BORDE = { top: DELGADA, left: DELGADA, bottom: DELGADA, right: DELGADA };
const GRIS = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const CENTRO = { horizontal: 'center', vertical: 'middle', wrapText: true };
const IZQ = { horizontal: 'left', vertical: 'middle', wrapText: true };

/**
 * El Excel con el formato de la hoja que se entrega a Servicios Escolares, como
 * Blob. `etiqueta` es el semestre ('Primavera 2027'); `departamentales`, lo de
 * leerDepartamentales() o null (entonces sale sin fechas).
 */
export async function escribirProgramadas(ExcelJS, grupos, departamentales, etiqueta, hoy = new Date()) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Materias programadas', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' },
  });
  ws.columns = ANCHOS.map((width) => ({ width }));
  const ultima = ENCABEZADO.length;

  [['MATERIAS PROGRAMADAS', 12], [`${etiqueta} - versión ${fechaVersion(hoy)}`, 11]].forEach(([texto, size], i) => {
    const fila = i + 1;
    ws.mergeCells(fila, 1, fila, ultima);
    const c = ws.getCell(fila, 1);
    c.value = texto;
    c.font = { bold: true, size };
    c.alignment = CENTRO;
  });
  ENCABEZADO.forEach((titulo, i) => {
    const c = ws.getCell(4, i + 1);
    c.value = titulo;
    Object.assign(c, { font: { bold: true }, fill: GRIS, border: BORDE, alignment: CENTRO });
  });

  let fila = 5;
  const renglonInfo = (texto) => {
    for (let col = 1; col <= ultima; col++) ws.getCell(fila, col).border = BORDE;
    for (let col = INFO_DESDE; col <= INFO_HASTA; col++) ws.getCell(fila, col).fill = GRIS;
    ws.mergeCells(fila, INFO_DESDE, fila, INFO_HASTA);
    const c = ws.getCell(fila, INFO_DESDE);
    c.value = texto;
    c.alignment = IZQ;
    fila++;
  };
  const renglonGrupo = (g) => {
    const valores = [null, g.clave, g.numero, g.materia,
      g.profs.map((p) => p.nombre).join('\n'), g.profs.map((p) => p.cu).join('\n'),
      g.dias, g.horas.join(' / '), g.cupo ?? null];
    valores.forEach((v, i) => {
      const c = ws.getCell(fila, i + 1);
      if (v !== null && v !== '') c.value = v;
      c.border = BORDE;
      c.alignment = i === 3 || i === 4 ? IZQ : CENTRO;
    });
    if (g.profs.length > 1) ws.getRow(fila).height = 15 * g.profs.length;
    fila++;
  };

  for (const b of bloquesPorClave(grupos, departamentales)) {
    b.info.forEach(renglonInfo);
    b.grupos.forEach(renglonGrupo);
    fila++; // renglón en blanco entre claves
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
