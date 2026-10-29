// Los renglones del reporte de horarios (pages/ReporteHorarios.jsx), con los
// datos de api/malla.php: los grupos publicados (entrada.grupos_fijos) y los
// que están en revisión (grupos). Diseño en DACE/DISENO-REPORTES.md §1.
//
// Como el max-min de Servicios Escolares: un renglón por grupo, y una clase
// compartida (co-oferta) sale bajo cada una de sus claves, en el departamento
// de esa clave, con la nota de con quién se comparte.

import { DIA_CORTO, hm, natural, nombreCompleto } from './mallaVista';

export { nombreCompleto };

/**
 * [{ departamento: { id, nombre }, renglones, pendientes }] en el orden de
 * entrada.departamentos, solo los del alcance y solo los que tienen grupos.
 *
 * renglón: { key, grupo, materia, semestre, horario: [{ dias, horas }],
 *            salon, cupo, profesores, contratos, compartido, publicado, pendiente }
 * contratos: los tipo_contrato de sus profesores, para filtrar por contrato.
 */
export function armarReporte(datos) {
  const ent = datos.entrada;
  const alcance = new Set((ent.alcance && ent.alcance.departamentos) || ent.departamentos.map((d) => d.id));
  const mats = Object.fromEntries(ent.materias.map((m) => [m.id, m]));
  const profs = Object.fromEntries(ent.profesores.map((p) => [p.id, p]));
  const salones = Object.fromEntries((ent.salones || []).map((s) => [s.id, s]));
  const deptos = Object.fromEntries(ent.departamentos.map((d) => [d.id, d]));
  const franjas = [...ent.rejilla.franjas].sort((a, b) => a.orden - b.orden);
  const pos = Object.fromEntries(franjas.map((f, i) => [f.inicio, i]));
  const ordenDia = Object.fromEntries(ent.rejilla.dias.map((d, i) => [d, i]));

  const fin = (se) => (franjas[pos[se.inicio] + se.bloques - 1] || {}).fin;
  // "Lun Mié 7:00–8:30", una línea por cada hora distinta
  const horario = (sesiones) => {
    const por = new Map();
    for (const se of [...sesiones].sort((a, b) => ordenDia[a.dia] - ordenDia[b.dia])) {
      const f = fin(se);
      const horas = hm(se.inicio) + '–' + (f ? hm(f) : '?');
      if (!por.has(horas)) por.set(horas, []);
      por.get(horas).push(DIA_CORTO[se.dia] || se.dia);
    }
    return [...por].map(([horas, dias]) => ({ dias: dias.join(' '), horas }));
  };
  const salonDe = (g) => {
    const ids = new Set((g.sesiones || []).map((se) => (se.salon_id !== undefined ? se.salon_id : g.salon_id)));
    if (!ids.size) ids.add(g.salon_id ?? null);
    return [...ids].map((id) => (id != null && salones[id] ? salones[id].nombre : 'Sin salón')).join(' / ');
  };
  // El semestre de la clave en sus planes vigentes ("3", "4–7"); si no está en
  // ninguno vigente, en los anteriores (como la tarjeta de la malla)
  const semestreDe = (m) => {
    const planes = ((m && m.planes) || []).filter((p) => p.semestre_plan);
    const vig = planes.filter((p) => p.vigente ?? true);
    const ss = new Set((vig.length ? vig : planes).map((p) => p.semestre_plan));
    if (!ss.size) return '';
    const a = Math.min(...ss), b = Math.max(...ss);
    return a === b ? String(a) : `${a}–${b}`;
  };
  const etiqueta = (x) => x.clave + (x.numero ? '-' + x.numero : '');

  const porDepto = new Map();
  const todos = [
    ...(ent.grupos_fijos || []).map((g) => ({ g, publicado: true })),
    ...datos.grupos.map((g) => ({ g, publicado: false })),
  ];
  for (const { g, publicado } of todos) {
    const sesiones = g.sesiones || [];
    const conCuenta = (g.profesores || []).filter((id) => profs[id]);
    const nombres = conCuenta.map((id) => nombreCompleto(profs[id].nombre));
    const contratos = [...new Set(conCuenta.map((id) => profs[id].tipo_contrato).filter(Boolean))];
    for (const x of g.materias) {
      const m = mats[x.materia_id];
      const dep = m ? m.departamento_id : null;
      if (!alcance.has(dep)) continue;
      // Un publicado sin profesores es la programación de otro departamento
      // (Actuaría, D45): sus profesores no tienen cuenta y no vienen.
      const sinProfesor = !nombres.length;
      const profesores = !sinProfesor
        ? nombres.join(' / ')
        : publicado
          ? 'Programación de ' + ((deptos[dep] || {}).nombre || 'otro departamento')
          : 'Sin profesor';
      const faltan = publicado ? [] : [sinProfesor && 'sin profesor', !sesiones.length && 'sin horario'].filter(Boolean);
      if (!porDepto.has(dep)) porDepto.set(dep, []);
      porDepto.get(dep).push({
        key: (g.ref ?? g.grupo_id) + '|' + x.materia_id,
        clave: x.clave,
        numero: x.numero || '',
        grupo: etiqueta(x),
        materia: m ? m.nombre : x.clave,
        semestre: semestreDe(m),
        horario: sesiones.length ? horario(sesiones) : [],
        salon: sesiones.length ? salonDe(g) : '',
        cupo: g.cupo_maximo ?? null,
        profesores,
        contratos,
        sinProfesor: sinProfesor && !publicado,
        compartido: g.materias.filter((y) => y !== x).map(etiqueta),
        publicado,
        faltan,
      });
    }
  }

  return ent.departamentos
    .filter((d) => alcance.has(d.id) && porDepto.has(d.id))
    .map((d) => {
      const renglones = porDepto.get(d.id).sort((a, b) => natural(a.clave, b.clave) || natural(a.numero, b.numero));
      return { departamento: d, renglones, pendientes: renglones.filter((r) => r.faltan.length) };
    });
}
