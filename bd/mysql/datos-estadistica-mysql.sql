-- =============================================================================
-- Autoplanear — catálogo de materias del Departamento de Estadística (27)
--
-- Agregado 2026-10-02. Se pega en phpMyAdmin (base horariosdace, pestaña SQL)
-- sobre una base que ya tiene seed-mysql.sql (el departamento EST existe ahí).
--
-- Fuentes:
--   * "Info servicios escolares/Est 202603 (1).pdf" — la estimación de demanda
--     de Otoño 2026, leída con frontend/src/lib/parserDemanda.js. Clave, nombre
--     y créditos salen de ahí, con los nombres tal como los escribe Servicios
--     Escolares (incluido "Estádistica Aplicada III"), igual que se hizo con
--     Matemáticas: así se puede cotejar contra el reporte original.
--   * DACC/MATERIAS/WEB/planesOracle.csv — los planes de estudio. Trae
--     exactamente las mismas 26 claves EST con los mismos créditos, y de ahí
--     salen los dos nombres que el PDF no trae (EST-13102 y EST-24129).
--   * LE/Horarios_Primavera_2026.pdf — los grupos que de verdad se abrieron en
--     primavera 2026 (cotejado 2026-10-02). Tiene 22 claves: 21 ya estaban y
--     una no venía en ninguna de las dos fuentes anteriores: EST-24108
--     Regresión Avanzada. Las 5 que no se abrieron esa primavera (EST-11105,
--     13102, 24129, 25134, 25146) se quedan: salen del reporte de otoño y de
--     los planes.
--
-- Lo que NO carga, a propósito:
--   * La demanda en sí (estimacion_demanda): el PDF es de Otoño 2026 y el
--     semestre activo es Primavera 2027. Se carga desde la app cuando llegue el
--     reporte correcto.
--   * materia_cuestionario: sin filas, todas las materias caen en la primera
--     sección de materias del formulario de Estadística (regla fail-open de
--     repartir_materias()). El formulario de Estadística no está publicado; la
--     jefatura lo acomoda en "Editar y publicar el formulario".
--   * materia_co_oferta: va en datos-estadistica-co-oferta-mysql.sql. (Al
--     escribir esto se creyó que no había lista oficial; sí la hay: la columna
--     "materias equivalentes" de BD/datos raw/Cursos.xlsx, la misma de
--     Matemáticas.)
--
-- Idempotente: INSERT IGNORE por clave. Correrlo dos veces no duplica ni pisa
-- un nombre que ya se haya corregido a mano en la app.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO materia (clave, nombre, creditos, departamento_id)
SELECT v.clave, v.nombre, v.creditos, d.id
  FROM (
            SELECT 'EST-10101' AS clave, 'Estadística I' AS nombre, 8 AS creditos
  UNION ALL SELECT 'EST-10102', 'Estadística II', 8
  UNION ALL SELECT 'EST-11101', 'Probabilidad', 8
  UNION ALL SELECT 'EST-11102', 'Inferencia Estadística', 8
  UNION ALL SELECT 'EST-11103', 'Econometría I', 6
  UNION ALL SELECT 'EST-11104', 'Econometría', 6
  UNION ALL SELECT 'EST-11105', 'Principios de Regresión Lineal', 6
  UNION ALL SELECT 'EST-13101', 'Métodos Est. Para C. Pol. y R.I.', 8
  -- Sin nombre en el PDF; el de planesOracle.csv es "MET. ESTAD PARA CIENCIAS SOC."
  UNION ALL SELECT 'EST-13102', 'Mét. Estad. para Ciencias Soc.', 6
  UNION ALL SELECT 'EST-14101', 'Cálculo de Probabilidades I', 6
  UNION ALL SELECT 'EST-14102', 'Cálculo de Probabilidades II', 6
  UNION ALL SELECT 'EST-14103', 'Estadística Matemática', 8
  UNION ALL SELECT 'EST-14107', 'Procesos Estocásticos I', 6
  UNION ALL SELECT 'EST-21104', 'Fundamentos de Econometría', 6
  UNION ALL SELECT 'EST-24104', 'Estadística Aplicada I', 6
  UNION ALL SELECT 'EST-24105', 'Estadística Aplicada II', 6
  UNION ALL SELECT 'EST-24106', 'Estádistica Aplicada III', 6
  UNION ALL SELECT 'EST-24107', 'Simulación', 6
  -- Solo en LE/Horarios_Primavera_2026.pdf (grupo 001, LU MI 08:30-10:00).
  -- Ese PDF no trae créditos: 6 es INFERIDO de sus 3 h/semana, la misma
  -- relación que cumplen todas las demás (6 cred <-> 3 h, 8 cred <-> 4 h).
  UNION ALL SELECT 'EST-24108', 'Regresión Avanzada', 6
  UNION ALL SELECT 'EST-24112', 'Estadística Bayesiana', 6
  UNION ALL SELECT 'EST-24124', 'Métodos Lineales', 6
  UNION ALL SELECT 'EST-24125', 'Métodos Multivariados', 6
  UNION ALL SELECT 'EST-24126', 'Cálculo de Probabilidades I', 6
  UNION ALL SELECT 'EST-24127', 'Cálculo de Probabilidades II', 6
  -- Sin nombre en el PDF; el de planesOracle.csv es "FUNDAM. DE VISUALIZAC DE DATOS"
  UNION ALL SELECT 'EST-24129', 'Fundamentos de Visualización de Datos', 6
  UNION ALL SELECT 'EST-25134', 'Aprendizaje Estadístico', 6
  UNION ALL SELECT 'EST-25146', 'Economet. Financiera Actuarial', 6
       ) AS v
  JOIN departamento d ON d.clave_prefijo = 'EST';

-- -----------------------------------------------------------------------------
-- Verificación (debe dar 27, y la segunda consulta 0 filas)
-- -----------------------------------------------------------------------------
--   SELECT COUNT(*) FROM materia m JOIN departamento d ON d.id = m.departamento_id
--    WHERE d.clave_prefijo = 'EST';
--
--   -- Una clave EST colgada de otro departamento sería un error de carga:
--   SELECT m.clave, d.clave_prefijo FROM materia m JOIN departamento d ON d.id = m.departamento_id
--    WHERE m.clave LIKE 'EST-%' AND d.clave_prefijo <> 'EST';
--
-- Los acentos: si ves "EstadÃ­stica", el pegado no fue en utf8mb4 (ver
-- migracion-pasos.md, "Los acentos").
