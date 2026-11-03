-- =============================================================================
-- Migración 2026-11-03 — Ajustes de "Materias programadas" (Matemáticas)
--
-- La vista "Archivos de Matemáticas" (api/programadas.php) arma el Excel de
-- Materias programadas para Servicios Escolares y los PDF por división con lo
-- que hay en la malla. A veces la jefatura quiere que el Excel diga algo que
-- la malla no dice: un grupo compartido que se abre solo, un grupo que se
-- lista sin profesor ni horario, otro porcentaje para una clave compartida.
-- Esos ajustes se guardan aquí y solo cambian los archivos, nunca la malla.
--
--   separar     el grupo se abre solo: se quita de la clase compartida
--   vaciar      se lista solo con clave, grupo y materia
--   porcentaje  el % con que se abre la clave (valor, 0 a 100)
--   confirmado  el % que trae la malla es el correcto: no se avisa
--
-- El grupo se identifica por materia + número y no por grupo_id: cada subida
-- del motor borra y vuelve a crear los grupos sin publicar, y un ajuste atado
-- al id se perdería (o bloquearía la subida con el FK).
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API
-- nuevo y sin la tabla, la vista da 500; el resto del sistema no la usa.
-- Se puede repetir: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS ajuste_programadas (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    semestre_id INT NOT NULL,
    materia_id  INT NOT NULL,
    numero      VARCHAR(3) NOT NULL COMMENT 'Número de grupo (grupo.numero), ej. 001.',
    accion      ENUM('separar','vaciar','porcentaje','confirmado') NOT NULL,
    valor       DECIMAL(5,2) NULL COMMENT 'Solo porcentaje: 0 a 100 (se valida en PHP).',
    motivo      VARCHAR(300) NULL,
    creado_por  INT NOT NULL,
    creado_at   DATETIME NOT NULL COMMENT 'UTC.',
    UNIQUE KEY uq_ap_grupo_accion (semestre_id, materia_id, numero, accion),
    CONSTRAINT fk_ap_semestre FOREIGN KEY (semestre_id) REFERENCES semestre(id),
    CONSTRAINT fk_ap_materia  FOREIGN KEY (materia_id)  REFERENCES materia(id),
    CONSTRAINT fk_ap_creado   FOREIGN KEY (creado_por)  REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ajustes que solo van en los archivos de Materias programadas (api/programadas.php).';

SHOW TABLES LIKE 'ajuste_programadas';
