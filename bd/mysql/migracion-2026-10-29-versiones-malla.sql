-- =============================================================================
-- Migración 2026-10-29 — Versiones de la malla (D60)
--
-- Cada subida del motor borra los grupos sin publicar que dejó la anterior, y
-- motor_corrida no guarda los grupos: una malla que a la jefatura le gustó más
-- no se podía volver a ver. Ahora cada subida guarda, por departamento, los
-- grupos que dejó en la malla (api/motor-salida.php, motor_guardar_versiones).
-- La jefatura los ve en solo lectura y marca la que prefiere; el admin la
-- descarga como referencia para la siguiente corrida (api/malla-versiones.php).
-- No se restaura directo.
--
-- grupos va en el formato de un grupo de la salida (§4.2), como los da la
-- malla: con eso se pinta y sirve de referencia para optV1. huella es el
-- SHA-256 de lo que importa (materias, profesores, sesiones con salón y cupo;
-- motor_huella_malla), sin los ids, que cambian en cada subida: dos subidas
-- del mismo archivo dan la misma huella.
--
-- Una sola preferida por semestre y departamento: la cuida el PHP (MariaDB 5.5
-- no tiene índices parciales).
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin la tabla, aplicar un resultado del motor da 500.
-- Se puede repetir: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS malla_version (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    semestre_id     INT NOT NULL,
    departamento_id INT NOT NULL,
    corrida_id      INT NOT NULL COMMENT 'La subida que dejó esta malla.',
    huella          CHAR(64) NOT NULL COMMENT 'SHA-256 sin ids (motor_huella_malla): igual = la misma malla.',
    grupos          LONGTEXT NOT NULL COMMENT 'JSON: los grupos del departamento, formato §4.2 de la salida.',
    n_grupos        INT NOT NULL,
    creado_at       DATETIME NOT NULL COMMENT 'UTC.',
    preferida_por   INT NULL COMMENT 'Quién de la jefatura la marcó como la que prefiere.',
    preferida_at    DATETIME NULL COMMENT 'UTC.',
    nota            VARCHAR(300) NULL COMMENT 'Lo que escribió la jefatura al marcarla.',
    UNIQUE KEY uq_mv_corrida (corrida_id, departamento_id),
    KEY idx_mv_semestre (semestre_id, departamento_id),
    CONSTRAINT fk_mv_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id),
    CONSTRAINT fk_mv_depto    FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_mv_corrida  FOREIGN KEY (corrida_id)      REFERENCES motor_corrida(id),
    CONSTRAINT fk_mv_pref     FOREIGN KEY (preferida_por)   REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='La malla que dejó cada subida del motor, por departamento (api/malla-versiones.php).';

SHOW TABLES LIKE 'malla_version';
