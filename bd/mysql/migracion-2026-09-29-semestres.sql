-- =============================================================================
-- Migracion 2026-09-29 — ciclo de semestres y carga de la estimacion de demanda
--
-- 1. semestre.estado: hasta hoy el "semestre actual" era el de id mas alto y
--    no habia forma de pasar al siguiente desde la app, ni nada que impidiera
--    escribir en uno viejo. Ahora hay exactamente UN semestre activo; los
--    cerrados quedan de consulta. Lo abren admin y jefa de division
--    (api/semestres.php). "Solo uno activo" lo garantiza el PHP en una
--    transaccion: MariaDB 5.5 no tiene indices parciales.
--
-- 2. estimacion_demanda.con_prerrequisito pasa de INT a DECIMAL: el reporte
--    real de Actuaria (202603) trae decimales en esa columna (45.47) y como
--    INT se redondeaba en silencio.
--
-- Aditiva: el API anterior sigue funcionando despues de correrla.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

ALTER TABLE semestre
    ADD COLUMN estado      ENUM('activo','cerrado') NOT NULL DEFAULT 'cerrado'
        COMMENT 'Exactamente uno activo (se garantiza en api/semestres.php).',
    ADD COLUMN abierto_at  DATETIME NULL COMMENT 'UTC. Cuando se activo por ultima vez.',
    ADD COLUMN abierto_por INT NULL,
    ADD COLUMN cerrado_at  DATETIME NULL COMMENT 'UTC.',
    ADD CONSTRAINT fk_semestre_abierto_por FOREIGN KEY (abierto_por) REFERENCES profesor(id);

-- El que la app usa hoy: el de id mas alto (primavera 2027).
UPDATE semestre SET estado = 'activo', abierto_at = UTC_TIMESTAMP()
 WHERE id = (SELECT id FROM (SELECT MAX(id) AS id FROM semestre) t);

ALTER TABLE estimacion_demanda
    MODIFY COLUMN con_prerrequisito DECIMAL(8,2) NOT NULL DEFAULT 0
        COMMENT 'Columna "Prerr." del reporte real. Actuaria la trae con decimales.';

-- Verificacion (esperado: una sola fila, primavera 2027)
--   SELECT id, tipo, anio, estado FROM semestre WHERE estado = 'activo';
