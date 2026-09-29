-- =============================================================================
-- Migracion 2026-09-28 (1 de 2) — formulario editable por jefatura
--
-- Que cambia y por que (detalle en BITACORA.md, 2026-09-28):
--   - El cuestionario deja de tener dos secciones fijas (enum de
--     materia_cuestionario.seccion) y pasa a ser una lista ORDENADA de
--     secciones editables: cuestionario_seccion. La jefatura agrega y quita
--     secciones de materias y preguntas abiertas, edita textos y minimos.
--   - El formulario se PUBLICA: hasta entonces los profesores no lo ven
--     (departamento_semestre_config.publicado).
--   - Las preguntas abiertas se contestan en preferencia_respuesta.
--   - La jefatura puede BLOQUEAR pares profesor-materia en una capa aparte
--     (bloqueo_profesor_materia) que no toca la respuesta del profesor.
--
-- Este archivo es ADITIVO: no borra nada, asi que el API anterior sigue
-- funcionando despues de correrlo. Lo que se borra (el enum viejo y la
-- personalizacion por profesor) va en migracion-2026-09-28-limpieza.sql, que
-- se corre DESPUES de desplegar el API nuevo.
--
-- MariaDB 5.5: cada ALTER/CREATE hace commit implicito, asi que esto no es
-- atomico. Respaldar antes:
--   mysqldump horariosdace departamento_semestre_config materia_cuestionario \
--     preferencia profesor profesor_materia_elegible > respaldo-2026-09-28.sql
-- Correr UNA sola vez.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- 1. Secciones del formulario
-- -----------------------------------------------------------------------------
CREATE TABLE cuestionario_seccion (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    departamento_id         INT NOT NULL,
    semestre_id             INT NOT NULL,
    tipo                    ENUM('num_cursos','materias','disponibilidad','abierta') NOT NULL
                            COMMENT 'num_cursos y disponibilidad: exactamente una por depto/semestre, no se borran (se valida en PHP).',
    titulo                  VARCHAR(255) NOT NULL,
    descripcion             TEXT NULL,
    audiencia               ENUM('todos','tiempo_completo_medio','asignatura') NOT NULL DEFAULT 'todos'
                            COMMENT 'Materias de una seccion que el profesor no ve se agregan a su primera seccion de materias visible.',
    minimo_verdes           INT NULL COMMENT 'Solo tipo materias. NULL = sin minimo.',
    cobertura_departamental TINYINT(1) NOT NULL DEFAULT 0
                            COMMENT 'Solo tipo materias. Se copia a preferencia_materia.cobertura_departamental.',
    obligatoria             TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Solo tipo abierta.',
    orden                   INT NOT NULL,
    activa                  TINYINT(1) NOT NULL DEFAULT 1
                            COMMENT '0 = borrada desde el editor. Borrado suave: preferencia_respuesta la referencia.',
    KEY idx_cs_depto_semestre (departamento_id, semestre_id),
    KEY idx_cs_semestre (semestre_id),
    CONSTRAINT fk_cs_depto    FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_cs_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bloques del formulario de un depto/semestre, en orden. Editable por jefatura.';

-- -----------------------------------------------------------------------------
-- 2. Publicacion y texto de introduccion
-- -----------------------------------------------------------------------------
ALTER TABLE departamento_semestre_config
    ADD COLUMN texto_introduccion TEXT NULL
        COMMENT 'NULL = texto por defecto (api/lib/catalogo.php).',
    ADD COLUMN publicado     TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '0 = los profesores todavia no ven el formulario.',
    ADD COLUMN publicado_at  DATETIME NULL COMMENT 'UTC.',
    ADD COLUMN publicado_por INT NULL,
    ADD CONSTRAINT fk_dsc_publicado_por FOREIGN KEY (publicado_por) REFERENCES profesor(id),
    MODIFY COLUMN mostrar_seleccion_materias TINYINT(1) NOT NULL DEFAULT 1
        COMMENT 'OBSOLETA desde 2026-09-28: no tener secciones de materias equivale a 0. No se lee.';

-- -----------------------------------------------------------------------------
-- 3. materia_cuestionario apunta a una seccion (NULL = oculta)
-- -----------------------------------------------------------------------------
ALTER TABLE materia_cuestionario
    ADD COLUMN seccion_id INT NULL
        COMMENT 'NULL = oculta. Sin fila = primera seccion de materias para todos (fail-open).' AFTER semestre_id,
    ADD KEY idx_mc_seccion (seccion_id),
    ADD CONSTRAINT fk_mc_seccion FOREIGN KEY (seccion_id) REFERENCES cuestionario_seccion(id);

-- -----------------------------------------------------------------------------
-- 4. Sembrar las 7 secciones que reproducen el formulario de hoy, para cada
--    depto/semestre que ya tenga configuracion. El `orden` de la plantilla es
--    el que usan los pasos 5 y 7 para encontrar cada seccion: no cambiarlo.
--    La misma plantilla vive en PHP (secciones_por_defecto() en
--    api/lib/catalogo.php) para los depto/semestre que se configuren despues.
-- -----------------------------------------------------------------------------
INSERT INTO cuestionario_seccion
       (departamento_id, semestre_id, tipo, titulo, descripcion, audiencia,
        minimo_verdes, cobertura_departamental, obligatoria, orden)
SELECT p.departamento_id, p.semestre_id, t.tipo, t.titulo, t.descripcion, t.audiencia,
       t.minimo_verdes, t.cobertura, 0, t.orden
FROM (
    SELECT DISTINCT m.departamento_id, mc.semestre_id
      FROM materia_cuestionario mc JOIN materia m ON m.id = mc.materia_id
    UNION
    SELECT departamento_id, semestre_id FROM departamento_semestre_config
) p
CROSS JOIN (
              SELECT 1 AS orden, 'num_cursos' AS tipo,
                     '¿Cuántos cursos puedes impartir este semestre?' AS titulo,
                     CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS descripcion,
                     'todos' AS audiencia, CAST(NULL AS SIGNED) AS minimo_verdes, 0 AS cobertura
    UNION ALL SELECT 2, 'materias', 'Cursos de cálculo — cobertura departamental',
                     'Cursos de cálculo que, por ser departamentales, necesitan que varios profesores de tiempo completo o medio tiempo los impartan.',
                     'tiempo_completo_medio', 2, 1
    UNION ALL SELECT 3, 'materias', 'Catálogo de materias', NULL, 'todos', 5, 0
    UNION ALL SELECT 4, 'disponibilidad', 'Disponibilidad de horarios',
                     'Haz clic para cambiar el color de una franja, o mantén presionado y arrastra para pintar varias de un jalón.',
                     'todos', NULL, 0
    UNION ALL SELECT 5, 'abierta', '¿Ya solicitaste cursos en otro departamento? ¿En qué horarios?',
                     'Ej. Martes 10:00-11:30 en Actuaría', 'asignatura', NULL, 0
    UNION ALL SELECT 6, 'abierta', 'Observaciones sobre la asignación de cursos', NULL, 'todos', NULL, 0
    UNION ALL SELECT 7, 'abierta', 'Observaciones sobre disponibilidad de horarios', NULL, 'todos', NULL, 0
) t
WHERE NOT EXISTS (
    SELECT 1 FROM cuestionario_seccion x
     WHERE x.departamento_id = p.departamento_id AND x.semestre_id = p.semestre_id
);

-- Un departamento que habia apagado la seleccion de materias se queda sin
-- secciones de materias, que es lo que ahora significa eso.
UPDATE cuestionario_seccion cs
  JOIN departamento_semestre_config c
    ON c.departamento_id = cs.departamento_id AND c.semestre_id = cs.semestre_id
   SET cs.activa = 0
 WHERE cs.tipo = 'materias' AND c.mostrar_seleccion_materias = 0;

-- -----------------------------------------------------------------------------
-- 5. Traducir el enum viejo a seccion_id. 'oculta' se queda en NULL.
-- -----------------------------------------------------------------------------
UPDATE materia_cuestionario mc
  JOIN materia m ON m.id = mc.materia_id
  JOIN cuestionario_seccion cs
    ON cs.departamento_id = m.departamento_id
   AND cs.semestre_id = mc.semestre_id
   AND cs.orden = CASE mc.seccion WHEN 'cobertura_departamental' THEN 2 ELSE 3 END
   SET mc.seccion_id = cs.id
 WHERE mc.seccion <> 'oculta';

-- -----------------------------------------------------------------------------
-- 6. Respuestas a preguntas abiertas
-- -----------------------------------------------------------------------------
CREATE TABLE preferencia_respuesta (
    preferencia_id INT NOT NULL,
    seccion_id     INT NOT NULL,
    texto          TEXT NOT NULL,
    PRIMARY KEY (preferencia_id, seccion_id),
    KEY idx_pr_seccion (seccion_id),
    CONSTRAINT fk_pr_preferencia FOREIGN KEY (preferencia_id) REFERENCES preferencia(id) ON DELETE CASCADE,
    CONSTRAINT fk_pr_seccion     FOREIGN KEY (seccion_id)     REFERENCES cuestionario_seccion(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Respuesta a una seccion tipo abierta.';

-- Lo que ya hubiera en las columnas viejas pasa a las preguntas sembradas.
INSERT INTO preferencia_respuesta (preferencia_id, seccion_id, texto)
SELECT p.id, cs.id,
       CASE cs.orden WHEN 5 THEN p.horarios_otro_depto
                     WHEN 6 THEN p.observaciones_cursos
                     ELSE p.observaciones_horarios END
  FROM preferencia p
  JOIN profesor pr ON pr.id = p.profesor_id
  JOIN cuestionario_seccion cs
    ON cs.departamento_id = pr.departamento_id AND cs.semestre_id = p.semestre_id
   AND cs.tipo = 'abierta' AND cs.orden IN (5, 6, 7)
 WHERE CASE cs.orden WHEN 5 THEN p.horarios_otro_depto
                     WHEN 6 THEN p.observaciones_cursos
                     ELSE p.observaciones_horarios END <> '';

ALTER TABLE preferencia
    MODIFY COLUMN horarios_otro_depto TEXT NULL
        COMMENT 'OBSOLETA desde 2026-09-28: ahora es una pregunta abierta (preferencia_respuesta).',
    MODIFY COLUMN observaciones_cursos TEXT NULL
        COMMENT 'OBSOLETA desde 2026-09-28: ahora es una pregunta abierta (preferencia_respuesta).',
    MODIFY COLUMN observaciones_horarios TEXT NULL
        COMMENT 'OBSOLETA desde 2026-09-28: ahora es una pregunta abierta (preferencia_respuesta).';

-- -----------------------------------------------------------------------------
-- 7. Bloqueos de jefatura
-- -----------------------------------------------------------------------------
CREATE TABLE bloqueo_profesor_materia (
    profesor_id   INT NOT NULL,
    materia_id    INT NOT NULL,
    semestre_id   INT NOT NULL,
    bloqueado_por INT NOT NULL,
    bloqueado_at  DATETIME NOT NULL COMMENT 'UTC.',
    PRIMARY KEY (profesor_id, materia_id, semestre_id),
    KEY idx_bpm_materia (materia_id),
    KEY idx_bpm_semestre (semestre_id),
    CONSTRAINT fk_bpm_profesor FOREIGN KEY (profesor_id)   REFERENCES profesor(id),
    CONSTRAINT fk_bpm_materia  FOREIGN KEY (materia_id)    REFERENCES materia(id),
    CONSTRAINT fk_bpm_semestre FOREIGN KEY (semestre_id)   REFERENCES semestre(id),
    CONSTRAINT fk_bpm_por      FOREIGN KEY (bloqueado_por) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Restriccion DURA para el motor. Capa aparte: no toca preferencia_materia y el profesor nunca la ve.';

-- -----------------------------------------------------------------------------
-- Verificacion
-- -----------------------------------------------------------------------------
--   SELECT departamento_id, semestre_id, COUNT(*) FROM cuestionario_seccion
--    GROUP BY departamento_id, semestre_id;                 -- 7 por par
--
--   -- el enum y seccion_id deben coincidir (esperado: 0 filas):
--   SELECT mc.materia_id, mc.seccion, cs.orden
--     FROM materia_cuestionario mc
--     LEFT JOIN cuestionario_seccion cs ON cs.id = mc.seccion_id
--    WHERE (mc.seccion = 'oculta' AND mc.seccion_id IS NOT NULL)
--       OR (mc.seccion = 'cobertura_departamental' AND cs.orden <> 2)
--       OR (mc.seccion = 'catalogo_general' AND cs.orden <> 3)
--       OR (mc.seccion <> 'oculta' AND mc.seccion_id IS NULL);
