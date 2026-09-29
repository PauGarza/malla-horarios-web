// Reglas del formulario que se usan en más de una pantalla. Son espejo de
// api/lib/catalogo.php: la pantalla las usa para avisar antes de mandar, pero
// quien decide es el servidor.

export const AUDIENCIAS = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'tiempo_completo_medio', etiqueta: 'Tiempo completo y medio tiempo' },
  { valor: 'asignatura', etiqueta: 'Asignatura' },
];

export function audienciaAplica(audiencia, tipoContrato) {
  if (audiencia === 'todos') return true;
  if (audiencia === 'tiempo_completo_medio') {
    return tipoContrato === 'tiempo_completo' || tipoContrato === 'medio_tiempo';
  }
  return tipoContrato === 'asignatura';
}

/**
 * El formulario tal como lo vería alguien con ese contrato. Misma regla que
 * cuestionario_de(): las secciones que no le aplican desaparecen, pero sus
 * materias se agregan al final de su primera sección de materias visible.
 * La usa la vista previa del editor; el profesor recibe esto ya resuelto.
 */
export function vistaParaContrato(secciones, tipoContrato) {
  const visibles = [];
  const huerfanas = [];
  let primeraMaterias = -1;
  for (const s of secciones) {
    if (!audienciaAplica(s.audiencia, tipoContrato)) {
      if (s.tipo === 'materias') huerfanas.push(...s.materias);
      continue;
    }
    if (s.tipo === 'materias' && primeraMaterias === -1) primeraMaterias = visibles.length;
    visibles.push(s);
  }
  if (primeraMaterias !== -1 && huerfanas.length > 0) {
    visibles[primeraMaterias] = {
      ...visibles[primeraMaterias],
      materias: [...visibles[primeraMaterias].materias, ...huerfanas],
    };
  }
  return visibles.filter((s) => s.tipo !== 'materias' || s.materias.length > 0);
}

/** El mínimo real de una sección: no se puede exigir más de las que hay. */
export const minimoEfectivo = (seccion) =>
  seccion.minimo_verdes == null ? 0 : Math.min(seccion.minimo_verdes, seccion.materias.length);

/** Lo que le falta a un formulario para poder enviarse. Espejo de faltantes_para_enviar(). */
export function faltantesParaEnviar({ secciones, horasMinimasVerde, niveles, respuestas, horasVerde }) {
  const faltantes = [];
  for (const s of secciones) {
    if (s.tipo === 'materias') {
      const minimo = minimoEfectivo(s);
      const verdes = s.materias.filter((m) => niveles[m.id] === 'verde').length;
      if (verdes < minimo) faltantes.push(`${minimo} materias en verde en "${s.titulo}" (llevas ${verdes})`);
    }
    if (s.tipo === 'abierta' && s.obligatoria && !(respuestas[s.id] ?? '').trim()) {
      faltantes.push(`responder "${s.titulo}"`);
    }
  }
  if (horasVerde < horasMinimasVerde) {
    faltantes.push(`${horasMinimasVerde} hrs en verde de disponibilidad (llevas ${horasVerde})`);
  }
  return faltantes;
}

// Días y clave de celda de la rejilla de disponibilidad.
export const DIAS = [
  { valor: 'lunes', etiqueta: 'Lun' },
  { valor: 'martes', etiqueta: 'Mar' },
  { valor: 'miercoles', etiqueta: 'Mié' },
  { valor: 'jueves', etiqueta: 'Jue' },
  { valor: 'viernes', etiqueta: 'Vie' },
];

export function claveDisponibilidad(dia, franjaId) {
  return `${dia}-${franjaId}`;
}
