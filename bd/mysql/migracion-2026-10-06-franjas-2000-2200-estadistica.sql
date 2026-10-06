-- =============================================================================
-- Migración 2026-10-06 — franjas de 20:00 a 22:00 solo para Estadística
--
-- Pedido de la usuaria: la malla llega hasta las 22:00, pero solo el
-- Departamento de Estadística ve ese horario extendido. Matemáticas y
-- Actuaría siguen terminando a las 20:00.
--
-- Cómo: franja_horaria gana la columna `departamento_id` (NULL = todos los
-- departamentos, que es lo que ya eran las 23 franjas). Las cuatro franjas
-- nuevas (20:00, 20:30, 21:00, 21:30) llevan el id de Estadística.
-- catalogos.php la manda al frontend, la rejilla filtra por el departamento
-- del formulario, y api/preferencia.php descarta en silencio cualquier celda
-- de una franja que no es del departamento de quien contesta.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api` (catalogos.php
-- y preferencia.php leen la columna `departamento_id`; al revés, todo el
-- sitio da 500).
--
-- Idempotente salvo el ALTER: si da "Duplicate column name 'departamento_id'",
-- la columna ya estaba; quita ese bloque y corre el resto.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1. La columna -----------------------------------------------------------------

ALTER TABLE franja_horaria
  ADD COLUMN departamento_id INT NULL
      COMMENT 'NULL = todos los departamentos. 2026-10-06: 20:00-22:00 solo Estadistica.'
      AFTER dias,
  ADD CONSTRAINT fk_franja_departamento FOREIGN KEY (departamento_id) REFERENCES departamento(id);

-- 2. Las franjas nuevas (hora_inicio es UNIQUE: no se duplican) ---------------
--    Van al final del orden: no hay que recorrer ninguna.

SET @est = (SELECT id FROM departamento WHERE clave_prefijo = 'EST');

INSERT IGNORE INTO franja_horaria (hora_inicio, hora_fin, orden, dias, departamento_id) VALUES
    ('20:00', '20:30', 24, NULL, @est),
    ('20:30', '21:00', 25, NULL, @est),
    ('21:00', '21:30', 26, NULL, @est),
    ('21:30', '22:00', 27, NULL, @est);

-- 3. Salones: la misma disponibilidad permisiva que el resto (ver
--    seed-mysql.sql), pero solo para Estadística. Sin esto, el trigger de
--    imparte_horario rechazaría asignar una clase en esas franjas; y como los
--    otros departamentos no tienen filas, a ellos sí se las rechaza.

INSERT IGNORE INTO salon_disponibilidad_departamento (salon_id, departamento_id, semestre_id, dia, franja_id)
SELECT s.id, f.departamento_id, sem.id, dias.valor, f.id
  FROM salon s
 CROSS JOIN semestre sem
 CROSS JOIN (SELECT 'lunes' AS valor UNION ALL SELECT 'martes' UNION ALL
             SELECT 'miercoles' UNION ALL SELECT 'jueves' UNION ALL SELECT 'viernes') dias
 CROSS JOIN franja_horaria f
 WHERE f.departamento_id IS NOT NULL;

-- Verificación: 27 franjas en orden 1..27; las cuatro últimas (20:00-22:00)
-- con el departamento_id de Estadística y las demás con NULL.
SELECT f.id, f.hora_inicio, f.hora_fin, f.orden, f.dias, d.nombre AS solo_departamento
  FROM franja_horaria f
  LEFT JOIN departamento d ON d.id = f.departamento_id
 ORDER BY f.orden;
