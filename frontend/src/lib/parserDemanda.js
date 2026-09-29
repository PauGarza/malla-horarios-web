// Lectura de la "Estimación de la demanda" que manda Servicios Escolares cada
// semestre (Info servicios escolares/Mat|Act|Est 202603.pdf). Funciones puras:
// reciben texto o un documento de pdf.js ya abierto y devuelven filas, para
// poder probarlas en Node contra los PDF reales sin navegador.
//
// Formato confirmado en los tres departamentos (diseno-bd.md §10.3): 15
// columnas, siempre en este orden:
//   Clave, Materia, A.T., N.I., %Baja, Baja, %Repr., Repr., Prerr., Suma,
//   Cap., 2025, Sug, Cred, Hrs
// Lo que se guarda y lo que no:
//   - Baja, Repr. y Hrs son derivadas (Hrs = Sug × Cred / 2): se leen solo
//     para validar, no se guardan.
//   - "2025" es "grupos del periodo anterior": el encabezado cambia de año
//     cada semestre, por eso se lee por posición y no por nombre.

const COLUMNAS_NUMERICAS = 13; // de A.T. a Hrs
const RE_CLAVE = /^([A-Z]{2,5})-?(\d{4,6})$/;
const TIPOS_SEMESTRE = { primavera: 'primavera', verano: 'verano', otono: 'otono', 'otoño': 'otono' };

/** "8.73%" -> 8.73; "1,234" -> 1234; lo que no es número -> NaN. */
function numero(texto) {
  return Number(String(texto).replace(/%$/, '').replace(/,/g, '').trim());
}

/** "ACT11300" y "ACT-11300" -> "ACT-11300" (Actuaría y Estadística vienen sin guion). */
export function normalizarClave(texto) {
  const m = RE_CLAVE.exec(String(texto).trim().toUpperCase());
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * Un renglón (ya partido en celdas o en palabras) -> fila de demanda, o null
 * si no es un renglón de materia (encabezados, títulos, pie).
 *
 * Funciona igual con celdas del PDF que con palabras sueltas de un texto
 * pegado: la clave es el primer token, los últimos 13 son los números, y todo
 * lo de en medio es el nombre.
 */
export function interpretarRenglon(tokens) {
  const limpios = tokens.map((t) => String(t).trim()).filter(Boolean);
  if (limpios.length < COLUMNAS_NUMERICAS + 1) return null;
  const clave = normalizarClave(limpios[0]);
  if (!clave) return null;

  const numeros = limpios.slice(-COLUMNAS_NUMERICAS).map(numero);
  if (numeros.some((n) => Number.isNaN(n))) return null;
  // Puede venir vacío: el reporte real de Estadística (202603) trae dos
  // materias sin nombre (EST13102, EST24129). No se descartan — si la materia
  // ya existe se conserva su nombre, y si es nueva hay que escribirlo en la
  // vista previa antes de guardar.
  const nombre = limpios.slice(1, -COLUMNAS_NUMERICAS).join(' ').replace(/\s+/g, ' ').trim();

  const [at, ni, pctBaja, , pctRepr, , prerr, suma, cap, anterior, sug, cred, hrs] = numeros;
  const fila = {
    clave,
    nombre,
    alumnos_total: at,
    nuevo_ingreso: ni,
    pct_baja: pctBaja,
    pct_reprobacion: pctRepr,
    con_prerrequisito: prerr,
    demanda_ajustada: suma,
    capacidad_planeacion: cap,
    grupos_periodo_anterior: anterior,
    grupos_sugeridos: sug,
    creditos: cred,
    horas: hrs,
    avisos: [],
  };
  // Hrs = Sug × Cred / 2 en todas las filas revisadas de los 3 reportes. Si
  // no cuadra, lo más probable es que el renglón se haya leído chueco.
  if (Math.abs(sug * cred / 2 - hrs) > 0.01) {
    fila.avisos.push(`Hrs (${hrs}) no cuadra con Sug × Cred / 2 (${(sug * cred) / 2})`);
  }
  if (!nombre) fila.avisos.push('El reporte no trae el nombre de la materia');
  if (!Number.isInteger(cred) || cred <= 0) fila.avisos.push('Créditos inválidos');
  if (!Number.isInteger(sug) || sug < 0) fila.avisos.push('Grupos sugeridos inválidos');
  return fila;
}

/** Quita repetidas por clave (el PDF trae la tabla como texto y también como imagen). */
function sinRepetidas(filas) {
  const vistas = new Map();
  for (const f of filas) if (!vistas.has(f.clave)) vistas.set(f.clave, f);
  return [...vistas.values()];
}

/** "Otoño 2026" en el encabezado -> { tipo: 'otono', anio: 2026 }. */
function semestreEnTexto(texto) {
  const m = /\b(primavera|verano|oto[ñn]o)\s+(\d{4})\b/i.exec(texto);
  if (!m) return null;
  const tipo = TIPOS_SEMESTRE[m[1].toLowerCase()];
  return { tipo, anio: Number(m[2]) };
}

/**
 * Código de periodo del nombre del archivo: "Mat 202603 (1).pdf" -> otoño 2026.
 * Supuesto confirmado con el PDF de Actuaría, que trae "Otoño 2026" en el
 * encabezado: 01 = primavera, 02 = verano, 03 = otoño.
 */
export function semestreDeNombreArchivo(nombre) {
  const m = /(\d{4})(0[123])/.exec(nombre ?? '');
  if (!m) return null;
  const tipo = { '01': 'primavera', '02': 'verano', '03': 'otono' }[m[2]];
  return { tipo, anio: Number(m[1]) };
}

/**
 * Texto pegado desde Excel (tabulado) o desde un visor de PDF (espacios).
 * Devuelve { filas, ignorados } — ignorados son los renglones que parecían
 * de materia (empiezan con clave) pero no se pudieron leer.
 */
export function filasDesdeTexto(texto) {
  const filas = [];
  const ignorados = [];
  for (const linea of String(texto).split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const tokens = linea.includes('\t') ? linea.split('\t') : linea.trim().split(/\s+/);
    const fila = interpretarRenglon(tokens);
    if (fila) filas.push(fila);
    else if (normalizarClave(tokens[0])) ignorados.push(linea.trim());
  }
  return { filas: sinRepetidas(filas), ignorados, semestre: semestreEnTexto(texto) };
}

/**
 * Documento de pdf.js ya abierto -> filas. Agrupa los fragmentos de texto por
 * renglón (misma altura, con tolerancia) y los ordena de izquierda a derecha;
 * en estos PDF cada fragmento es una celda.
 */
export async function filasDesdePdf(documento) {
  const renglones = [];
  let encabezado = '';
  for (let p = 1; p <= documento.numPages; p++) {
    const pagina = await documento.getPage(p);
    const { items } = await pagina.getTextContent();
    const porAltura = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5];
      let grupo = porAltura.find((g) => Math.abs(g.y - y) < 3);
      if (!grupo) {
        grupo = { y, celdas: [] };
        porAltura.push(grupo);
      }
      grupo.celdas.push({ x: it.transform[4], texto: it.str });
    }
    porAltura.sort((a, b) => b.y - a.y);
    for (const g of porAltura) {
      const celdas = g.celdas.sort((a, b) => a.x - b.x).map((c) => c.texto);
      renglones.push(celdas);
      if (p === 1 && !normalizarClave(celdas[0])) encabezado += ` ${celdas.join(' ')}`;
    }
  }
  const filas = [];
  const ignorados = [];
  for (const celdas of renglones) {
    const fila = interpretarRenglon(celdas);
    if (fila) filas.push(fila);
    else if (normalizarClave(celdas[0])) ignorados.push(celdas.join(' '));
  }
  return { filas: sinRepetidas(filas), ignorados, semestre: semestreEnTexto(encabezado) };
}
