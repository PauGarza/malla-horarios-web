// Satisfacción de cada profesor con lo que le tocó en la malla
// (pages/ReporteSatisfaccion.jsx), con los datos de api/malla.php. Fórmula v1
// de DACE/DISENO-REPORTES.md §2: la escala del motor (verde 1, amarillo 0,
// rojo −1), pero en promedio en vez de suma, para comparar profesores con
// carga distinta.
//
//   S = 0.625 · promedio por bloque del horario + 0.375 · promedio por grupo de la materia
//
// Los cursos (tiene / pidió) y las horas que no están en verde por una
// asignación directa de la jefatura se informan aparte y no mueven S. Cuando
// el historial por semestre (§3) se guarde en la base, el servidor tiene que
// calcular lo mismo: si cambia algo aquí, cambia VERSION.

export const VERSION = 'v1-2026-10-28';
export const PESOS = { horario: 0.625, materia: 0.375 };
const VALOR = { verde: 1, amarillo: 0, rojo: -1 };
const NIVELES = ['verde', 'amarillo', 'rojo'];
const ORDEN = { verde: 3, amarillo: 2, rojo: 1 };

const conteo = () => ({ verde: 0, amarillo: 0, rojo: 0 });
const promedio = (c) => {
  const n = c.verde + c.amarillo + c.rojo;
  return n ? NIVELES.reduce((t, k) => t + VALOR[k] * c[k], 0) / n : null;
};

/**
 * [{ departamento, profesores }] en el orden de entrada.departamentos, solo
 * los del alcance. Cada profesor:
 *   { id, nombre, contrato, s, horario (horas verde/amarillo/rojo),
 *     materia (grupos verde/amarillo/rojo), porAsignacion (horas que no están
 *     en verde por una asignación directa),
 *     cursos, pidio, sinFormulario, borrador, materiasNoVerdes: [clave nivel],
 *     otroDepto: [claves de lo que da en la programación de otro departamento] }
 * s es null si no tiene cursos. Ordenados del peor al mejor; sin cursos al
 * principio (salvo quien pidió 0).
 */
export function calcularSatisfaccion(datos) {
  const ent = datos.entrada;
  const alcance = new Set((ent.alcance && ent.alcance.departamentos) || ent.departamentos.map((d) => d.id));
  const franjas = [...ent.rejilla.franjas].sort((a, b) => a.orden - b.orden);
  const pos = Object.fromEntries(franjas.map((f, i) => [f.inicio, i]));
  const mins = (ent.reglas && ent.reglas.minutos_por_bloque) || 30;
  // Una hora sin contestar cuenta como dice la regla del semestre (la malla
  // usa la misma, por omisión rojo)
  const sinComo = (ent.reglas && ent.reglas.sin_respuesta_cuenta_como) || 'rojo';
  const asignaciones = Object.fromEntries((ent.asignaciones_fijas || []).map((a) => [a.id, a]));

  const P = {};
  for (const p of ent.profesores) {
    if (!alcance.has(p.departamento_id)) continue;
    const pidio = p.preferencia ? (p.preferencia.num_cursos_max ?? null) : null;
    P[p.id] = {
      p,
      horario: conteo(),
      materia: conteo(),
      porAsignacion: conteo(),
      cursos: 0,
      pidio,
      materiasNoVerdes: [],
      otroDepto: [],
    };
  }
  const deptoDe = Object.fromEntries(ent.materias.map((m) => [m.id, m.departamento_id]));
  const nivelHora = (p, dia, inicio) => {
    if (((p.maestria || {})[dia] || []).includes(inicio)) return 'rojo';
    return ((p.disponibilidad || {})[dia] || {})[inicio] || sinComo;
  };

  const todos = [
    ...(ent.grupos_fijos || []).map((g) => ({ g, publicado: true })),
    ...datos.grupos.map((g) => ({ g, publicado: false })),
  ];
  for (const { g, publicado } of todos) {
    const a = g.asignacion_fija_id != null ? asignaciones[g.asignacion_fija_id] : null;
    for (const pid of g.profesores || []) {
      const x = P[pid];
      if (!x) continue;
      // Un publicado sin ninguna clave de su departamento es la programación
      // de otro (Actuaría, D45): no lo decidió este proceso ni cuenta como
      // curso suyo (como en motor.php). Se informa y ya.
      if (publicado && !g.materias.some((m) => deptoDe[m.materia_id] === x.p.departamento_id)) {
        x.otroDepto.push(g.materias.map((m) => m.clave).join(' / '));
        continue;
      }
      x.cursos++;
      // Lo que la jefatura le fijó a este profesor manda sobre su
      // disponibilidad (salvo la maestría): se informa, no baja S
      const fijado = a && a.profesor_id === pid;
      for (const se of g.sesiones || []) {
        for (let k = 0; k < se.bloques; k++) {
          const f = franjas[pos[se.inicio] + k];
          if (!f) continue;
          const maestria = ((x.p.maestria || {})[se.dia] || []).includes(f.inicio);
          const n = nivelHora(x.p, se.dia, f.inicio);
          if (fijado && n !== 'verde' && !maestria) x.porAsignacion[n]++;
          else x.horario[n]++;
        }
      }
      // Una clase compartida cuenta con la mejor de sus claves: si marcó una
      // de las equivalentes, es la clase que pidió
      const niveles = g.materias.map((m) => ({ clave: m.clave, n: (x.p.materias || {})[String(m.materia_id)] || null }));
      const mejor = niveles.reduce((b, c) => ((ORDEN[c.n] || 0) > (ORDEN[b.n] || 0) ? c : b), niveles[0]);
      const n = mejor.n || 'amarillo'; // sin marcar: ni la pidió ni la rechazó
      x.materia[n]++;
      if (n !== 'verde') x.materiasNoVerdes.push(`${mejor.clave} ${mejor.n ? 'en ' + mejor.n : 'sin marcar'}`);
    }
  }

  // De bloques a horas (el promedio no cambia: es la misma escala)
  const enHoras = (c) => Object.fromEntries(NIVELES.map((k) => [k, (c[k] * mins) / 60]));
  const filas = Object.values(P).map((x) => {
    const sh = promedio(x.horario);
    const sm = promedio(x.materia);
    let s = null;
    if (x.cursos) s = sh == null ? sm : PESOS.horario * sh + PESOS.materia * sm;
    return {
      id: x.p.id,
      nombre: x.p.nombre,
      departamentoId: x.p.departamento_id,
      contrato: x.p.tipo_contrato,
      s,
      horario: enHoras(x.horario),
      materia: x.materia,
      porAsignacion: enHoras(x.porAsignacion),
      cursos: x.cursos,
      pidio: x.pidio,
      sinFormulario: !x.p.disponibilidad || !Object.keys(x.p.disponibilidad).length,
      borrador: !!(x.p.preferencia && x.p.preferencia.estado === 'borrador'),
      materiasNoVerdes: x.materiasNoVerdes,
      otroDepto: x.otroDepto,
    };
  });

  // Peor primero: quien pidió cursos y no tiene ninguno, luego por S
  const clave = (f) => (f.s != null ? f.s : f.pidio === 0 ? 2 : -2);
  filas.sort((a, b) => clave(a) - clave(b) || a.nombre.localeCompare(b.nombre, 'es'));
  return ent.departamentos
    .filter((d) => alcance.has(d.id))
    .map((d) => ({ departamento: d, profesores: filas.filter((f) => f.departamentoId === d.id) }))
    .filter((sec) => sec.profesores.length);
}
