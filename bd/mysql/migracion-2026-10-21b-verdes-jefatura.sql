-- =============================================================================
-- Migración 2026-10-21 — verdes de jefatura
--
-- El inverso del bloqueo: en Respuestas y bloqueos la jefatura marca un par
-- profesor-materia como VERDE aunque el profesor lo haya contestado amarillo,
-- rojo o no lo haya contestado. Para el motor cuenta exactamente como si el
-- profesor lo hubiera marcado en verde (preferencia blanda, no asignación
-- forzosa: para forzar está asignacion_fija).
--
-- Capa aparte, por las mismas razones que bloqueo_profesor_materia: la
-- respuesta del profesor (preferencia_materia) no se toca, al quitar el verde
-- vuelve a contar tal como la dio, y el profesor nunca lo ve (ni
-- cuestionario.php ni preferencia.php leen esta tabla).
--
-- Un par no puede estar bloqueado y en verde a la vez. Eso lo garantiza
-- api/respuestas.php, que al poner uno quita el otro en la misma transacción:
-- es una regla entre dos tablas que un CHECK no expresa.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin la tabla, Respuestas y bloqueos, Asignaciones directas y la descarga
-- del motor dan 500.
-- Idempotente (IF NOT EXISTS).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS verde_profesor_materia (
    profesor_id  INT NOT NULL,
    materia_id   INT NOT NULL,
    semestre_id  INT NOT NULL,
    marcado_por  INT NOT NULL,
    marcado_at   DATETIME NOT NULL COMMENT 'UTC.',
    PRIMARY KEY (profesor_id, materia_id, semestre_id),
    KEY idx_vpm_materia (materia_id),
    KEY idx_vpm_semestre (semestre_id),
    CONSTRAINT fk_vpm_profesor FOREIGN KEY (profesor_id) REFERENCES profesor(id),
    CONSTRAINT fk_vpm_materia  FOREIGN KEY (materia_id)  REFERENCES materia(id),
    CONSTRAINT fk_vpm_semestre FOREIGN KEY (semestre_id) REFERENCES semestre(id),
    CONSTRAINT fk_vpm_por      FOREIGN KEY (marcado_por) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Verde puesto por la jefatura: para el motor manda sobre preferencia_materia. Capa aparte; el profesor nunca la ve.';

-- Verificación: la tabla, vacía.
SHOW CREATE TABLE verde_profesor_materia;
