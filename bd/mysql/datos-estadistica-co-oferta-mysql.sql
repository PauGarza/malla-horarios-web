-- =============================================================================
-- Autoplanear — materias equivalentes (co-oferta) de Estadística
--
-- Agregado 2026-10-02. Se pega en phpMyAdmin DESPUÉS de
-- datos-estadistica-mysql.sql (necesita las 27 materias EST).
--
-- materia_co_oferta = claves que SON la misma clase (mismo profesor, mismo
-- horario, mismo salón). Es lo que el Catálogo de materias muestra como
-- "equivalentes".
--
-- Fuente de la parte 1: la columna "materias equivalentes" de
-- DACE/BD/datos raw/Cursos.xlsx (hoja Cursos_202603) — la MISMA fuente de los
-- 54 pares de Matemáticas. Se carga tal cual viene, fila por fila (una fila
-- por dirección), igual que se hizo con Matemáticas: 10 filas.
--
-- Cotejadas contra los grupos reales de LE/Horarios_Primavera_2026.pdf y de
-- "Info servicios escolares/max-min actual.pdf" (otoño 2026): las 10 se
-- imparten efectivamente juntas.
--
-- La parte 2 son cruces que se VEN en esos horarios pero NO están en la lista
-- oficial. Van comentados: se cargan solo si Estadística los confirma.
--
-- Idempotente: INSERT IGNORE sobre la llave primaria (materia_id, co_ofertada_id).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Parte 1. Lista oficial (Cursos.xlsx): 10 filas
-- -----------------------------------------------------------------------------

INSERT IGNORE INTO materia_co_oferta (materia_id, co_ofertada_id)
SELECT m1.id, m2.id
  FROM (
            SELECT 'EST-11103' AS clave_a, 'EST-11104' AS clave_b
  UNION ALL SELECT 'EST-11103', 'EST-11105'
  UNION ALL SELECT 'EST-11104', 'EST-11103'
  UNION ALL SELECT 'EST-11105', 'EST-11103'
  UNION ALL SELECT 'EST-14101', 'EST-24126'
  UNION ALL SELECT 'EST-24126', 'EST-14101'
  UNION ALL SELECT 'EST-14102', 'EST-24127'
  UNION ALL SELECT 'EST-24127', 'EST-14102'
  UNION ALL SELECT 'EST-24105', 'EST-24124'
  UNION ALL SELECT 'EST-24124', 'EST-24105'
       ) AS v
  JOIN materia m1 ON m1.clave = v.clave_a
  JOIN materia m2 ON m2.clave = v.clave_b;

-- -----------------------------------------------------------------------------
-- Parte 2. Cruces vistos en los horarios, NO en la lista oficial (comentados)
--
--   EST-11104 <-> EST-11105   otoño 2026: 11103, 11104 y 11105 juntas
--                             (Islas LU MI 08:30 RH109; Santos MA JU 17:30 RH109).
--   EST-21104 <-> EST-24105   primavera 2026: las tres juntas (Battagliola
--   EST-21104 <-> EST-24124   MA JU 11:30 RH311; Cuervo MA JU 20:30 RHB-2).
--   EST-24106 <-> EST-24125   los dos semestres (Campos LU MI 07:00 RH108;
--                             Lunagómez LU MI 17:30 RHB-1).
--   EST-13101 <-> EST-13102   otoño 2026, Campos, RHB-2, pero 08:00-10:00 vs
--                             08:00-09:30: comparten salón y arranque, no la
--                             duración. El más dudoso.
--
-- Para cargarlos, quita el "-- " del inicio de cada línea del bloque y córrelo.
-- -----------------------------------------------------------------------------

-- INSERT IGNORE INTO materia_co_oferta (materia_id, co_ofertada_id)
-- SELECT m1.id, m2.id
--   FROM (
--             SELECT 'EST-11104' AS clave_a, 'EST-11105' AS clave_b
--   UNION ALL SELECT 'EST-11105', 'EST-11104'
--   UNION ALL SELECT 'EST-21104', 'EST-24105'
--   UNION ALL SELECT 'EST-24105', 'EST-21104'
--   UNION ALL SELECT 'EST-21104', 'EST-24124'
--   UNION ALL SELECT 'EST-24124', 'EST-21104'
--   UNION ALL SELECT 'EST-24106', 'EST-24125'
--   UNION ALL SELECT 'EST-24125', 'EST-24106'
--        ) AS v
--   JOIN materia m1 ON m1.clave = v.clave_a
--   JOIN materia m2 ON m2.clave = v.clave_b;

-- -----------------------------------------------------------------------------
-- Verificación: la parte 1 sola da 10 filas (18 con la parte 2).
-- -----------------------------------------------------------------------------
SELECT a.clave, a.nombre, '=' AS es, b.clave AS equivalente, b.nombre AS nombre_equivalente
  FROM materia_co_oferta c
  JOIN materia a ON a.id = c.materia_id
  JOIN materia b ON b.id = c.co_ofertada_id
 WHERE a.clave LIKE 'EST-%'
 ORDER BY a.clave, b.clave;
