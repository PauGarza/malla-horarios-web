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

Los `.sql` ya corrieron contra la base real y el backend de autenticación (`../backend/`) está
desplegado y en uso. A partir de 2026-09-24 hay datos reales cargados: un departamento completo
(catálogo de materias, co-ofertas y roster de profesores) y el cuestionario de preferencias
configurado para el siguiente semestre.

## Esta es una copia

El original de estos archivos vive fuera de este repo, junto con los `.sql` de datos reales
(nombres y claves únicas de profesores) que **a propósito no se publican aquí**. Esta copia se
mantiene para que el equipo pueda leer el diseño y levantar una base propia sin acceso a la
instancia real.

Si cambias el esquema, hazlo en el original y vuelve a sincronizar aquí — no al revés. Mantener
dos copias con la misma autoridad ya causó un problema real: la política `jefe_preferencia_reapertura`
y su trigger existían solo en la base en vivo y no en ningún `.sql`, así que levantar la base desde
cero dejaba sin funcionar el botón de reabrir formularios. Se detectó y versionó el 2026-09-24.
