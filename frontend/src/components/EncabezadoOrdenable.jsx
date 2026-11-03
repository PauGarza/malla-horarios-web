// Encabezados de tabla que ordenan al hacer clic (reportes de preferencias y de
// satisfacción). `orden` es { columna, asc }; quien los usa decide qué hacer
// con onOrdenar(columna), normalmente invertir si ya era esa columna.

/** El botón con la flecha, para cuando un mismo <th> tiene varias columnas. */
export function BotonOrden({ columna, orden, onOrdenar, children, className = '' }) {
  const activo = orden.columna === columna;
  return (
    <button type="button" className={className} onClick={() => onOrdenar(columna)}>
      {children}
      <span className="orden-flecha" aria-hidden="true">
        {activo ? (orden.asc ? '▲' : '▼') : ''}
      </span>
    </button>
  );
}

/** <th> que ordena por alguna de `columnas` (sus BotonOrden van dentro). */
export function ThOrdenable({ columnas, orden, className = '', children, ...resto }) {
  const activo = columnas.includes(orden.columna);
  return (
    <th
      className={`th-ordenable ${className}`}
      aria-sort={activo ? (orden.asc ? 'ascending' : 'descending') : 'none'}
      {...resto}
    >
      {children}
    </th>
  );
}

export default function EncabezadoOrdenable({ columna, orden, onOrdenar, children, ...resto }) {
  return (
    <ThOrdenable columnas={[columna]} orden={orden} {...resto}>
      <BotonOrden columna={columna} orden={orden} onOrdenar={onOrdenar}>
        {children}
      </BotonOrden>
    </ThOrdenable>
  );
}
