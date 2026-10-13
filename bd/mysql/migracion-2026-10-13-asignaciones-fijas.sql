-- =============================================================================
-- Migración 2026-10-13 — asignaciones directas de la jefatura
--
-- Antes de correr el motor, la jefatura fija "este profesor da un grupo de esta
-- materia" y, si quiere, también el horario. El motor las toma como
-- restricción DURA: por cada fila de asignacion_fija tiene que haber un grupo
-- de esa materia con ese profesor, y si la fila tiene horario, en esos bloques
-- exactos. Lo que queda (salón, CRN, los demás grupos) lo decide él.
--
-- Capa aparte y no filas en grupo/imparte, porque a esta altura no existen los
-- datos que esas tablas exigen: grupo.crn es NOT NULL y lo da Servicios
-- Escolares, e imparte_horario.salon_id también. Y por lo mismo que los
-- bloqueos: lo que decide la jefatura se ve y se deshace sin tocar nada del
-- motor. El profesor no la ve (ningún endpoint suyo la lee).
--
-- Una fila = UN grupo. Dos grupos de la misma materia con el mismo profesor
-- son dos filas; por eso la llave es un id y no (profesor, materia).
--
-- El horario es opcional: sin filas en asignacion_fija_horario el motor elige
-- cuándo. Con filas, deben ser exactamente materia.creditos bloques (1 crédito
-- = 1 bloque de 30 min; ver motor-asignacion.md §2.4). Eso, que el profesor no
-- tenga dos fijas a la misma hora, y que la franja valga para ese día y ese
-- departamento, lo valida api/asignaciones.php: son reglas entre varias filas y
-- tablas, que un CHECK no podría expresar y un trigger haría a medias.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin las tablas, la vista de Asignaciones directas da 500.
-- Idempotente (IF NOT EXISTS).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS asignacion_fija (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    semestre_id INT NOT NULL,
    materia_id  INT NOT NULL,
    profesor_id INT NOT NULL,
    nota        VARCHAR(500) NULL COMMENT 'Por qué se fijó; solo para la jefatura.',
    creado_por  INT NOT NULL,
    creado_at   DATETIME NOT NULL COMMENT 'UTC.',
    KEY idx_af_semestre (semestre_id),
    KEY idx_af_materia (materia_id),
    KEY idx_af_profesor (profesor_id),
    CONSTRAINT fk_af_semestre FOREIGN KEY (semestre_id) REFERENCES semestre(id),
    CONSTRAINT fk_af_materia  FOREIGN KEY (materia_id)  REFERENCES materia(id),
    CONSTRAINT fk_af_profesor FOREIGN KEY (profesor_id) REFERENCES profesor(id),
    CONSTRAINT fk_af_por      FOREIGN KEY (creado_por)  REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Restriccion DURA para el motor: un grupo de esta materia lo da este profesor. Una fila = un grupo.';

CREATE TABLE IF NOT EXISTS asignacion_fija_horario (
    asignacion_fija_id INT NOT NULL,
    dia                ENUM('lunes','martes','miercoles','jueves','viernes') NOT NULL,
    franja_id          INT NOT NULL,
    PRIMARY KEY (asignacion_fija_id, dia, franja_id),
    KEY idx_afh_franja (franja_id),
    CONSTRAINT fk_afh_asignacion FOREIGN KEY (asignacion_fija_id) REFERENCES asignacion_fija(id) ON DELETE CASCADE,
    CONSTRAINT fk_afh_franja     FOREIGN KEY (franja_id)          REFERENCES franja_horaria(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Horario fijado de una asignacion_fija, en bloques de 30 min. Sin filas = el motor elige el horario.';

-- Verificación: las dos tablas, vacías.
SHOW CREATE TABLE asignacion_fija;
SHOW CREATE TABLE asignacion_fija_horario;
