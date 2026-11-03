// Las carreras del ITAM y su división, para los PDF por división de "Archivos de
// Matemáticas" (pages/ArchivosMatematicas.jsx). La base no tiene carreras ni
// divisiones: solo planes de estudio, cuya clave es el código de la carrera más
// la letra del plan (ACT-H, M.A-F). Esto dice a qué carrera y división
// pertenece cada código.
//
// Solo las carreras individuales que publica itam.mx (divisiones,
// departamentos y programas académicos); Telecomunicaciones ya no existe. Las
// carreras que cambiaron de código cuentan como la nueva: un plan de COM es un
// plan anterior de ICC.

// Orden de la página del ITAM
export const DIVISIONES = [
  'Ciencias de la Computación',
  'Ciencias Exactas',
  'Ciencias Sociales',
  'Estudios Generales y Estudios Internacionales',
  'Ingeniería',
  'Negocios',
];

/** codigo -> { carrera, division, reemplazadaPor } */
export const CARRERAS = {
  ACT: { carrera: 'Licenciatura en Actuaría', division: 'Ciencias Exactas' },
  'M.A': { carrera: 'Licenciatura en Matemáticas Aplicadas', division: 'Ciencias Exactas' },
  ICC: { carrera: 'Ingeniería y Ciencias de la Computación', division: 'Ciencias de la Computación' },
  COM: { carrera: 'Ingeniería en Computación', division: 'Ciencias de la Computación', reemplazadaPor: 'ICC' },
  CDA: { carrera: 'Licenciatura en Ciencia de Datos', division: 'Ciencias de la Computación' },
  'I.A': { carrera: 'Ingeniería en Inteligencia Artificial', division: 'Ciencias de la Computación' },
  CPL: { carrera: 'Licenciatura en Ciencia Política', division: 'Ciencias Sociales' },
  DER: { carrera: 'Licenciatura en Derecho', division: 'Ciencias Sociales' },
  ECO: { carrera: 'Licenciatura en Economía', division: 'Ciencias Sociales' },
  'R.I': { carrera: 'Licenciatura en Relaciones Internacionales', division: 'Estudios Generales y Estudios Internacionales' },
  ISI: { carrera: 'Ingeniería Industrial y en Sistemas Inteligentes', division: 'Ingeniería' },
  IND: { carrera: 'Ingeniería Industrial', division: 'Ingeniería', reemplazadaPor: 'ISI' },
  MRI: { carrera: 'Ingeniería en Mecatrónica y Robótica Inteligente', division: 'Ingeniería' },
  MCT: { carrera: 'Ingeniería en Mecatrónica', division: 'Ingeniería', reemplazadaPor: 'MRI' },
  NEG: { carrera: 'Ingeniería en Negocios', division: 'Ingeniería' },
  ADN: { carrera: 'Licenciatura en Administración de Negocios', division: 'Negocios' },
  ADM: { carrera: 'Licenciatura en Administración', division: 'Negocios', reemplazadaPor: 'ADN' },
  CAF: { carrera: 'Licenciatura en Contaduría Analítica y Finanzas Corporativas', division: 'Negocios' },
  CEF: { carrera: 'Licenciatura en Contaduría Pública y Estrategia Financiera', division: 'Negocios', reemplazadaPor: 'CAF' },
  DFI: { carrera: 'Licenciatura en Dirección Financiera', division: 'Negocios' },
  DMK: { carrera: 'Licenciatura en Dirección de Mercadotecnia', division: 'Negocios' },
};

/** Carrera actual -> los códigos que cuentan como suyos (el suyo y los que reemplaza). */
export function carrerasActuales() {
  const actuales = {};
  for (const [codigo, c] of Object.entries(CARRERAS)) if (!c.reemplazadaPor) actuales[codigo] = [codigo];
  for (const [codigo, c] of Object.entries(CARRERAS)) if (c.reemplazadaPor) actuales[c.reemplazadaPor].push(codigo);
  return actuales;
}
