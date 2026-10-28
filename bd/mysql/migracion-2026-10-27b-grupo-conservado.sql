-- =============================================================================
-- Migración 2026-10-27 (b) — Grupos conservados
--
-- Una subida del motor (api/motor-salida.php) borra los grupos sin publicar del
-- alcance y crea los de la salida. Desde que la jefatura edita la malla
-- (api/malla.php), eso borraría sus cambios de profesor y de horario, y dejaría
-- sin efecto sus avisos descartados (van por grupo_id).
--
-- Un grupo conservado es uno sin publicar que la jefatura ya tocó: le cambió el
-- profesor, lo movió de horario o de salón, o descartó un aviso suyo. La malla
-- lo marca sola. Para el motor es un grupo fijo (convención §3.7): ocupa
-- profesor, salón y horario, cuenta para los grupos de su materia, y la
-- siguiente subida no lo borra. "Que el motor lo rehaga", en la malla, quita la
-- marca.
--
-- conservado_at NULL = la siguiente subida lo reemplaza. Se marcan todas las
-- claves de un grupo espejo.
--
-- No hay trigger sobre grupo (triggers-mysql.sql y checks-como-triggers.sql
-- solo validan imparte_*), así que el UPDATE de la marca no dispara nada.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin las columnas, la malla, la descarga y la subida del motor dan 500.
-- UNA sola vez: MariaDB 5.5 no tiene ADD COLUMN IF NOT EXISTS.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

ALTER TABLE grupo
    ADD COLUMN conservado_por INT NULL
        COMMENT 'Quien lo conservo (2026-10-27).'
        AFTER continua_de_id,
    ADD COLUMN conservado_at DATETIME NULL
        COMMENT 'UTC. NULL = la siguiente subida del motor lo reemplaza; con fecha, va al motor como grupo fijo (2026-10-27).'
        AFTER conservado_por,
    ADD CONSTRAINT fk_grupo_conservado_por FOREIGN KEY (conservado_por) REFERENCES profesor(id);

SHOW COLUMNS FROM grupo LIKE 'conservado%';
