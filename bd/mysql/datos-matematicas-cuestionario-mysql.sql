-- =============================================================================
-- Autoplanear — configuracion del cuestionario de Matematicas, Primavera 2027
-- Traduccion de DACE/BD/datos-matematicas-cuestionario.sql (PostgreSQL).
--
-- Que materias ve el profesor en su cuestionario y en que seccion, derivado del
-- mockup que la Jefa de Departamento ya reviso.
--
-- REQUIERE que exista el semestre primavera 2027. seed-mysql.sql lo inserta
-- junto con otono 2026. Si no existiera, este archivo insertaria CERO filas sin
-- dar ningun error, porque el CROSS JOIN no encontraria nada.
--
-- IMPORTANTE sobre los alias: alias_de_id NO se deriva de materia_co_oferta.
-- Esa tabla significa "misma clase en el mismo horario", no "materia
-- renombrada": su componente conexa mayor tiene 13 materias e incluye las 5 de
-- cobertura departamental, asi que derivar los alias de ahi las fusionaria en
-- una sola fila y borraria la seccion entera (verificado con SQL 2026-09-24).
-- La lista esta curada a mano cruzando el mockup contra el catalogo real.
--
-- Las 8 filas con revisado = 0 son las que el cruce NO pudo resolver: las tiene
-- que confirmar la Jefa desde su vista de configuracion. Entran como
-- catalogo_general a proposito (fail-open): es preferible que sobre una materia
-- a que a alguien le falte.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT IGNORE INTO materia_cuestionario
       (materia_id, semestre_id, seccion, alias_de_id, etiqueta, orden, revisado)
SELECT m.id, s.id, v.seccion, a.id, v.etiqueta, v.orden, v.revisado
FROM (
  SELECT 'MAT-12250' AS clave, 'cobertura_departamental' AS seccion, CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci AS alias_de, 'Cálculo Aplicado (Mercadotecnia, Relaciones Internacionales, Ciencia Política)' AS etiqueta, 1 AS orden, 1 AS revisado
  UNION ALL SELECT 'MAT-12220', 'cobertura_departamental', NULL, 'Cálculo Una Variable (Economía, Dir. Financiera)', 2, 1
  UNION ALL SELECT 'MAT-12221', 'cobertura_departamental', NULL, 'Cálculo en Varias Variables (Economía, Dir. Financiera)', 3, 1
  UNION ALL SELECT 'MAT-12200', 'cobertura_departamental', NULL, 'Cálculo Univariado (Matemáticas Aplicadas e Ingenierías)', 4, 1
  UNION ALL SELECT 'MAT-12201', 'cobertura_departamental', NULL, 'Cálculo Multivariado (Matemáticas Aplicadas e Ingenierías)', 5, 1
  UNION ALL SELECT 'MAT-14390', 'oculta', 'MAT-24406', NULL, NULL, 1
  UNION ALL SELECT 'MAT-14400', 'oculta', 'MAT-24407', NULL, NULL, 1
  UNION ALL SELECT 'MAT-14300', 'oculta', 'MAT-14280', 'Álgebra Superior I', NULL, 1
  UNION ALL SELECT 'MAT-14301', 'oculta', 'MAT-14281', 'Álgebra Superior II', NULL, 1
  UNION ALL SELECT 'MAT-24110', 'oculta', 'MAT-24100', NULL, NULL, 1
  UNION ALL SELECT 'MAT-14200', 'oculta', 'MAT-14250', NULL, NULL, 1
  UNION ALL SELECT 'MAT-24632', 'oculta', 'MAT-24630', NULL, NULL, 1
  UNION ALL SELECT 'MAT-12210', 'oculta', 'MAT-24210', NULL, NULL, 1
  UNION ALL SELECT 'MAT-10101', 'catalogo_general', NULL, 'Métodos Cuantitativos para Derecho', NULL, 1
  UNION ALL SELECT 'MAT-11100', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-11101', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-11310', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-12100', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-12101', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-12102', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-12202', 'catalogo_general', NULL, 'Cálculo Vectorial (continuación de Cálculo Multivariado, sólo para matemáticos)', NULL, 1
  UNION ALL SELECT 'MAT-12310', 'catalogo_general', NULL, 'Álgebra Matricial', NULL, 1
  UNION ALL SELECT 'MAT-12349', 'catalogo_general', NULL, 'Principios de Álgebra Lineal (para Economía, 2 horas por semana)', NULL, 1
  UNION ALL SELECT 'MAT-12350', 'catalogo_general', NULL, 'Álgebra Lineal Aplicada (continuación de Cálculo Aplicado)', NULL, 1
  UNION ALL SELECT 'MAT-12351', 'catalogo_general', NULL, 'Álgebra Lineal (2 horas a la semana, continuación de Principios de Álgebra Lineal)', NULL, 1
  UNION ALL SELECT 'MAT-14100', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-14101', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-14102', 'catalogo_general', NULL, 'Cálculo Diferencial e Integral III', NULL, 1
  UNION ALL SELECT 'MAT-14250', 'catalogo_general', NULL, 'Geometría Vectorial', NULL, 1
  UNION ALL SELECT 'MAT-14280', 'catalogo_general', NULL, 'Pensamiento Matemático', NULL, 1
  UNION ALL SELECT 'MAT-14281', 'catalogo_general', NULL, 'Matemáticas Discretas', NULL, 1
  UNION ALL SELECT 'MAT-14850', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-24100', 'catalogo_general', NULL, 'Principios de Análisis Real', NULL, 1
  UNION ALL SELECT 'MAT-24111', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-24210', 'catalogo_general', NULL, 'Sistemas Dinámicos I', NULL, 1
  UNION ALL SELECT 'MAT-24211', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-24220', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-24406', 'catalogo_general', NULL, 'Análisis Numérico I', NULL, 1
  UNION ALL SELECT 'MAT-24407', 'catalogo_general', NULL, 'Análisis Numérico II', NULL, 1
  UNION ALL SELECT 'MAT-24410', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-24430', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-24500', 'catalogo_general', NULL, NULL, NULL, 1
  UNION ALL SELECT 'MAT-24630', 'catalogo_general', NULL, 'Matemáticas Aplicadas a la Economía', NULL, 1
  UNION ALL SELECT 'MAT-14310', 'catalogo_general', NULL, 'Álgebra Lineal', NULL, 0
  UNION ALL SELECT 'MAT-24431', 'catalogo_general', NULL, 'Optimización Numérica I (8 créditos)', NULL, 0
  UNION ALL SELECT 'MAT-24433', 'catalogo_general', NULL, 'Optimización Numérica I (6 créditos)', NULL, 0
  UNION ALL SELECT 'MAT-24101', 'catalogo_general', NULL, NULL, NULL, 0
  UNION ALL SELECT 'MAT-14201', 'catalogo_general', NULL, 'Geometría Analítica II', NULL, 0
  UNION ALL SELECT 'MAT-22211', 'catalogo_general', NULL, NULL, NULL, 0
  UNION ALL SELECT 'MAT-22600', 'catalogo_general', NULL, 'Matemáticas Financieras I', NULL, 0
  UNION ALL SELECT 'MAT-24121', 'catalogo_general', NULL, NULL, NULL, 0
) v
JOIN materia m ON m.clave = v.clave COLLATE utf8mb4_unicode_ci
LEFT JOIN materia a ON a.clave = v.alias_de COLLATE utf8mb4_unicode_ci
CROSS JOIN semestre s
WHERE s.tipo = 'primavera' AND s.anio = 2027;

COMMIT;

-- -----------------------------------------------------------------------------
-- Verificacion
-- -----------------------------------------------------------------------------
--   SELECT mc.seccion, COUNT(*) FROM materia_cuestionario mc
--     JOIN materia m ON m.id = mc.materia_id
--    WHERE m.clave LIKE 'MAT-%'
--    GROUP BY mc.seccion;
--   -- esperado: cobertura_departamental 5, catalogo_general 38, oculta 8
--
--   SELECT COUNT(*) FROM materia_cuestionario WHERE revisado = 0;  -- esperado: 8
--
--   -- ninguna materia MAT activa se queda sin fila (esperado: 0):
--   SELECT COUNT(*) FROM materia m
--    WHERE m.clave LIKE 'MAT-%' AND m.activa = 1
--      AND m.id NOT IN (SELECT materia_id FROM materia_cuestionario);
