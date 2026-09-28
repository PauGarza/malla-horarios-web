-- =============================================================================
-- Autoplanear — datos reales del Departamento de Matematicas (MySQL/MariaDB)
--
-- Traduccion de DACE/BD/datos-matematicas.sql, que es PostgreSQL. Ese sigue
-- siendo el original: si cambian los datos, se cambian alla y se vuelve a
-- generar esto.
--
-- Fuente ultima: BD/datos raw/Cursos.xlsx (estimacion de demanda Mat 202603)
--                BD/datos raw/Profesores.xlsx (concentrado primavera 2027)
--
-- Orden de carga:
--   schema-mysql.sql -> checks-como-triggers.sql -> triggers-mysql.sql
--   -> seed-mysql.sql -> ESTE ARCHIVO -> datos-matematicas-cuestionario-mysql.sql
--   -> cargar-profesores.php
--
-- LOS PROFESORES NO ESTAN AQUI. El original los inserta con
-- crypt(cu, gen_salt('bf')), que es pgcrypto: MySQL no tiene bcrypt en ninguna
-- forma. Van en cargar-profesores.php, que usa password_hash() de PHP — la
-- misma funcion que despues los verifica en login.php.
--
-- Tres diferencias mecanicas con el original, todas por MariaDB 5.5:
--   FROM (VALUES ...) AS v(a,b)  ->  derivado con SELECT ... UNION ALL
--   ON CONFLICT DO NOTHING       ->  INSERT IGNORE
--   ::text, ::rol_enum, ...      ->  se quitan; MySQL no los necesita
-- Todo se sigue resolviendo por clave natural (clave_prefijo, clave), nunca por
-- id: los ids difieren entre instalaciones.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- 1. Materias del catalogo de Matematicas (51)
--
-- Los nombres se cargan tal como los reporta Servicios Escolares, INCLUIDOS SUS
-- TYPOS (ej. 'Mètodos Cuantitativos para Der.'), para poder cotejar contra el
-- reporte original. Donde el typo estorba al profesor se corrige con
-- materia_cuestionario.etiqueta, no aqui.
-- -----------------------------------------------------------------------------

INSERT IGNORE INTO materia (clave, nombre, creditos, departamento_id)
SELECT v.clave, v.nombre, v.creditos, d.id
FROM (
  SELECT 'MAT-10101' AS clave, 'Mètodos Cuantitativos para Der.' AS nombre, 6 AS creditos
  UNION ALL SELECT 'MAT-11100', 'Matemáticas I', 9
  UNION ALL SELECT 'MAT-11101', 'Matemáticas II', 9
  UNION ALL SELECT 'MAT-11310', 'Matemáticas III', 8
  UNION ALL SELECT 'MAT-12100', 'Cálculo I', 9
  UNION ALL SELECT 'MAT-12101', 'Cálculo II', 9
  UNION ALL SELECT 'MAT-12102', 'Cálculo III', 9
  UNION ALL SELECT 'MAT-12200', 'Cálculo Univariado', 9
  UNION ALL SELECT 'MAT-12201', 'Cálculo Multivariado', 9
  UNION ALL SELECT 'MAT-12202', 'Cálculo Vectorial', 9
  UNION ALL SELECT 'MAT-12210', 'Sistemas Dinámicos', 6
  UNION ALL SELECT 'MAT-12220', 'Cálculo de una variable', 9
  UNION ALL SELECT 'MAT-12221', 'Cálculo en Varias Variables', 9
  UNION ALL SELECT 'MAT-12250', 'Cálculo Aplicado', 9
  UNION ALL SELECT 'MAT-12310', 'Algebra Matricial', 8
  UNION ALL SELECT 'MAT-12349', 'Principios de Algebra LIneal', 4
  UNION ALL SELECT 'MAT-12350', 'Algebra Lineal Aplicada', 8
  UNION ALL SELECT 'MAT-12351', 'Algebra Lineal', 4
  UNION ALL SELECT 'MAT-14100', 'Cálculo Diferencial e Integral I', 8
  UNION ALL SELECT 'MAT-14101', 'Cálculo Diferencial e Integral II', 8
  UNION ALL SELECT 'MAT-14102', 'Cálculo Diferencial Integral III', 8
  UNION ALL SELECT 'MAT-14200', 'Geometría Analítica I', 6
  UNION ALL SELECT 'MAT-14201', 'Geometría Analítica II', 8
  UNION ALL SELECT 'MAT-14250', 'Geometría Vectorial', 6
  UNION ALL SELECT 'MAT-14280', 'Pensamiento Matemático', 6
  UNION ALL SELECT 'MAT-14281', 'Matemáticas Discretas', 6
  UNION ALL SELECT 'MAT-14300', 'Algebra Superior I', 6
  UNION ALL SELECT 'MAT-14301', 'Algebra Superior II', 6
  UNION ALL SELECT 'MAT-14310', 'Algebra Lineal', 8
  UNION ALL SELECT 'MAT-14390', 'Matemática Computacional', 8
  UNION ALL SELECT 'MAT-14400', 'Cálculo Numérico I', 8
  UNION ALL SELECT 'MAT-14850', 'Modelos Matemáticos I', 6
  UNION ALL SELECT 'MAT-22211', 'Optimización', 6
  UNION ALL SELECT 'MAT-22600', 'Matemàticas Financieras I', 6
  UNION ALL SELECT 'MAT-24100', 'Principios de Análisis Real', 6
  UNION ALL SELECT 'MAT-24101', 'Análisis Real', 6
  UNION ALL SELECT 'MAT-24110', 'Análisis Matemático I', 6
  UNION ALL SELECT 'MAT-24111', 'Análisis Matemático II', 6
  UNION ALL SELECT 'MAT-24121', 'Análisis Complejo', 6
  UNION ALL SELECT 'MAT-24210', 'Sistemas Dinámicos I', 6
  UNION ALL SELECT 'MAT-24211', 'Sistemas Dinámicos II', 6
  UNION ALL SELECT 'MAT-24220', 'Ecuaciones Diferenciales Parciales', 6
  UNION ALL SELECT 'MAT-24406', 'Análisis Numérico I', 8
  UNION ALL SELECT 'MAT-24407', 'Análisis Numérico II', 6
  UNION ALL SELECT 'MAT-24410', 'Programación Lineal', 6
  UNION ALL SELECT 'MAT-24430', 'Análisis Aplicado I', 6
  UNION ALL SELECT 'MAT-24431', 'Optimización Numérica I', 8
  UNION ALL SELECT 'MAT-24433', 'Optimización Numérica I', 6
  UNION ALL SELECT 'MAT-24500', 'Investigación de Operaciones I', 6
  UNION ALL SELECT 'MAT-24630', 'Mat. Aplicadas a la Economía', 6
  UNION ALL SELECT 'MAT-24632', 'Métodos Dinámicos para la Economía', 6
) v
CROSS JOIN departamento d
WHERE d.clave_prefijo = 'MAT';

-- -----------------------------------------------------------------------------
-- 2. Co-oferta: claves distintas que son la misma clase (54 pares dirigidos)
--
-- Derivado del reporte 'Profesores de licenciatura con el mismo horario': dentro
-- de un bloque, la materia con 100% de responsabilidad y la(s) de 0% comparten
-- profesor, horario y salon — o sea son la misma clase con otra clave. Se
-- guardan las DOS direcciones del par.
-- -----------------------------------------------------------------------------

INSERT IGNORE INTO materia_co_oferta (materia_id, co_ofertada_id)
SELECT m1.id, m2.id
FROM (
  SELECT 'MAT-10101' AS clave_a, 'MAT-11100' AS clave_b
  UNION ALL SELECT 'MAT-11100', 'MAT-10101'
  UNION ALL SELECT 'MAT-11100', 'MAT-12220'
  UNION ALL SELECT 'MAT-11100', 'MAT-12250'
  UNION ALL SELECT 'MAT-11101', 'MAT-11310'
  UNION ALL SELECT 'MAT-11101', 'MAT-12201'
  UNION ALL SELECT 'MAT-11101', 'MAT-12220'
  UNION ALL SELECT 'MAT-11101', 'MAT-12221'
  UNION ALL SELECT 'MAT-11101', 'MAT-12310'
  UNION ALL SELECT 'MAT-11101', 'MAT-12350'
  UNION ALL SELECT 'MAT-11310', 'MAT-11101'
  UNION ALL SELECT 'MAT-11310', 'MAT-12350'
  UNION ALL SELECT 'MAT-12101', 'MAT-12201'
  UNION ALL SELECT 'MAT-12101', 'MAT-12220'
  UNION ALL SELECT 'MAT-12101', 'MAT-12221'
  UNION ALL SELECT 'MAT-12102', 'MAT-14101'
  UNION ALL SELECT 'MAT-12200', 'MAT-14102'
  UNION ALL SELECT 'MAT-12201', 'MAT-11101'
  UNION ALL SELECT 'MAT-12201', 'MAT-12101'
  UNION ALL SELECT 'MAT-12201', 'MAT-14102'
  UNION ALL SELECT 'MAT-12210', 'MAT-24210'
  UNION ALL SELECT 'MAT-12220', 'MAT-11100'
  UNION ALL SELECT 'MAT-12220', 'MAT-11101'
  UNION ALL SELECT 'MAT-12220', 'MAT-12101'
  UNION ALL SELECT 'MAT-12221', 'MAT-11101'
  UNION ALL SELECT 'MAT-12221', 'MAT-12101'
  UNION ALL SELECT 'MAT-12221', 'MAT-14102'
  UNION ALL SELECT 'MAT-12250', 'MAT-11100'
  UNION ALL SELECT 'MAT-12310', 'MAT-11101'
  UNION ALL SELECT 'MAT-12310', 'MAT-12350'
  UNION ALL SELECT 'MAT-12350', 'MAT-11101'
  UNION ALL SELECT 'MAT-12350', 'MAT-11310'
  UNION ALL SELECT 'MAT-12350', 'MAT-12310'
  UNION ALL SELECT 'MAT-14101', 'MAT-12102'
  UNION ALL SELECT 'MAT-14102', 'MAT-12200'
  UNION ALL SELECT 'MAT-14102', 'MAT-12201'
  UNION ALL SELECT 'MAT-14102', 'MAT-12221'
  UNION ALL SELECT 'MAT-14280', 'MAT-14300'
  UNION ALL SELECT 'MAT-14281', 'MAT-14301'
  UNION ALL SELECT 'MAT-14300', 'MAT-14280'
  UNION ALL SELECT 'MAT-14301', 'MAT-14281'
  UNION ALL SELECT 'MAT-14390', 'MAT-24406'
  UNION ALL SELECT 'MAT-14400', 'MAT-24407'
  UNION ALL SELECT 'MAT-24100', 'MAT-24110'
  UNION ALL SELECT 'MAT-24101', 'MAT-24111'
  UNION ALL SELECT 'MAT-24110', 'MAT-24100'
  UNION ALL SELECT 'MAT-24111', 'MAT-24101'
  UNION ALL SELECT 'MAT-24210', 'MAT-12210'
  UNION ALL SELECT 'MAT-24406', 'MAT-14390'
  UNION ALL SELECT 'MAT-24407', 'MAT-14400'
  UNION ALL SELECT 'MAT-24430', 'MAT-24433'
  UNION ALL SELECT 'MAT-24433', 'MAT-24430'
  UNION ALL SELECT 'MAT-24630', 'MAT-24632'
  UNION ALL SELECT 'MAT-24632', 'MAT-24630'
) v
JOIN materia m1 ON m1.clave = v.clave_a COLLATE utf8mb4_unicode_ci
JOIN materia m2 ON m2.clave = v.clave_b COLLATE utf8mb4_unicode_ci;

-- Pendiente: este par cruza departamentos y no se puede insertar hasta que se
-- cargue el catalogo del otro departamento (el JOIN no lo encontraria hoy, por
-- eso queda comentado en vez de fallar en silencio):
--     ('MAT-22600', 'ACT-11310')

COMMIT;

-- -----------------------------------------------------------------------------
-- Verificacion
-- -----------------------------------------------------------------------------
--   SELECT COUNT(*) FROM materia WHERE clave LIKE 'MAT-%';   -- esperado: 51
--   SELECT COUNT(*) FROM materia_co_oferta;                  -- esperado: 54
