-- =============================================================================
-- Migración 2026-10-13 (c) — el mínimo de horas en verde sale de los cursos
--
-- Antes el mínimo de horas en verde de la rejilla de disponibilidad era un
-- número fijo por departamento/semestre (horas_minimas_verde, 10 por omisión),
-- igual para todos los contratos. Desde ahora se calcula con lo que contesta
-- cada profesor (ver horas_minimas_verde() en api/lib/catalogo.php):
--
--     base   = 3 h por cada curso que pidió (num_cursos_max)
--            + 1 h si alguna materia que marcó en VERDE es de 8 créditos
--              (en general: lo que la verde más larga pase de 3 h)
--     mínimo = base × ratio, redondeado hacia arriba a la media hora
--
-- El ratio lo pone la jefatura en el editor del formulario y aplica a tiempo
-- completo y medio tiempo; asignatura siempre lleva ratio 1. Las amarillas no
-- cuentan. Esta migración:
--   1. agrega departamento_semestre_config.ratio_horas_verde (1.00 por
--      omisión: el mismo mínimo que asignatura hasta que la jefatura lo suba);
--   2. deja horas_minimas_verde como OBSOLETA (ya no se lee ni se escribe; se
--      conserva para no perder lo que hubo);
--   3. vuelve a poner la pregunta "Número de cursos" en los formularios del
--      semestre activo que no la tengan: deja de ser opcional (deshace la
--      migración 2026-10-02 (b) en el API; la columna num_cursos_max sigue
--      aceptando NULL por las preferencias viejas).
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API
-- nuevo y sin la columna, configuracion.php, cuestionario.php y preferencia.php
-- dan 500 (las tres leen ratio_horas_verde).
-- MariaDB 5.5 no tiene ADD COLUMN IF NOT EXISTS: correr UNA sola vez. El paso 3
-- sí es idempotente.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

ALTER TABLE departamento_semestre_config
  ADD COLUMN ratio_horas_verde DECIMAL(4,2) NOT NULL DEFAULT 1.00
      COMMENT 'Tiempo completo y medio tiempo: minimo de horas en verde = horas de sus cursos x ratio. Asignatura = 1. 1.00-5.00, se valida en PHP.'
      AFTER horas_minimas_verde,
  MODIFY horas_minimas_verde DECIMAL(5,2) NOT NULL DEFAULT 10
      COMMENT 'OBSOLETA desde 2026-10-13: el minimo sale de los cursos del profesor x ratio_horas_verde. No se lee.';

-- 3. "Número de cursos" en todo formulario del semestre activo que no la tenga.
-- orden 0 la pone arriba de todo, donde va en la plantilla.
INSERT INTO cuestionario_seccion
        (departamento_id, semestre_id, tipo, titulo, descripcion, audiencia,
         minimo_verdes, cobertura_departamental, obligatoria, orden)
SELECT cs.departamento_id, cs.semestre_id, 'num_cursos',
       '¿Cuántos cursos puedes impartir este semestre?', NULL, 'todos', NULL, 0, 0, 0
  FROM cuestionario_seccion cs
  JOIN semestre s ON s.id = cs.semestre_id AND s.estado = 'activo'
 GROUP BY cs.departamento_id, cs.semestre_id
HAVING SUM(cs.tipo = 'num_cursos' AND cs.activa = 1) = 0;

-- Verificación: una fila por departamento con formulario en el semestre
-- activo, y en todas con_num_cursos = 1.
SELECT cs.departamento_id, cs.semestre_id,
       SUM(cs.tipo = 'num_cursos' AND cs.activa = 1) AS con_num_cursos
  FROM cuestionario_seccion cs
  JOIN semestre s ON s.id = cs.semestre_id AND s.estado = 'activo'
 GROUP BY cs.departamento_id, cs.semestre_id;
SHOW COLUMNS FROM departamento_semestre_config LIKE 'ratio_horas_verde';
