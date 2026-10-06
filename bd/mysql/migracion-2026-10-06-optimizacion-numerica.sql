-- =============================================================================
-- Migración 2026-10-06 — claves nuevas de Matemáticas (Optimización Numérica e
-- Investigación de Operaciones)
--
-- Pedido de la usuaria (versión corregida, reemplaza a la primera de este
-- mismo día, que tenía la dirección al revés):
--   * MAT-24410 Programación Lineal y MAT-24430 Análisis Aplicado I
--       ahora son MAT-24433 Optimización Numérica I.
--   * MAT-24431 Optimización Numérica I
--       ahora es  MAT-24435 Optimización Numérica II.
--   * MAT-24500 Investigación de Operaciones I
--       ahora es  MAT-24505 Investigación de Operaciones I (nueva).
--
-- "Ahora es" = la clave nueva es la que se ve en el cuestionario y la vieja
-- queda oculta como alias suyo (se muestra "(antes …)"). Como en
-- MAT-24630/MAT-24632, se guarda en dos lugares:
--   * materia_co_oferta, en ambas direcciones (son la misma clase). 24410,
--     24430 y 24433 quedan como un trío: todas con todas.
--   * materia_cuestionario: la vieja con seccion_id NULL y alias_de_id a la
--     nueva; la nueva hereda la sección y el orden que tenía la vieja.
-- Además, las respuestas que los profesores ya hubieran dado con la clave vieja
-- pasan a la nueva (si no, desaparecerían del formulario al ocultarse).
--
-- Sirve en los dos estados posibles de la base: recién sembrada, o con la
-- primera versión de esta migración ya corrida (24433 y 24435 ocultas como
-- alias de 24410 y 24431, y sin 24433 = 24430). Es idempotente.
--
-- Correr el bloque 0 primero, solo, para ver el estado actual.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 0. Estado actual (solo lectura) -------------------------------------------------

SELECT m.id, m.clave, m.nombre, m.creditos, m.activa
  FROM materia m
 WHERE m.clave IN ('MAT-24410', 'MAT-24430', 'MAT-24431', 'MAT-24433', 'MAT-24435', 'MAT-24500', 'MAT-24505')
 ORDER BY m.clave;

SELECT a.clave, '=' AS es, b.clave AS co_ofertada
  FROM materia_co_oferta c
  JOIN materia a ON a.id = c.materia_id
  JOIN materia b ON b.id = c.co_ofertada_id
 WHERE a.clave IN ('MAT-24410', 'MAT-24430', 'MAT-24431', 'MAT-24433', 'MAT-24435', 'MAT-24500', 'MAT-24505')
 ORDER BY a.clave, b.clave;

SELECT m.clave, sem.tipo, sem.anio, cs.titulo AS seccion, al.clave AS alias_de,
       mc.etiqueta, mc.orden, mc.revisado
  FROM materia_cuestionario mc
  JOIN materia m   ON m.id = mc.materia_id
  JOIN semestre sem ON sem.id = mc.semestre_id
  LEFT JOIN cuestionario_seccion cs ON cs.id = mc.seccion_id
  LEFT JOIN materia al ON al.id = mc.alias_de_id
 WHERE m.clave IN ('MAT-24410', 'MAT-24430', 'MAT-24431', 'MAT-24433', 'MAT-24435', 'MAT-24500', 'MAT-24505')
 ORDER BY sem.anio, sem.tipo, m.clave;

-- Respuestas ya dadas (las de claves viejas se mueven en el paso 5)
SELECT m.clave, sem.tipo, sem.anio, pm.nivel, COUNT(*) AS respuestas
  FROM preferencia_materia pm
  JOIN preferencia p ON p.id = pm.preferencia_id
  JOIN semestre sem  ON sem.id = p.semestre_id
  JOIN materia m     ON m.id = pm.materia_id
 WHERE m.clave IN ('MAT-24410', 'MAT-24430', 'MAT-24431', 'MAT-24433', 'MAT-24435', 'MAT-24500', 'MAT-24505')
 GROUP BY m.clave, sem.tipo, sem.anio, pm.nivel;


-- =============================================================================
-- Corrección
-- =============================================================================

-- Los cuatro pares vieja -> nueva. Tabla temporal porque MariaDB 5.5 no tiene
-- CTE; no provoca commit implícito.
DROP TEMPORARY TABLE IF EXISTS tmp_clave_nueva;
CREATE TEMPORARY TABLE tmp_clave_nueva (
  vieja VARCHAR(20) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  nueva VARCHAR(20) COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_clave_nueva (vieja, nueva) VALUES
  ('MAT-24410', 'MAT-24433'),
  ('MAT-24430', 'MAT-24433'),
  ('MAT-24431', 'MAT-24435'),
  ('MAT-24500', 'MAT-24505');

START TRANSACTION;

-- 1. Altas ----------------------------------------------------------------------------
--    Departamento, tipo de salón y anual copiados de la clave vieja, por ser la
--    misma clase. clave es UNIQUE: el INSERT IGNORE no duplica.
--    Créditos confirmados por la usuaria: MAT-24435 6, MAT-24505 8 (y
--    MAT-24431 8, ya así en el seed).

INSERT IGNORE INTO materia (clave, nombre, creditos, departamento_id, anual, tipo_salon_requerido, activa)
SELECT 'MAT-24435', 'Optimización Numérica II', 6, m.departamento_id, m.anual, m.tipo_salon_requerido, 1
  FROM materia m
 WHERE m.clave = 'MAT-24431';

INSERT IGNORE INTO materia (clave, nombre, creditos, departamento_id, anual, tipo_salon_requerido, activa)
SELECT 'MAT-24505', 'Investigación de Operaciones I', 8, m.departamento_id, m.anual, m.tipo_salon_requerido, 1
  FROM materia m
 WHERE m.clave = 'MAT-24500';

UPDATE materia SET creditos = 8 WHERE clave IN ('MAT-24431', 'MAT-24505');

-- 2. Co-ofertas, en ambas direcciones ---------------------------------------------------
--    Restaura 24433 = 24430, que la primera versión había borrado.

INSERT IGNORE INTO materia_co_oferta (materia_id, co_ofertada_id)
SELECT m1.id, m2.id
FROM (
            SELECT 'MAT-24410' AS clave_a, 'MAT-24433' AS clave_b
  UNION ALL SELECT 'MAT-24433', 'MAT-24410'
  UNION ALL SELECT 'MAT-24430', 'MAT-24433'
  UNION ALL SELECT 'MAT-24433', 'MAT-24430'
  UNION ALL SELECT 'MAT-24410', 'MAT-24430'
  UNION ALL SELECT 'MAT-24430', 'MAT-24410'
  UNION ALL SELECT 'MAT-24431', 'MAT-24435'
  UNION ALL SELECT 'MAT-24435', 'MAT-24431'
  UNION ALL SELECT 'MAT-24500', 'MAT-24505'
  UNION ALL SELECT 'MAT-24505', 'MAT-24500'
) v
JOIN materia m1 ON m1.clave = v.clave_a COLLATE utf8mb4_unicode_ci
JOIN materia m2 ON m2.clave = v.clave_b COLLATE utf8mb4_unicode_ci;

-- 3. La clave nueva toma el lugar de la vieja en el cuestionario --------------------------
--    En cada semestre donde la vieja tiene fila. COALESCE: si la vieja ya está
--    oculta (segunda corrida), la nueva conserva la sección que ya tiene.
--    MAT-24433 recibe dos viejas; las dos venían de la misma sección.

INSERT INTO materia_cuestionario
       (materia_id, semestre_id, seccion_id, alias_de_id, etiqueta, orden, revisado)
SELECT n.id, mc.semestre_id, mc.seccion_id, NULL, NULL, mc.orden, 1
  FROM materia_cuestionario mc
  JOIN materia o ON o.id = mc.materia_id
  JOIN tmp_clave_nueva t ON t.vieja = o.clave
  JOIN materia n ON n.clave = t.nueva
ON DUPLICATE KEY UPDATE
   seccion_id  = COALESCE(VALUES(seccion_id), materia_cuestionario.seccion_id),
   orden       = COALESCE(VALUES(orden), materia_cuestionario.orden),
   alias_de_id = NULL,
   etiqueta    = NULL,
   revisado    = 1;

-- 4. La vieja queda oculta, alias de la nueva --------------------------------------------
--    En cada semestre donde ya está la nueva (sin fila, la vieja aparecería sola
--    por el fail-open). La etiqueta lleva la clave porque dos nombres viejos son
--    idénticos al nuevo: el formulario muestra
--    "Investigación de Operaciones I (antes MAT-24500 Investigación de Operaciones I)".

INSERT INTO materia_cuestionario
       (materia_id, semestre_id, seccion_id, alias_de_id, etiqueta, orden, revisado)
SELECT o.id, mc.semestre_id, NULL, n.id, CONCAT(o.clave, ' ', o.nombre), NULL, 1
  FROM materia_cuestionario mc
  JOIN materia n ON n.id = mc.materia_id
  JOIN tmp_clave_nueva t ON t.nueva = n.clave
  JOIN materia o ON o.clave = t.vieja
ON DUPLICATE KEY UPDATE
   seccion_id  = NULL,
   alias_de_id = VALUES(alias_de_id),
   etiqueta    = VALUES(etiqueta),
   orden       = NULL,
   revisado    = 1;

-- 5. Respuestas de profesores: de la clave vieja a la nueva --------------------------------
--    Solo en semestres donde la vieja ya es alias de la nueva. Si el profesor
--    ya marcó la nueva, se respeta lo suyo (INSERT IGNORE). Si marcó 24410 y
--    24430 con colores distintos, gana el mejor: se insertan en orden
--    verde, amarillo, rojo (ENUM: verde = 1) y el primero se queda.

INSERT IGNORE INTO preferencia_materia (preferencia_id, materia_id, nivel, cobertura_departamental)
SELECT pm.preferencia_id, mc.alias_de_id, pm.nivel, pm.cobertura_departamental
  FROM preferencia_materia pm
  JOIN preferencia p ON p.id = pm.preferencia_id
  JOIN materia o ON o.id = pm.materia_id
  JOIN tmp_clave_nueva t ON t.vieja = o.clave
  JOIN materia_cuestionario mc
    ON mc.materia_id = o.id AND mc.semestre_id = p.semestre_id
   AND mc.alias_de_id = (SELECT n.id FROM materia n WHERE n.clave = t.nueva)
 ORDER BY pm.preferencia_id, pm.nivel + 0;

DELETE pm
  FROM preferencia_materia pm
  JOIN preferencia p ON p.id = pm.preferencia_id
  JOIN materia o ON o.id = pm.materia_id
  JOIN tmp_clave_nueva t ON t.vieja = o.clave
  JOIN materia n ON n.clave = t.nueva
  JOIN materia_cuestionario mc
    ON mc.materia_id = o.id AND mc.semestre_id = p.semestre_id AND mc.alias_de_id = n.id;

COMMIT;

DROP TEMPORARY TABLE IF EXISTS tmp_clave_nueva;

-- 6. Verificación ----------------------------------------------------------------------
--    Materias: MAT-24435 y MAT-24505 existen y están activas.
--    Co-ofertas: 24410=24430=24433 (todas con todas), 24431=24435, 24500=24505.
--    Cuestionario: 24433, 24435 y 24505 en una sección; 24410 y 24430 ocultas
--    con alias_de 24433; 24431 con alias_de 24435; 24500 con alias_de 24505.
--    Respuestas: ninguna con claves viejas en esos semestres.

SELECT clave, nombre, creditos, activa
  FROM materia WHERE clave IN ('MAT-24435', 'MAT-24505');

SELECT a.clave, '=' AS es, b.clave AS co_ofertada
  FROM materia_co_oferta c
  JOIN materia a ON a.id = c.materia_id
  JOIN materia b ON b.id = c.co_ofertada_id
 WHERE a.clave IN ('MAT-24410', 'MAT-24430', 'MAT-24431', 'MAT-24433', 'MAT-24435', 'MAT-24500', 'MAT-24505')
 ORDER BY a.clave, b.clave;

SELECT m.clave, sem.tipo, sem.anio, cs.titulo AS seccion, al.clave AS alias_de,
       mc.etiqueta, mc.orden, mc.revisado
  FROM materia_cuestionario mc
  JOIN materia m   ON m.id = mc.materia_id
  JOIN semestre sem ON sem.id = mc.semestre_id
  LEFT JOIN cuestionario_seccion cs ON cs.id = mc.seccion_id
  LEFT JOIN materia al ON al.id = mc.alias_de_id
 WHERE m.clave IN ('MAT-24410', 'MAT-24430', 'MAT-24431', 'MAT-24433', 'MAT-24435', 'MAT-24500', 'MAT-24505')
 ORDER BY sem.anio, sem.tipo, m.clave;

SELECT m.clave, sem.tipo, sem.anio, pm.nivel, COUNT(*) AS respuestas
  FROM preferencia_materia pm
  JOIN preferencia p ON p.id = pm.preferencia_id
  JOIN semestre sem  ON sem.id = p.semestre_id
  JOIN materia m     ON m.id = pm.materia_id
 WHERE m.clave IN ('MAT-24410', 'MAT-24430', 'MAT-24431', 'MAT-24433', 'MAT-24435', 'MAT-24500', 'MAT-24505')
 GROUP BY m.clave, sem.tipo, sem.anio, pm.nivel;
