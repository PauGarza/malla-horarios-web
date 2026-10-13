// El número de cursos de un profesor para la jefatura: el que pidió él
// (preferencia.num_cursos_max) o el que puso la jefatura encima
// (ajuste_num_cursos, respuestas.php?recurso=num_cursos). El componente que lo
// pinta con su marcador es components/NumCursos.jsx.

/** El número que cuenta: el de la jefatura si lo hay, si no el del profesor. */
export const numCursosEfectivo = (p) => (p.ajuste_cursos ? p.ajuste_cursos.num_cursos : p.num_cursos_max);

// ajustado_at llega en UTC como 'YYYY-MM-DD HH:MM:SS'.
function fechaLocal(at) {
  const d = new Date(`${at.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime())
    ? at
    : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Texto largo del ajuste, para el title y para lectores de pantalla. */
export function descripcionAjuste(p) {
  if (!p.ajuste_cursos) return null;
  const { num_cursos: n, por, at } = p.ajuste_cursos;
  const pidio = p.num_cursos_max === null ? 'no indicó cuántos' : `pidió ${p.num_cursos_max}`;
  return `Ajustado por jefatura a ${n} (el profesor ${pidio}). ${por ?? 'Jefatura'}, ${fechaLocal(at)}.`;
}
