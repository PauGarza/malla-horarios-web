// Prueba el parser de la estimación de demanda contra PDFs reales, sin
// navegador. Úsalo cuando llegue un reporte nuevo de Servicios Escolares,
// para ver si el formato cambió antes de que alguien lo suba en la app:
//
//   node scripts/probar-parser-demanda.mjs "../../Info servicios escolares/Mat 202603 (1).pdf" [...]
//
// Debe dar 0 ignorados y 0 avisos salvo los conocidos (Estadística 202603
// trae dos materias sin nombre: EST13102, EST24129).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { filasDesdePdf, semestreDeNombreArchivo } from '../src/lib/parserDemanda.js';

if (process.argv.length < 3) {
  console.error('Uso: node scripts/probar-parser-demanda.mjs <archivo.pdf> [...]');
  process.exit(1);
}

for (const archivo of process.argv.slice(2)) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(archivo)) }).promise;
  const r = await filasDesdePdf(doc);
  const nombre = path.basename(archivo);
  const prefijos = [...new Set(r.filas.map((f) => f.clave.split('-')[0]))];
  console.log(
    `${nombre}: ${r.filas.length} materias (${prefijos.join(', ')}), ` +
      `${r.ignorados.length} renglones ignorados, semestre en el PDF ${JSON.stringify(r.semestre)}, ` +
      `en el nombre ${JSON.stringify(semestreDeNombreArchivo(nombre))}`,
  );
  for (const f of r.filas.filter((x) => x.avisos.length)) console.log(`  aviso ${f.clave}: ${f.avisos.join('; ')}`);
  for (const i of r.ignorados) console.log(`  ignorado: ${i}`);
}
