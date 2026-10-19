-- =============================================================================
-- Actuaría — programación de Primavera 2027 (Enero–Mayo 2027), FIJA (D45)
--
-- Fuente: DACE/Actuaria/PROGRAMACIÓNPRIM2027.pdf, la programación que entregó
-- el Departamento de Actuaría y Seguros. Actuaría no usa el sistema (sus
-- profesores no contestan el formulario), pero su resultado se registra aquí
-- para que salga en la malla y para que el motor lo respete.
--
-- Qué escribe, en una sola transacción:
--   1. materia            las 15 claves ACT del PDF (6 créditos; ACT-22309, 7),
--                         con los créditos de los planes de estudio
--                         (DACC/MATERIAS planesOracle.csv). MAT-22600 ya existe.
--   2. materia_co_oferta  los tres pares que el PDF da como una sola clase, en
--                         los dos sentidos: ACT-11310 / MAT-22600 (el par que
--                         datos-matematicas-mysql.sql dejó pendiente),
--                         ACT-15360 / ACT-15357 y ACT-22306 / ACT-22320.
--   3. profesor           13 profesores SIN CUENTA (cu NULL, activo 0; ver
--                         migracion-2026-10-19-profesor-sin-cuenta.sql).
--                         Leonardo Rojas NO se crea: es Rojas Nandayapa, que ya
--                         tiene cuenta en Estadística (ajuste del 2026-10-13).
--   4. grupo / imparte / imparte_profesor / imparte_co_oferta / imparte_horario
--                         19 clases = 23 grupos (una fila de grupo por clave),
--                         publicado = 1, crn NULL (lo da Servicios Escolares),
--                         sin salón (el PDF no lo trae) y por eso en
--                         'en_asignacion', igual que lo que escribe el motor en
--                         modo sin salones (D44).
--
-- Publicado = 1 es lo que la vuelve fija: el motor la recibe en grupos_fijos y
-- ninguna subida la reemplaza (convencion-datos-motor.md §3.7 y §5). Efectos
-- en los otros departamentos:
--   - Matemáticas: MAT-22600 001 (espejo de ACT-11310, Ernesto Gómez, MA-JU
--     08:30-10:00) ya cuenta como un grupo abierto de MAT-22600.
--   - Estadística: Rojas Nandayapa queda ocupado MA-JU 17:30-19:00
--     (ACT-25354 001); el motor no le pone nada a esa hora.
--
-- ACT-22320 002 / ACT-22306 002 va LU-MI de 20:30 a 22:00, franjas que la
-- rejilla tiene solo para Estadística. Es correcto: la restricción es del
-- formulario, y el validador del motor ya no revisa la franja contra el
-- departamento en los grupos publicados (D45).
--
-- Requiere migracion-2026-10-19-profesor-sin-cuenta.sql (sin ella, el
-- INSERT de profesor falla por cu NOT NULL y no se escribe nada).
--
-- UNA SOLA VEZ. Si se corre de nuevo, falla en el primer grupo por la llave
-- uq_grupo_numero y, como todo va en una transacción que no llega al COMMIT,
-- no cambia nada. Lo mismo si MAT-22600 ya tuviera un grupo 001 en Primavera
-- 2027 (por ejemplo, de una subida del motor sin publicar): la consulta
-- "Antes" lo muestra.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

SET @act = (SELECT id FROM departamento WHERE clave_prefijo = 'ACT');
SET @sem = (SELECT id FROM semestre WHERE tipo = 'primavera' AND anio = 2027);
SET @leo = (SELECT id FROM profesor WHERE nombre LIKE '%Rojas Nandayapa%');

-- -----------------------------------------------------------------------------
-- Antes
-- -----------------------------------------------------------------------------

-- Una fila: los tres ids llenos. Si @leo sale NULL, el nombre no coincidió y
-- el INSERT de imparte_profesor falla (no se escribe nada).
SELECT @act AS actuaria, @sem AS primavera_2027, @leo AS rojas_nandayapa,
       (SELECT CONCAT(p.nombre, ' · ', d.nombre) FROM profesor p JOIN departamento d ON d.id = p.departamento_id
         WHERE p.id = @leo) AS rojas_nandayapa_es;

-- Vacía: ningún grupo de estas claves en Primavera 2027.
SELECT m.clave, g.numero, g.publicado, g.estado
  FROM grupo g
  JOIN materia m ON m.id = g.materia_id
 WHERE g.semestre_id = @sem
   AND (m.clave LIKE 'ACT-%' OR m.clave = 'MAT-22600');

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- 1. Materias
-- -----------------------------------------------------------------------------

INSERT INTO materia (clave, nombre, creditos, departamento_id, anual, activa)
SELECT v.clave, v.nombre, v.creditos, @act, 0, 1
  FROM (          SELECT 'ACT-11300' AS clave, 'Cálculo Actuarial I' AS nombre, 6 AS creditos
        UNION ALL SELECT 'ACT-11301', 'Cálculo Actuarial II', 6
        UNION ALL SELECT 'ACT-11302', 'Cálculo Actuarial III', 6
        UNION ALL SELECT 'ACT-11303', 'Modelos Actuariales I', 6
        UNION ALL SELECT 'ACT-11310', 'Introducción al Cálculo Actuarial', 6
        UNION ALL SELECT 'ACT-13307', 'Estadística Aplicada a la Actuaría', 6
        UNION ALL SELECT 'ACT-15352', 'Planes de Beneficios', 6
        UNION ALL SELECT 'ACT-15353', 'Práctica Actuarial y Marco Institucional', 6
        UNION ALL SELECT 'ACT-15357', 'Principios de Seguro', 6
        UNION ALL SELECT 'ACT-15358', 'Sistemas de Seguros', 6
        UNION ALL SELECT 'ACT-15360', 'Introducción a la Actuaría', 6
        UNION ALL SELECT 'ACT-22306', 'Matemáticas Financieras II', 6
        UNION ALL SELECT 'ACT-22309', 'Matemáticas Financieras III', 7
        UNION ALL SELECT 'ACT-22320', 'Activos y Pasivos Actuariales', 6
        UNION ALL SELECT 'ACT-25354', 'Administración Cuantitativa de Riesgos', 6
  ) v
 WHERE NOT EXISTS (SELECT 1 FROM materia m WHERE m.clave = v.clave COLLATE utf8mb4_unicode_ci);

-- -----------------------------------------------------------------------------
-- 2. Co-ofertas (en los dos sentidos, como las de Matemáticas)
-- -----------------------------------------------------------------------------

INSERT IGNORE INTO materia_co_oferta (materia_id, co_ofertada_id)
SELECT m1.id, m2.id
  FROM (          SELECT 'ACT-11310' AS clave_a, 'MAT-22600' AS clave_b
        UNION ALL SELECT 'MAT-22600', 'ACT-11310'
        UNION ALL SELECT 'ACT-15360', 'ACT-15357'
        UNION ALL SELECT 'ACT-15357', 'ACT-15360'
        UNION ALL SELECT 'ACT-22306', 'ACT-22320'
        UNION ALL SELECT 'ACT-22320', 'ACT-22306'
  ) v
  JOIN materia m1 ON m1.clave = v.clave_a COLLATE utf8mb4_unicode_ci
  JOIN materia m2 ON m2.clave = v.clave_b COLLATE utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- La programación, tal cual el PDF
--
-- Una clase = un grupo físico. Las que el PDF da con dos claves llevan dos
-- filas en tmp_act_grupo: la primera clave es la principal (porcentaje 100,
-- la que va arriba en el PDF) y la otra el espejo (0), como las escribe el
-- motor (convencion-datos-motor.md §4.2).
--
-- Tablas TEMPORARY: no provocan COMMIT implícito (un CREATE TABLE normal sí)
-- y desaparecen al cerrar la conexión. MySQL no deja leer dos veces la misma
-- tabla temporal en una consulta, por eso tmp_act_grupo2 es una copia.
-- -----------------------------------------------------------------------------

CREATE TEMPORARY TABLE tmp_act_clase (
    clase  INT PRIMARY KEY,
    dias   VARCHAR(5) NOT NULL,
    inicio TIME NOT NULL,
    fin    TIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE tmp_act_grupo (
    clase      INT NOT NULL,
    clave      VARCHAR(20) NOT NULL,
    numero     VARCHAR(3) NOT NULL,
    porcentaje DECIMAL(5,2) NOT NULL,
    grupo_id   INT NULL,
    imparte_id INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE tmp_act_prof (
    clase       INT NOT NULL,
    nombre      VARCHAR(255) NOT NULL,
    profesor_id INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_act_clase (clase, dias, inicio, fin) VALUES
    ( 1, 'LU-MI', '17:30', '19:00'),   -- ACT-11300 001
    ( 2, 'MA-JU', '17:30', '19:00'),   -- ACT-11300 002
    ( 3, 'LU-MI', '19:00', '20:30'),   -- ACT-11300 003
    ( 4, 'MA-JU', '19:00', '20:30'),   -- ACT-11301 001
    ( 5, 'MA-JU', '17:30', '19:00'),   -- ACT-11301 002
    ( 6, 'MA-JU', '07:00', '08:30'),   -- ACT-11302 001
    ( 7, 'MA-JU', '19:00', '20:30'),   -- ACT-11303 001
    ( 8, 'MA-JU', '08:30', '10:00'),   -- ACT-11310 / MAT-22600 001
    ( 9, 'LU-MI', '08:30', '10:00'),   -- ACT-13307 001
    (10, 'MA-JU', '08:30', '10:00'),   -- ACT-13307 002
    (11, 'LU-MI', '07:00', '08:30'),   -- ACT-15352 001
    (12, 'LU-MI', '19:00', '20:30'),   -- ACT-15353 001
    (13, 'MA-JU', '07:00', '08:30'),   -- ACT-15358 001
    (14, 'MA-JU', '07:00', '08:30'),   -- ACT-15360 / ACT-15357 001
    (15, 'LU-MI', '17:30', '19:00'),   -- ACT-22306 / ACT-22320 001
    (16, 'LU-MI', '20:30', '22:00'),   -- ACT-22306 / ACT-22320 002
    (17, 'LU-MI', '07:00', '08:30'),   -- ACT-22309 001
    (18, 'MA-JU', '17:30', '19:00'),   -- ACT-25354 001
    (19, 'VI',    '16:00', '19:00');   -- ACT-25354 002

INSERT INTO tmp_act_grupo (clase, clave, numero, porcentaje) VALUES
    ( 1, 'ACT-11300', '001', 100), ( 2, 'ACT-11300', '002', 100), ( 3, 'ACT-11300', '003', 100),
    ( 4, 'ACT-11301', '001', 100), ( 5, 'ACT-11301', '002', 100),
    ( 6, 'ACT-11302', '001', 100),
    ( 7, 'ACT-11303', '001', 100),
    ( 8, 'ACT-11310', '001', 100), ( 8, 'MAT-22600', '001',   0),
    ( 9, 'ACT-13307', '001', 100), (10, 'ACT-13307', '002', 100),
    (11, 'ACT-15352', '001', 100),
    (12, 'ACT-15353', '001', 100),
    (13, 'ACT-15358', '001', 100),
    (14, 'ACT-15360', '001', 100), (14, 'ACT-15357', '001',   0),
    (15, 'ACT-22306', '001', 100), (15, 'ACT-22320', '001',   0),
    (16, 'ACT-22306', '002', 100), (16, 'ACT-22320', '002',   0),
    (17, 'ACT-22309', '001', 100),
    (18, 'ACT-25354', '001', 100), (19, 'ACT-25354', '002', 100);

INSERT INTO tmp_act_prof (clase, nombre) VALUES
    ( 1, 'Hugo Cuevas'),
    ( 2, 'Sergio García'),
    ( 3, 'Pedro Trejo'),
    ( 4, 'Erika Chávez'),
    ( 5, 'Angeles Yáñez'),
    ( 6, 'David Ruelas'),
    ( 7, 'Sergio García'),
    ( 8, 'Ernesto Gómez'),
    ( 9, 'Mercedes Gregorio'),
    (10, 'Mercedes Gregorio'),
    (11, 'Gabriela Meléndez'),
    (12, 'David Santos'), (12, 'Hugo Cuevas'),
    (13, 'Ernesto Gómez'),
    (14, 'Erika Chávez'),
    (15, 'David Santos'),
    (16, 'Miguel Angel Avila'),
    (17, 'Gerardo Hernández'),
    (18, 'Leonardo Rojas'),
    (19, 'Francisco Gerardo César');

-- -----------------------------------------------------------------------------
-- 3. Profesores sin cuenta
--
-- Se reconocen por nombre exacto Y cu NULL, para no confundirlos nunca con una
-- cuenta real que se llame igual.
-- -----------------------------------------------------------------------------

INSERT INTO profesor (cu, password_hash, nombre, correo, rol, departamento_id, tipo_contrato,
                      password_predeterminada, estado_especial, activo)
SELECT NULL, NULL, x.nombre, NULL, 'profesor', @act, NULL, 0, NULL, 0
  FROM (SELECT DISTINCT nombre FROM tmp_act_prof WHERE nombre <> 'Leonardo Rojas') x
 WHERE NOT EXISTS (SELECT 1 FROM profesor p WHERE p.nombre = x.nombre AND p.cu IS NULL);

UPDATE tmp_act_prof t
  JOIN profesor p ON p.nombre = t.nombre AND p.cu IS NULL
   SET t.profesor_id = p.id;

UPDATE tmp_act_prof SET profesor_id = @leo WHERE nombre = 'Leonardo Rojas';

-- -----------------------------------------------------------------------------
-- 4. Grupos publicados
-- -----------------------------------------------------------------------------

INSERT INTO grupo (crn, materia_id, semestre_id, numero, cupo_maximo, estado, publicado)
SELECT NULL, m.id, @sem, t.numero, NULL, 'en_asignacion', 1
  FROM tmp_act_grupo t
  JOIN materia m ON m.clave = t.clave
 ORDER BY t.clase, t.porcentaje DESC;

UPDATE tmp_act_grupo t
  JOIN materia m ON m.clave = t.clave
  JOIN grupo g   ON g.materia_id = m.id AND g.semestre_id = @sem AND g.numero = t.numero
   SET t.grupo_id = g.id;

INSERT INTO imparte (grupo_id, created_at)
SELECT grupo_id, UTC_TIMESTAMP() FROM tmp_act_grupo ORDER BY grupo_id;

UPDATE tmp_act_grupo t
  JOIN imparte i ON i.grupo_id = t.grupo_id
   SET t.imparte_id = i.id;

INSERT INTO imparte_profesor (imparte_id, profesor_id)
SELECT g.imparte_id, p.profesor_id
  FROM tmp_act_grupo g
  JOIN tmp_act_prof p ON p.clase = g.clase;

-- El vínculo de espejo va ANTES que el horario: el trigger de
-- imparte_horario lo usa para no tomar la otra clave como traslape.
CREATE TEMPORARY TABLE tmp_act_grupo2 ENGINE=InnoDB AS SELECT * FROM tmp_act_grupo;

INSERT INTO imparte_co_oferta (imparte_id, imparte_relacionado_id, porcentaje_responsabilidad)
SELECT a.imparte_id, b.imparte_id, a.porcentaje
  FROM tmp_act_grupo a
  JOIN tmp_act_grupo2 b ON b.clase = a.clase AND b.imparte_id <> a.imparte_id;

-- Un bloque de 30 min por franja entre inicio y fin, en cada día del patrón.
INSERT INTO imparte_horario (imparte_id, dia, franja_id, salon_id)
SELECT g.imparte_id, d.dia, f.id, NULL
  FROM tmp_act_grupo g
  JOIN tmp_act_clase c ON c.clase = g.clase
  JOIN (          SELECT 'LU-MI' AS dias, 'lunes' AS dia
        UNION ALL SELECT 'LU-MI', 'miercoles'
        UNION ALL SELECT 'MA-JU', 'martes'
        UNION ALL SELECT 'MA-JU', 'jueves'
        UNION ALL SELECT 'VI',    'viernes'
  ) d ON d.dias = c.dias COLLATE utf8mb4_unicode_ci
  JOIN franja_horaria f ON f.hora_inicio >= c.inicio AND f.hora_inicio < c.fin
 ORDER BY g.imparte_id, d.dia, f.orden;

COMMIT;

DROP TEMPORARY TABLE tmp_act_clase, tmp_act_grupo, tmp_act_grupo2, tmp_act_prof;

-- -----------------------------------------------------------------------------
-- Después
-- -----------------------------------------------------------------------------

-- 15 materias ACT, 3 pares de co-oferta (6 filas), 13 profesores sin cuenta,
-- 23 grupos publicados, 24 profesores en grupo (uno por clave, y dos en
-- ACT-15353), 8 filas de imparte_co_oferta y 138 bloques de horario
-- (23 grupos × 6 bloques: todas las clases son de 3 h a la semana).
SELECT (SELECT COUNT(*) FROM materia WHERE departamento_id = @act) AS materias_act,
       (SELECT COUNT(*) FROM materia_co_oferta mc JOIN materia m ON m.id = mc.materia_id
         WHERE m.clave IN ('ACT-11310','MAT-22600','ACT-15360','ACT-15357','ACT-22306','ACT-22320')) AS co_ofertas,
       (SELECT COUNT(*) FROM profesor WHERE departamento_id = @act AND cu IS NULL) AS profesores_sin_cuenta,
       (SELECT COUNT(*) FROM grupo g JOIN materia m ON m.id = g.materia_id
         WHERE g.semestre_id = @sem AND g.publicado = 1
           AND (m.departamento_id = @act OR m.clave = 'MAT-22600')) AS grupos,
       (SELECT COUNT(*) FROM imparte_profesor ip JOIN imparte i ON i.id = ip.imparte_id
          JOIN grupo g ON g.id = i.grupo_id JOIN materia m ON m.id = g.materia_id
         WHERE g.semestre_id = @sem AND (m.departamento_id = @act OR m.clave = 'MAT-22600')) AS profesores_en_grupo,
       (SELECT COUNT(*) FROM imparte_co_oferta ico JOIN imparte i ON i.id = ico.imparte_id
          JOIN grupo g ON g.id = i.grupo_id JOIN materia m ON m.id = g.materia_id
         WHERE g.semestre_id = @sem AND (m.departamento_id = @act OR m.clave = 'MAT-22600')) AS co_oferta_grupos,
       (SELECT COUNT(*) FROM imparte_horario ih JOIN imparte i ON i.id = ih.imparte_id
          JOIN grupo g ON g.id = i.grupo_id JOIN materia m ON m.id = g.materia_id
         WHERE g.semestre_id = @sem AND (m.departamento_id = @act OR m.clave = 'MAT-22600')) AS bloques;

-- La malla de Actuaría, como el PDF: una fila por grupo.
SELECT m.clave, m.nombre, g.numero,
       (SELECT GROUP_CONCAT(p.nombre ORDER BY p.nombre SEPARATOR ', ')
          FROM imparte_profesor ip JOIN profesor p ON p.id = ip.profesor_id
         WHERE ip.imparte_id = i.id) AS profesores,
       (SELECT GROUP_CONCAT(DISTINCT ih.dia ORDER BY FIELD(ih.dia,'lunes','martes','miercoles','jueves','viernes'))
          FROM imparte_horario ih WHERE ih.imparte_id = i.id) AS dias,
       (SELECT CONCAT(TIME_FORMAT(MIN(f.hora_inicio), '%H:%i'), '-', TIME_FORMAT(MAX(f.hora_fin), '%H:%i'))
          FROM imparte_horario ih JOIN franja_horaria f ON f.id = ih.franja_id
         WHERE ih.imparte_id = i.id) AS horario,
       g.publicado, g.estado
  FROM grupo g
  JOIN materia m ON m.id = g.materia_id
  JOIN imparte i ON i.grupo_id = g.id
 WHERE g.semestre_id = @sem
   AND (m.departamento_id = @act OR m.clave = 'MAT-22600')
 ORDER BY m.clave, g.numero;
