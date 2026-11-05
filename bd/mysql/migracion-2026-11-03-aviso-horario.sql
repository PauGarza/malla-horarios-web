-- =============================================================================
-- Migración 2026-11-03 — Aviso de horarios a los profesores
--
-- La jefatura avisa por correo las materias y horarios asignados, y puede activar
-- una vista "Mi horario" en el perfil del profesor (api/aviso-horario.php y
-- api/mi-horario.php).
--
--   semestre_fechas      las fechas del calendario, una fila por semestre: son las
--                        mismas para todos los departamentos.
--   aviso_horario        lo que cada departamento deja guardado: el texto y las
--                        versiones del correo, y si activó la vista en el perfil.
--   aviso_horario_envio  la bitácora de lo que se le avisó a cada profesor: copia
--                        exacta del correo, sus clases y su huella. Con ella se
--                        detecta quién cambió desde el aviso, y es lo que muestra el
--                        perfil (nunca la malla en vivo).
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Sin estas tablas,
-- las pantallas nuevas dan error; lo demás sigue funcionando.
-- Se puede repetir: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS semestre_fechas (
    semestre_id     INT NOT NULL PRIMARY KEY,
    inicio          DATE NULL,
    bajas           DATE NULL,
    fin             DATE NULL,
    examenes_inicio DATE NULL,
    examenes_fin    DATE NULL,
    actualizado_por INT NULL,
    actualizado_at  DATETIME NULL COMMENT 'UTC.',
    CONSTRAINT fk_sf_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id),
    CONSTRAINT fk_sf_por      FOREIGN KEY (actualizado_por) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Calendario del semestre, compartido por todos los departamentos (api/aviso-horario.php).';

CREATE TABLE IF NOT EXISTS aviso_horario (
    semestre_id     INT NOT NULL,
    departamento_id INT NOT NULL,
    datos           LONGTEXT NULL COMMENT 'JSON: periodo, meses, copias, excluidos, versiones. NULL = sin borrador.',
    guardado_por    INT NULL,
    guardado_at     DATETIME NULL COMMENT 'UTC.',
    perfil_activo   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = sus profesores ven Mi horario en su perfil.',
    perfil_por      INT NULL,
    perfil_at       DATETIME NULL COMMENT 'UTC.',
    PRIMARY KEY (semestre_id, departamento_id),
    KEY idx_ah_depto (departamento_id),
    CONSTRAINT fk_ah_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id),
    CONSTRAINT fk_ah_depto    FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_ah_guardado FOREIGN KEY (guardado_por)    REFERENCES profesor(id),
    CONSTRAINT fk_ah_perfil   FOREIGN KEY (perfil_por)      REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='El aviso de horarios de cada departamento en un semestre.';

CREATE TABLE IF NOT EXISTS aviso_horario_envio (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    semestre_id      INT NOT NULL,
    departamento_id  INT NOT NULL,
    profesor_id      INT NOT NULL,
    estado           ENUM('enviado','error','marcado') NOT NULL COMMENT 'marcado = la jefatura lo dio por avisado, sin correo.',
    es_actualizacion TINYINT(1) NOT NULL DEFAULT 0,
    version_nombre   VARCHAR(80) NULL,
    correo           VARCHAR(191) NULL,
    copias           TEXT NULL COMMENT 'Direcciones en Cc, separadas por coma.',
    responder_a      VARCHAR(191) NULL,
    asunto           VARCHAR(300) NULL,
    html             LONGTEXT NULL COMMENT 'Copia exacta del correo. NULL si estado = marcado.',
    clases           LONGTEXT NOT NULL COMMENT 'JSON: las clases que se le avisaron (aviso_clases).',
    huella           CHAR(64) NOT NULL COMMENT 'SHA-256 de claves, grupo, días y horas (aviso_huella): igual = mismo horario.',
    error            VARCHAR(300) NULL,
    creado_por       INT NOT NULL,
    creado_at        DATETIME NOT NULL COMMENT 'UTC.',
    KEY idx_ahe_profesor (semestre_id, profesor_id, id),
    KEY idx_ahe_depto (departamento_id),
    CONSTRAINT fk_ahe_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id),
    CONSTRAINT fk_ahe_depto    FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_ahe_profesor FOREIGN KEY (profesor_id)     REFERENCES profesor(id),
    CONSTRAINT fk_ahe_por      FOREIGN KEY (creado_por)      REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lo que se le avisó a cada profesor. Solo se agrega: el último enviado o marcado es el vigente.';

SHOW TABLES LIKE 'semestre_fechas';
SHOW TABLES LIKE 'aviso_horario%';
