-- =============================================================================
-- Migración 2026-10-12 — la jefatura ajusta el número de cursos de un profesor
--
-- En "Respuestas y bloqueos" la jefatura puede sobreescribir el número de
-- cursos que pidió un profesor (preferencia.num_cursos_max). Va en una capa
-- aparte, igual que bloqueo_profesor_materia y por las mismas razones:
--   - lo que contestó el profesor no se toca: al quitar el ajuste vuelve a
--     valer su número tal como lo dio, y reabrir/reenviar su formulario no
--     borra el ajuste;
--   - el profesor nunca lo ve: ni cuestionario.php ni preferencia.php leen
--     esta tabla;
--   - se puede ajustar a alguien que todavía no contesta (no exige que exista
--     su fila de preferencia).
-- Para el motor, el número de cursos de un profesor es
-- COALESCE(ajuste_num_cursos.num_cursos, preferencia.num_cursos_max).
--
-- Rango 0-6, uno más abajo que el del profesor (1-6): 0 es "este semestre no
-- se le asignan cursos", que el profesor no puede pedir pero la jefatura sí
-- decide.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin la tabla, respuestas.php y reporte.php dan 500 (las dos la leen).
-- MariaDB 5.5 no tiene CREATE TRIGGER IF NOT EXISTS: correr UNA sola vez.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

CREATE TABLE ajuste_num_cursos (
    profesor_id  INT NOT NULL,
    semestre_id  INT NOT NULL,
    num_cursos   INT NOT NULL COMMENT '0-6. 0 = no se le asignan cursos este semestre.',
    ajustado_por INT NOT NULL,
    ajustado_at  DATETIME NOT NULL COMMENT 'UTC.',
    PRIMARY KEY (profesor_id, semestre_id),
    KEY idx_anc_semestre (semestre_id),
    CONSTRAINT fk_anc_profesor FOREIGN KEY (profesor_id)  REFERENCES profesor(id),
    CONSTRAINT fk_anc_semestre FOREIGN KEY (semestre_id)  REFERENCES semestre(id),
    CONSTRAINT fk_anc_por      FOREIGN KEY (ajustado_por) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ajuste de jefatura a preferencia.num_cursos_max. Capa aparte: no toca la preferencia y el profesor nunca lo ve.';

-- Sin CHECK (num_cursos BETWEEN 0 AND 6) en la tabla, a diferencia de
-- schema-mysql.sql: MariaDB 5.5 lo ignora de todas formas, y el analizador
-- del editor SQL de phpMyAdmin lo marca como error ("Se esperaba un nombre de
-- símbolo") antes de mandarlo. El rango lo cuidan estos dos triggers y
-- respuestas.php.
DELIMITER $$

CREATE TRIGGER trg_anc_cursos_ins BEFORE INSERT ON ajuste_num_cursos FOR EACH ROW
BEGIN
    IF NEW.num_cursos < 0 OR NEW.num_cursos > 6 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'num_cursos debe estar entre 0 y 6';
    END IF;
END$$

CREATE TRIGGER trg_anc_cursos_upd BEFORE UPDATE ON ajuste_num_cursos FOR EACH ROW
BEGIN
    IF NEW.num_cursos < 0 OR NEW.num_cursos > 6 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'num_cursos debe estar entre 0 y 6';
    END IF;
END$$

DELIMITER ;

-- Verificación: la tabla vacía y sus dos triggers.
SHOW CREATE TABLE ajuste_num_cursos;
SHOW TRIGGERS LIKE 'ajuste_num_cursos';
