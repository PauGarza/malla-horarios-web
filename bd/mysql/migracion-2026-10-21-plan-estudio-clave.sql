-- =============================================================================
-- Migración 2026-10-21 — plan_estudio.clave
--
-- Los planes de estudio se cargan desde el export de Oracle
-- (datos-planes-estudio-mysql.sql, generado por generar-planes-estudio.py), y
-- ahí un plan es carrera + versión: 'ACT-H', 'M.A-F'. Esta columna guarda esa
-- clave para que la carga resuelva los planes por clave y no por id (como
-- materia.clave) y para que se pueda repetir sin duplicar planes.
--
-- NULL se admite para un plan dado de alta a mano que no venga de Oracle; el
-- índice UNIQUE de MariaDB deja pasar varios NULL.
--
-- ADITIVA: no toca el API, se puede correr en cualquier momento. ANTES de
-- datos-planes-estudio-mysql.sql. Una sola vez: repetida, falla con "Duplicate
-- column name 'clave'" y no cambia nada.
-- =============================================================================

ALTER TABLE plan_estudio
    ADD COLUMN clave VARCHAR(10) NULL
        COMMENT 'Carrera-version de Oracle, ej. ACT-H, M.A-F. Ver datos-planes-estudio-mysql.sql.'
        AFTER id,
    ADD UNIQUE KEY uq_plan_estudio_clave (clave);

-- Verificación: debe listar la columna clave, Null = YES, Key = UNI.
--   SHOW COLUMNS FROM plan_estudio;
