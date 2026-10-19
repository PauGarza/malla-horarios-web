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

/**
 * El cuestionario que le mandaría cuestionario.php a un profesor de ese
 * contrato, armado aquí a partir del formulario completo del editor
 * (configuracion.php). Lo usa el formulario de prueba del admin, que no tiene
 * departamento ni contrato propios. Ignora si está publicado: probar uno sin
 * publicar es justo lo útil.
 */
export function cuestionarioParaContrato(formularioCompleto, tipoContrato) {
  return {
    publicado: true,
    texto_introduccion: formularioCompleto.texto_introduccion,
    ratio_horas_verde: tipoContrato === 'asignatura' ? 1 : formularioCompleto.ratio_horas_verde,
    secciones: vistaParaContrato(formularioCompleto.secciones, tipoContrato),
  };
}

/** El mínimo real de una sección: no se puede exigir más de las que hay. */
export const minimoEfectivo = (seccion) =>
  seccion.minimo_verdes == null ? 0 : Math.min(seccion.minimo_verdes, seccion.materias.length);

/**
 * El mínimo de horas en verde de la rejilla (2026-10-13). Espejo de
 * horas_minimas_verde() en api/lib/catalogo.php:
 *
 *   base   = 3 h por curso que pidió + lo que su verde más larga pase de 3 h
 *            (una de 8 créditos: +1), una sola vez
 *   mínimo = base × ratio, hacia arriba a la media hora
 *
 * Devuelve el desglose para poder explicárselo al profesor. Las cuentas van en
 * medias horas y centésimas: con flotantes, el redondeo hacia arriba fallaría.
 */
export function horasMinimasVerde({ numCursos, secciones, niveles, ratio }) {
  let extraMedias = 0;
  for (const s of secciones) {
    if (s.tipo !== 'materias') continue;
    for (const m of s.materias) {
      // 1 crédito = 1 bloque de media hora; 3 h = 6 bloques.
      if (niveles[m.id] === 'verde') extraMedias = Math.max(extraMedias, (m.creditos ?? 0) - 6);
    }
  }
  const baseMedias = 6 * Math.max(numCursos || 0, 0) + extraMedias;
  const centesimas = Math.round(ratio * 100);
  return {
    base: baseMedias / 2,
    extra: extraMedias / 2,
    minimo: Math.ceil((baseMedias * centesimas) / 100) / 2,
  };
}

/** "1.5" y no "1.50"; "2" y no "2.00". */
export const formatearRatio = (r) => String(Number(r));

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

/**
 * Las franjas que ve un departamento: las de todos (departamento_id null) más
 * las suyas (2026-10-06: 20:00-22:00 solo Estadística).
 */
export function franjasDeDepartamento(franjas, departamentoId) {
  return franjas.filter((f) => f.departamento_id == null || f.departamento_id === departamentoId);
}
