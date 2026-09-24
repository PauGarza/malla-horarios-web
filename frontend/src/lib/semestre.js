// semestre.etiqueta es una columna generada en la base y viene como slug
// ('primavera-2027'), que sirve para comparar pero no para enseñárselo a un
// profesor. Esto lo convierte en el nombre de verdad.
const NOMBRES = {
  primavera: 'Primavera',
  verano: 'Verano',
  otono: 'Otoño',
};

export function etiquetaSemestre(semestre) {
  if (!semestre) return '';
  const nombre = NOMBRES[semestre.tipo];
  // Si algún día se agrega un tipo nuevo al enum y nadie actualizó esta tabla,
  // es mejor caer al slug que dejar el encabezado vacío.
  if (!nombre) return semestre.etiqueta ?? '';
  return `${nombre} ${semestre.anio}`;
}
