-- =============================================================================
-- Migracion 2026-09-28 (2 de 2) — limpieza
--
-- Correr DESPUES de migracion-2026-09-28-formulario-editable.sql Y DESPUES de
-- desplegar el API nuevo: el API anterior lee las tres cosas que se borran
-- aqui, asi que correr esto antes lo tumba.
--
-- 1. La personalizacion de materias por profesor desaparece por decision de la
--    jefatura: todos los profesores de un departamento ven el mismo
--    formulario ("no queremos rumores de por que a ti te salen x materias").
--    Lo que antes se resolvia quitandole materias a alguien se resuelve ahora
--    con bloqueo_profesor_materia, que el profesor no ve.
-- 2. materia_cuestionario.seccion, reemplazada por seccion_id.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP TABLE profesor_materia_elegible;

ALTER TABLE profesor DROP COLUMN modo_materias_elegibles;

ALTER TABLE materia_cuestionario DROP COLUMN seccion;

-- Verificacion (esperado: las tres vacias)
--   SHOW TABLES LIKE 'profesor_materia_elegible';
--   SHOW COLUMNS FROM profesor LIKE 'modo_materias_elegibles';
--   SHOW COLUMNS FROM materia_cuestionario LIKE 'seccion';
