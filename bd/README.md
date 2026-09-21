# bd — diseño de base de datos

Copia de trabajo del diseño de base de datos de Autoplanear, pensada para el equipo — en particular
para quien construya el motor de asignación (profesores–horarios–salones).

## Empieza aquí

- **¿Vas a construir el algoritmo de asignación?** Lee [`motor-asignacion.md`](motor-asignacion.md)
  primero — resume exactamente qué tablas leer, qué escribir, y qué reglas hay que respetar. No hace
  falta leer todo `diseno-bd.md` para empezar.
- **¿Necesitas el detalle completo de una tabla** (columnas, tipos, por qué existe)?
  [`diseno-bd.md`](diseno-bd.md).
- **¿Prefieres verlo como diagrama?** [`diagrama-er.md`](diagrama-er.md) (Mermaid, se renderiza en
  GitHub/VS Code directo).
- **¿Vas a levantar la base de datos?** `schema.sql` → `triggers.sql` → `rls-policies.sql` →
  `seed.sql`, en ese orden.

## Estado

Ninguno de los `.sql` se ha corrido todavía contra un proyecto real. El backend de autenticación
(`../backend/`) tampoco se ha desplegado ni probado.
