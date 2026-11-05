-- =============================================================================
-- Migración 2026-11-03b — Quién ve Mi horario en su perfil
--
-- La vista se activa para todo el departamento, y la jefatura puede desmarcar a
-- algún profesor (api/aviso-horario.php, accion perfil_activo; api/mi-horario.php).
-- Se guardan los desmarcados y no los marcados: así un profesor nuevo la ve sin que
-- haya que acordarse de agregarlo.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo y
-- sin la columna, la pantalla de avisar horarios da error y Mi horario no aparece.
-- No se puede repetir: la segunda vez dice que la columna ya existe, sin dañar nada.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE aviso_horario
    ADD COLUMN perfil_excluidos TEXT NULL
        COMMENT 'JSON: ids de los profesores que no ven Mi horario aunque esté activa. NULL = ninguno.'
        AFTER perfil_activo;

SHOW COLUMNS FROM aviso_horario LIKE 'perfil_excluidos';
