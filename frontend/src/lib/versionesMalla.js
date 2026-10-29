// Las versiones anteriores de la malla (2026-10-29, D60): la que dejó cada
// subida del motor, por departamento (api/malla-versiones.php). La jefatura
// las ve en solo lectura, las compara con la actual y marca la que prefiere.
//
// El comparativo es el que se le armó a la jefatura de Estadística al volver a
// la malla del 28 de octubre: grupo por grupo, «mismo profesor y materia» (lo
// que más le importa a un jefe) y, aparte, «idénticos» (además, el mismo
// horario). Los grupos de una materia son intercambiables, así que se cuentan
// como multiconjuntos; las claves de una co-oferta cuentan como una materia.

import { nombreCompleto, natural } from './mallaVista';

export function fechaVersion(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

const huellaDe = (v) => v.departamentos.map((d) => `${d.departamento_id}:${d.huella}`).join('|');

/**
 * La lista de api/malla-versiones.php (de la más nueva a la más vieja), con las
 * subidas seguidas que dejaron la misma malla juntas en una:
 * [{ corrida_id, subido_at, subido_por, veces, departamentos }]. corrida_id es
 * la más vieja del grupo (la primera vez que salió esa malla).
 */
export function agruparVersiones(versiones) {
  const out = [];
  for (const v of versiones) {
    const prev = out[out.length - 1];
    if (prev && huellaDe(prev) === huellaDe(v)) {
      prev.veces++;
      prev.corrida_id = v.corrida_id;
      prev.subido_at = v.subido_at;
      prev.subido_por = v.subido_por;
      // La preferida puede estar en cualquiera de las repetidas.
      prev.departamentos = prev.departamentos.map((d, i) => (d.preferida ? d : { ...d, preferida: v.departamentos[i].preferida }));
    } else {
      out.push({ ...v, veces: 1 });
    }
  }
  return out;
}

export const etiquetaVersion = (v) =>
  fechaVersion(v.subido_at) + (v.veces > 1 ? ` · subida ${v.veces} veces` : '') +
  (v.departamentos.some((d) => d.preferida) ? ' · preferida' : '');

/** materia_id -> la más chica de su componente de co-oferta: las claves de una clase compartida son una materia. */
function familias(materias) {
  const padre = {};
  const raiz = (x) => { while (padre[x] !== x) x = padre[x] = padre[padre[x]]; return x; };
  for (const m of materias) padre[m.id] = m.id;
  for (const m of materias) for (const o of m.co_oferta || []) {
    if (padre[o] === undefined) continue;
    const a = raiz(m.id), b = raiz(o);
    if (a !== b) padre[Math.max(a, b)] = Math.min(a, b);
  }
  return (mid) => (padre[mid] === undefined ? mid : raiz(mid));
}

const contar = (lista) => lista.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
const comunes = (a, b) => { let n = 0; for (const [k, c] of a) n += Math.min(c, b.get(k) || 0); return n; };
const firma = (g) => g.sesiones.map((s) => `${s.dia} ${s.inicio} ${s.bloques}`).sort().join(', ');

/**
 * La versión `antes` contra la malla `ahora` (las dos, grupos en el formato de la salida):
 *   pares      { iguales, total }  pares profesor-materia de la versión que siguen en la actual
 *   identicos  { iguales, total }  grupos de la versión con el mismo profesor, materia y horario
 *   cambios    [{ profesor, antes: [materias], ahora: [materias] }]  los profesores cuyas materias cambian
 * Un grupo sin profesor no cuenta en los pares.
 */
export function compararMallas(entrada, antes, ahora) {
  const fam = familias(entrada.materias);
  const nomMat = Object.fromEntries(entrada.materias.map((m) => [m.id, m.nombre]));
  const nomProf = Object.fromEntries(entrada.profesores.map((p) => [p.id, nombreCompleto(p.nombre)]));
  const familia = (g) => Math.min(...g.materias.map((m) => fam(m.materia_id)));
  const pares = (gs) => contar(gs.flatMap((g) => g.profesores.map((p) => `${familia(g)}|${p}`)));
  const grupos = (gs) => contar(gs.map((g) => `${familia(g)}|${[...g.profesores].sort().join(',')}|${firma(g)}`));
  const pa = pares(antes), pb = pares(ahora);
  const ga = grupos(antes), gb = grupos(ahora);

  const porProfesor = (gs) => {
    const m = new Map();
    for (const g of gs) for (const p of g.profesores) (m.get(p) || m.set(p, []).get(p)).push(nomMat[familia(g)] || `materia ${familia(g)}`);
    return m;
  };
  const xa = porProfesor(antes), xb = porProfesor(ahora);
  const cambios = [];
  for (const p of new Set([...xa.keys(), ...xb.keys()])) {
    const a = (xa.get(p) || []).sort(natural), b = (xb.get(p) || []).sort(natural);
    if (a.join('|') !== b.join('|') && nomProf[p]) cambios.push({ profesor: nomProf[p], antes: a, ahora: b });
  }
  cambios.sort((x, y) => natural(x.profesor, y.profesor));

  return {
    pares: { iguales: comunes(pa, pb), total: [...pa.values()].reduce((s, c) => s + c, 0) },
    identicos: { iguales: comunes(ga, gb), total: antes.length },
    cambios,
  };
}
