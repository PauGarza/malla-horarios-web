// El número de cursos de un profesor tal como lo ve la jefatura: el que pidió
// él (preferencia.num_cursos_max) o, si la jefatura lo sobreescribió, el de
// ajuste_num_cursos con un marcador. Solo vistas de jefatura: el profesor
// nunca ve el ajuste.

import { descripcionAjuste } from '../lib/numCursos';

/**
 * Sin ajuste: el número del profesor (o — si no contestó esa pregunta).
 * Con ajuste: el de la jefatura con el marcador, y el del profesor tachado al
 * lado si había uno distinto.
 */
export function ValorNumCursos({ profesor: p }) {
  if (!p.ajuste_cursos) return <>{p.num_cursos_max ?? '—'}</>;
  const { num_cursos: n } = p.ajuste_cursos;
  const descripcion = descripcionAjuste(p);
  return (
    <span className="cursos-ajustado" title={descripcion}>
      {p.num_cursos_max !== null && p.num_cursos_max !== n && (
        <s className="cursos-original" aria-hidden="true">
          {p.num_cursos_max}
        </s>
      )}
      <span aria-hidden="true">{n}</span>
      <span className="cursos-marcador" aria-hidden="true">
        J
      </span>
      <span className="visually-hidden">{descripcion}</span>
    </span>
  );
}
