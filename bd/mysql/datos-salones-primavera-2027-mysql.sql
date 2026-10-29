-- =============================================================================
-- Salones de Primavera 2027 por departamento (asignación de Servicios Escolares)
--
-- Fuente: los tres reportes "ASIGNACIÓN DE SALONES SZRMEET — Primavera de 2027
-- Lic." de Servicios Escolares (DACE/Info servicios escolares/SALONES PRIMAVERA
-- 2027 ACT_.pdf, EST_.pdf y MAT_.pdf; 23 y 26 de octubre de 2026). Cada renglón
-- trae capacidad, ventana horaria (07:00-13:59, 07:00-14:29 o 16:00-21:59) y
-- los días marcados. El nombre del salón y el edificio vienen tachados.
--
-- Qué escribe:
--   1. salon   25 salones provisionales: MAT 01–16, EST 01–06, ACT 01–03.
--              Edificio 'Por confirmar', la capacidad del reporte, tipo NULL.
--   2. salon_disponibilidad_departamento
--              cada salón solo para SU departamento, en Primavera 2027, en los
--              días marcados y en las franjas de 30 min dentro de su ventana.
--
-- Decisiones:
--   - Los 41 renglones del reporte se juntan en 25 salones. Se junta un
--     renglón con el siguiente cuando son del mismo departamento, tienen la
--     misma capacidad y no se traslapan (casi siempre uno de 07:00 y otro de
--     16:00). Casi seguro son el mismo salón físico, pero el nombre viene
--     tachado y no hay cómo comprobarlo. Juntarlos no pierde nada: una sesión
--     es de un solo día y nunca va de la mañana a la tarde, así que el salón
--     junto da exactamente las mismas horas que los dos renglones. Columna
--     `salon` de abajo. No se juntan:
--       MAT 04 (37) y MAT 05 (36): capacidades distintas.
--       MAT 11 (50, mañana) y MAT 15 (53, tarde): no son vecinos y tienen
--         capacidades distintas.
--       EST 01 (30, MA-JU mañana) y EST 04 (41, MA-JU tarde): igual.
--       ACT 01 y ACT 02: los dos son de tarde y se traslapan MA-JU.
--     Cuando lleguen los nombres se renombra (UPDATE salon SET nombre =
--     'RH107', edificio = ... WHERE nombre = 'MAT 01' AND edificio = 'Por
--     confirmar'). Si un salón junto resulta ser dos salones, se crea el
--     segundo y se le pasa la disponibilidad de su renglón.
--   - 07:00-13:59 = franjas de 07:00 a 13:30; 07:00-14:29 suma la de 14:00 (que
--     de todos modos solo existe martes y jueves, y esos renglones son MA-JU);
--     16:00-21:59 = de 16:00 a 21:30.
--   - Las franjas de 20:00-22:00 se cargan también para Matemáticas y
--     Actuaría, sin la restricción por departamento de franja_horaria: es lo
--     que asignó Escolares, y Actuaría tiene grupos fijos a esa hora que
--     necesitan salón autorizado (mismo criterio que los salones dummy). No abre
--     esas horas en el formulario ni en el motor: eso lo sigue decidiendo
--     franja_horaria.departamento_id.
--
-- Totales esperados (verificación al final). Los bloques son los mismos que
-- con un salón por renglón: si dos renglones juntos se traslaparan, el INSERT
-- IGNORE se comería bloques y el total no cuadraría.
--   ACT   3 salones,   154 bloques
--   EST   6 salones,   486 bloques
--   MAT  16 salones, 1,572 bloques      -> 25 salones, 2,212 bloques
--
-- NO toca los salones dummy (ids 9001–9012, edificio 'Dummy (minimo de
-- salones)'). Mientras existan, la descarga del motor con salones trae los dos
-- juegos. Quitarlos es un paso aparte.
--
-- Repetible: si los salones ya existen (mismo nombre y edificio 'Por
-- confirmar') no se duplican, y la disponibilidad va con INSERT IGNORE.
-- Correr completo en phpMyAdmin; no depende del deploy.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sem = (SELECT id FROM semestre WHERE tipo = 'primavera' AND anio = 2027);

-- Los renglones de los tres reportes, tal cual, con el salón al que van.
CREATE TEMPORARY TABLE tmp_salon_escolares (
    depto     CHAR(3)  NOT NULL,
    renglon   TINYINT  NOT NULL COMMENT 'Renglón del PDF del departamento.',
    salon     TINYINT  NOT NULL COMMENT 'Número del salón provisional (MAT 01...).',
    capacidad INT      NOT NULL,
    desde     TIME     NOT NULL,
    hasta     TIME     NOT NULL,
    dias      SET('lunes','martes','miercoles','jueves','viernes') NOT NULL,
    PRIMARY KEY (depto, renglon)
);

INSERT INTO tmp_salon_escolares (depto, renglon, salon, capacidad, desde, hasta, dias) VALUES
    -- Actuaría y Seguros (1 página)
    ('ACT',  1,  1, 53, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('ACT',  2,  2, 53, '16:00', '22:00', 'martes,jueves'),
    ('ACT',  3,  3, 30, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    -- Estadística (1 página)
    ('EST',  1,  1, 30, '07:00', '14:30', 'martes,jueves'),
    ('EST',  2,  2, 40, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('EST',  3,  2, 40, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('EST',  4,  3, 37, '07:00', '14:00', 'lunes,miercoles,viernes'),
    ('EST',  5,  3, 37, '16:00', '22:00', 'lunes,miercoles,viernes'),
    ('EST',  6,  4, 41, '16:00', '22:00', 'martes,jueves'),
    ('EST',  7,  5, 53, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('EST',  8,  5, 53, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('EST',  9,  6, 30, '16:00', '22:00', 'martes,jueves'),
    ('EST', 10,  6, 30, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    -- Matemáticas (página 1)
    ('MAT',  1,  1, 33, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT',  2,  1, 33, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT',  3,  2, 30, '07:00', '14:00', 'lunes,miercoles,viernes'),
    ('MAT',  4,  2, 30, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT',  5,  3, 30, '07:00', '14:00', 'lunes,miercoles,viernes'),
    ('MAT',  6,  3, 30, '16:00', '22:00', 'lunes,miercoles,viernes'),
    ('MAT',  7,  4, 37, '07:00', '14:30', 'martes,jueves'),
    ('MAT',  8,  5, 36, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT',  9,  6, 50, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 10,  6, 50, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 11,  7, 53, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 12,  7, 53, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 13,  8, 30, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 14,  8, 30, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 15,  9, 30, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 16,  9, 30, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 17, 10, 30, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 18, 10, 30, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 19, 11, 50, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 20, 12, 30, '07:00', '14:00', 'lunes,miercoles,viernes'),
    ('MAT', 21, 12, 30, '16:00', '22:00', 'lunes,miercoles,viernes'),
    ('MAT', 22, 13, 30, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 23, 13, 30, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 24, 14, 30, '07:00', '14:30', 'martes,jueves'),
    ('MAT', 25, 14, 30, '16:00', '22:00', 'martes,jueves'),
    -- Matemáticas (página 2)
    ('MAT', 26, 15, 53, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 27, 16, 30, '07:00', '14:00', 'lunes,martes,miercoles,jueves,viernes'),
    ('MAT', 28, 16, 30, '16:00', '22:00', 'lunes,martes,miercoles,jueves,viernes');

-- -----------------------------------------------------------------------------
-- Antes: el semestre debe existir (@sem no NULL), y lo que ya hay de salones.
-- -----------------------------------------------------------------------------
SELECT @sem AS semestre_id,
       (SELECT COUNT(*) FROM salon) AS salones,
       (SELECT COUNT(*) FROM salon WHERE edificio = 'Por confirmar') AS provisionales_ya_cargados,
       (SELECT COUNT(*) FROM salon WHERE edificio = 'Dummy (minimo de salones)') AS dummies;

START TRANSACTION;

-- Los renglones de un mismo salón tienen la misma capacidad (MIN por si acaso).
INSERT INTO salon (nombre, edificio, capacidad, tipo, activo)
SELECT CONCAT(t.depto, ' ', LPAD(t.salon, 2, '0')), 'Por confirmar', MIN(t.capacidad), NULL, 1
  FROM tmp_salon_escolares t
 WHERE @sem IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM salon s
                    WHERE s.nombre = CONCAT(t.depto, ' ', LPAD(t.salon, 2, '0'))
                      AND s.edificio = 'Por confirmar')
 GROUP BY t.depto, t.salon
 ORDER BY t.depto = 'MAT' DESC, t.depto = 'ACT' DESC, t.salon;

INSERT IGNORE INTO salon_disponibilidad_departamento (salon_id, departamento_id, semestre_id, dia, franja_id)
SELECT s.id, d.id, @sem, x.dia, f.id
  FROM tmp_salon_escolares t
  JOIN salon s        ON s.nombre = CONCAT(t.depto, ' ', LPAD(t.salon, 2, '0'))
                     AND s.edificio = 'Por confirmar'
  JOIN departamento d ON d.clave_prefijo = t.depto
  JOIN (SELECT 'lunes' AS dia UNION ALL SELECT 'martes' UNION ALL SELECT 'miercoles'
        UNION ALL SELECT 'jueves' UNION ALL SELECT 'viernes') x
                      ON FIND_IN_SET(x.dia, t.dias)
  JOIN franja_horaria f ON f.hora_inicio >= t.desde
                       AND f.hora_fin   <= t.hasta
                       AND (f.dias IS NULL OR FIND_IN_SET(x.dia, f.dias))
 WHERE @sem IS NOT NULL;

COMMIT;

-- -----------------------------------------------------------------------------
-- Después
-- -----------------------------------------------------------------------------

-- Por departamento. Debe dar: Actuaría 3 / 154, Estadística 6 / 486,
-- Matemáticas 16 / 1572, y ningún salón de un departamento autorizado en otro.
SELECT d.nombre AS departamento,
       COUNT(DISTINCT s.id) AS salones,
       COUNT(*) AS bloques,
       SUM(LEFT(s.nombre, 3) <> d.clave_prefijo) AS en_otro_departamento
  FROM salon s
  JOIN salon_disponibilidad_departamento sdd ON sdd.salon_id = s.id AND sdd.semestre_id = @sem
  JOIN departamento d ON d.id = sdd.departamento_id
 WHERE s.edificio = 'Por confirmar'
 GROUP BY d.id, d.nombre
 ORDER BY d.nombre;

-- Salón por salón, para cotejar contra los PDF: días y horas de mañana y de tarde.
SELECT s.nombre, s.capacidad, d.clave_prefijo AS depto,
       GROUP_CONCAT(DISTINCT IF(f.hora_inicio < '15:00', sdd.dia, NULL)
                    ORDER BY FIELD(sdd.dia, 'lunes','martes','miercoles','jueves','viernes')) AS dias_manana,
       MAX(IF(f.hora_inicio < '15:00', f.hora_fin, NULL)) AS manana_hasta,
       GROUP_CONCAT(DISTINCT IF(f.hora_inicio > '15:00', sdd.dia, NULL)
                    ORDER BY FIELD(sdd.dia, 'lunes','martes','miercoles','jueves','viernes')) AS dias_tarde,
       COUNT(*) AS bloques
  FROM salon s
  JOIN salon_disponibilidad_departamento sdd ON sdd.salon_id = s.id AND sdd.semestre_id = @sem
  JOIN departamento d   ON d.id = sdd.departamento_id
  JOIN franja_horaria f ON f.id = sdd.franja_id
 WHERE s.edificio = 'Por confirmar'
 GROUP BY s.id, s.nombre, s.capacidad, d.clave_prefijo
 ORDER BY s.nombre;

DROP TEMPORARY TABLE tmp_salon_escolares;
