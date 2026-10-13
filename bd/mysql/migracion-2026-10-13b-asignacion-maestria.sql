-- =============================================================================
-- Migración 2026-10-13 (b) — "Materia de Maestría" en las asignaciones fijas
--
-- Los profesores también dan materias de maestría (MCD, MR, …) que no están en
-- las listas del departamento. La jefatura las fija para APARTAR ese horario:
-- el motor no le pone nada al profesor en esas horas, como si las hubiera
-- marcado en rojo. Y NO cuentan como curso: si pidió 1 curso y tiene una de
-- maestría, el motor todavía le asigna 1.
--
-- No es una fila "dummy" en materia a propósito: una materia sin fila en
-- materia_cuestionario aparece por omisión en el formulario de todos los
-- profesores (fail-open), y además saldría en el catálogo, la demanda y los
-- reportes. Es un tipo de asignación fija:
--   tipo = 'materia'   -> como hasta ahora: materia_id obligatorio.
--   tipo = 'maestria'  -> materia_id NULL; el horario es obligatorio (es lo que
--                         aparta) y no está atado a créditos. Qué materia es,
--                         si se quiere anotar, va en nota.
-- Como materia_id puede faltar, el departamento de la asignación pasa a ser
-- columna propia (antes salía de la materia).
--
-- Correr DESPUÉS de migracion-2026-10-13-asignaciones-fijas.sql y ANTES de
-- `npm run deploy:api` (el API nuevo lee tipo y departamento_id).
-- MariaDB 5.5 no tiene ADD COLUMN IF NOT EXISTS: correr UNA sola vez.
-- La regla "tipo materia <=> materia_id no nulo" la valida api/asignaciones.php.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

ALTER TABLE asignacion_fija
  ADD COLUMN tipo ENUM('materia','maestria') NOT NULL DEFAULT 'materia'
      COMMENT 'maestria = aparta horario del profesor; no es curso ni grupo del departamento.' AFTER semestre_id,
  ADD COLUMN departamento_id INT NULL AFTER tipo,
  MODIFY materia_id INT NULL COMMENT 'NULL solo con tipo = maestria.';

-- Las que ya existan son todas de tipo materia: su departamento es el de la materia.
UPDATE asignacion_fija af
  JOIN materia m ON m.id = af.materia_id
   SET af.departamento_id = m.departamento_id;

ALTER TABLE asignacion_fija
  MODIFY departamento_id INT NOT NULL,
  ADD KEY idx_af_departamento (departamento_id),
  ADD CONSTRAINT fk_af_departamento FOREIGN KEY (departamento_id) REFERENCES departamento(id);

-- Verificación: tipo, departamento_id NOT NULL y materia_id que acepta NULL.
SHOW COLUMNS FROM asignacion_fija;
