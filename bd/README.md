# bd — diseño de base de datos

Copia de trabajo del diseño de base de datos de Autoplanear, pensada para el equipo — en particular
para quien construya el motor de asignación (profesores–horarios–salones).

## Empieza aquí

- **¿Vas a construir el algoritmo de asignación?** Lee [`motor-asignacion.md`](motor-asignacion.md)
  primero — resume exactamente qué tablas leer, qué escribir, y qué reglas hay que respetar. No hace
  falta leer todo `diseno-bd.md` para empezar.
- **¿Necesitas el detalle completo de una tabla** (columnas, tipos, por qué existe)?
  [`diseno-bd.md`](diseno-bd.md). Los cambios más recientes están en sus §14 (migración a MySQL) y
  §15 (2026-10-02 y 2026-10-06).
- **¿Prefieres verlo como diagrama?** [`diagrama-er.md`](diagrama-er.md) (Mermaid, se renderiza en
  GitHub/VS Code directo).
- **¿Vas a levantar la base de datos?** Usa la de MySQL: [`mysql/README.md`](mysql/README.md) tiene el
  orden de carga, las migraciones y los datos reales.

## Estado

Desde el 2026-09-25 la base que corre es **MariaDB 5.5 en `horariosdace.itam.mx`**, con el API en PHP
de `../api/` (ya no Supabase ni GitHub Pages). Hay datos reales cargados: catálogos de Matemáticas y
Estadística, roster de profesores y los formularios del semestre activo. Los `.sql` de Postgres de
esta carpeta (`schema.sql`, `triggers.sql`, `rls-policies.sql`, `seed.sql`) son el diseño original y
quedan como histórico; no incluyen los cambios del 2026-10-02 en adelante.

## Esta es una copia

El original de estos archivos vive fuera de este repo, junto con los `.sql` de datos reales
(nombres y claves únicas de profesores) que **a propósito no se publican aquí**. Esta copia se
mantiene para que el equipo pueda leer el diseño y levantar una base propia sin acceso a la
instancia real.

Si cambias el esquema, hazlo en el original y vuelve a sincronizar aquí — no al revés. Mantener
dos copias con la misma autoridad ya causó un problema real: la política `jefe_preferencia_reapertura`
y su trigger existían solo en la base en vivo y no en ningún `.sql`, así que levantar la base desde
cero dejaba sin funcionar el botón de reabrir formularios. Se detectó y versionó el 2026-09-24.
