-- =============================================================================
-- Migración 2026-10-02 (b) — la pregunta "Número de cursos" es opcional
--
-- La jefatura de cualquiera de los 3 departamentos puede quitarla de su
-- formulario desde el editor. Quien contesta un formulario sin esa pregunta
-- guarda su preferencia con num_cursos_max = NULL.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y la columna todavía NOT NULL, guardar el formulario de quien no tiene la
-- pregunta fallaría (MySQL en modo estricto rechaza el NULL).
--
-- Los triggers de checks-como-triggers.sql (trg_pref_cursos_ins / _upd) no se
-- tocan: `NULL < 1 OR NULL > 6` no es verdadero, así que dejan pasar el NULL y
-- siguen rechazando 0, 7, etc.
--
-- Idempotente: correrlo dos veces deja la columna igual.
-- =============================================================================

ALTER TABLE preferencia
  MODIFY num_cursos_max INT NULL
  COMMENT 'NULL = el formulario no tenia la pregunta (opcional desde 2026-10-02).';

-- Verificación: Null debe decir YES.
SHOW COLUMNS FROM preferencia LIKE 'num_cursos_max';
