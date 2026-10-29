-- =============================================================================
-- Limpieza 2026-10-29 — quitar los 12 salones dummy (ids 9001–9012)
--
-- Los creó optV1 (salones_dummy.py) el 23 y el 27 de octubre para ver cuántos
-- salones hacían falta mientras no había salones reales: edificio 'Dummy
-- (minimo de salones)', capacidad 32, autorizados para los tres departamentos
-- en todas las franjas. Con los salones de Servicios Escolares
-- (datos-salones-primavera-2027-mysql.sql) ya estorban: mientras existan, la
-- descarga para el motor con salones los trae junto con los reales, y el motor
-- los usaría.
--
-- Qué hace: deja sin salón (salon_id NULL) las sesiones de la malla que los
-- usaban, incluidos los grupos fijos de Actuaría, y borra su disponibilidad y
-- los salones. La malla conserva profesor y horario; el salón se lo vuelven a
-- poner salones_fijos.sql (grupos fijos) y la siguiente subida del motor.
--
-- Va por edificio, no por rango de ids (la limpieza del 23 de octubre cubría
-- 9001–9011 y el 9012 se agregó después). Idempotente. Correr completo en
-- phpMyAdmin; no depende del deploy.
--
-- Orden del 2026-10-29: (1) esta limpieza, (2) datos-salones-primavera-2027-
-- mysql.sql, (3) salones_fijos.sql, (4) descargar los datos para el motor CON
-- salones.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Antes: los 12 dummies y cuántas sesiones de la malla usa cada uno.
SELECT s.id, s.nombre, s.capacidad,
       (SELECT COUNT(*) FROM imparte_horario ih WHERE ih.salon_id = s.id) AS bloques_en_malla
  FROM salon s
 WHERE s.edificio = 'Dummy (minimo de salones)'
 ORDER BY s.id;

START TRANSACTION;

UPDATE imparte_horario
   SET salon_id = NULL
 WHERE salon_id IN (SELECT id FROM (SELECT id FROM salon WHERE edificio = 'Dummy (minimo de salones)') d);

DELETE FROM salon_disponibilidad_departamento
 WHERE salon_id IN (SELECT id FROM (SELECT id FROM salon WHERE edificio = 'Dummy (minimo de salones)') d);

DELETE FROM salon WHERE edificio = 'Dummy (minimo de salones)';

COMMIT;

-- Para que los salones reales no empiecen en el 9013 (InnoDB lo deja en max(id) + 1).
ALTER TABLE salon AUTO_INCREMENT = 1;

-- Después: 0 dummies y 0 bloques de la malla con un salón que ya no existe.
SELECT (SELECT COUNT(*) FROM salon WHERE edificio = 'Dummy (minimo de salones)') AS dummies_que_quedan,
       (SELECT COUNT(*) FROM imparte_horario ih
         WHERE ih.salon_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM salon s WHERE s.id = ih.salon_id)) AS bloques_huerfanos;
