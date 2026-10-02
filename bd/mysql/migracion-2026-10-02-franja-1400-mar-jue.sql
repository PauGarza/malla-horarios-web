-- =============================================================================
-- Migración 2026-10-02 (c) — franja 14:00-14:30 solo martes y jueves
--
-- Pedido de la usuaria: en la rejilla de disponibilidad de TODOS los
-- formularios, martes y jueves se admite hasta las 14:30; los demás días
-- sigue siendo hasta las 14:00. Es una excepción acotada a RN05 (sin clases
-- de 14:00 a 16:00, comida).
--
-- Cómo: franja_horaria gana la columna `dias` (NULL = todos los días, que es
-- lo que ya eran las 22 franjas). La franja nueva lleva dias = 'martes,jueves'.
-- La rejilla deja esa celda bloqueada lunes, miércoles y viernes, y
-- api/preferencia.php descarta cualquier celda de un día no permitido.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api` (catalogos.php
-- lee la columna `dias`; al revés, todo el sitio da 500).
--
-- Idempotente salvo el ALTER: si da "Duplicate column name 'dias'", la columna
-- ya estaba; quita ese bloque y corre el resto.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1. La columna -----------------------------------------------------------------

ALTER TABLE franja_horaria
  ADD COLUMN dias SET('lunes','martes','miercoles','jueves','viernes') NULL
      COMMENT 'NULL = todos los dias. 2026-10-02: 14:00-14:30 solo martes y jueves.'
      AFTER orden;

-- 2. Hacer lugar en el orden: las de la tarde bajan una posición ---------------
--    Solo si la franja de las 14:00 todavía no existe (para no correrlas dos
--    veces). MySQL no deja leer la misma tabla dentro del UPDATE, por eso la
--    variable.

SET @ya_existe = (SELECT COUNT(*) FROM franja_horaria WHERE hora_inicio = '14:00:00');

UPDATE franja_horaria
   SET orden = orden + 1
 WHERE hora_inicio >= '16:00:00'
   AND @ya_existe = 0;

-- 3. La franja nueva (hora_inicio es UNIQUE: no se duplica) --------------------

INSERT IGNORE INTO franja_horaria (hora_inicio, hora_fin, orden, dias)
VALUES ('14:00', '14:30', 15, 'martes,jueves');

-- 4. Salones: la misma disponibilidad permisiva que el resto (ver
--    seed-mysql.sql), solo martes y jueves. Sin esto, el trigger de
--    imparte_horario rechazaría asignar una clase en esa franja.

INSERT IGNORE INTO salon_disponibilidad_departamento (salon_id, departamento_id, semestre_id, dia, franja_id)
SELECT s.id, d.id, sem.id, dias.valor, f.id
  FROM salon s
 CROSS JOIN departamento d
 CROSS JOIN semestre sem
 CROSS JOIN (SELECT 'martes' AS valor UNION ALL SELECT 'jueves') dias
 CROSS JOIN franja_horaria f
 WHERE f.hora_inicio = '14:00:00';

-- Verificación: 23 franjas en orden 1..23, la de 14:00 en el lugar 15 con
-- dias = martes,jueves, y las demás con dias NULL.
SELECT id, hora_inicio, hora_fin, orden, dias FROM franja_horaria ORDER BY orden;
