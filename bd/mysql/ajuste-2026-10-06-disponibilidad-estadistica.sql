-- =============================================================================
-- Ajuste 2026-10-06 — disponibilidad de una profesora de Estadística
--
-- Contestó el formulario antes de que existieran las franjas de 20:00 a 22:00
-- (migracion-2026-10-06-franjas-2000-2200-estadistica.sql). En vez de pedirle
-- que lo rehaga, se le colorea a mano lo que pidió por escrito:
--
--   verde:    lunes y miércoles de 20:00 a 22:00 (Estadística I y II)
--   amarillo: lunes a jueves de 18:00 a 20:00 (Estadística I y II)
--   rojo:     martes y jueves de 20:00 a 22:00 (da clases en Actuaría)
--
-- Lo de Actuaría también cae lunes y miércoles de 20:00 a 22:00, pero ahí
-- gana lo que pidió para Estadística (verde), por decisión de la usuaria. El
-- rojo queda solo donde Actuaría no se empalma con nada de Estadística. Donde
-- un rango verde y uno amarillo se cruzan, gana el verde.
--
-- Solo toca esas 32 celdas (4 días x 8 franjas) de la preferencia del semestre
-- ACTIVO; el resto de su malla, sus materias y el estado (borrador/enviado)
-- se quedan como están. Es idempotente: se puede correr más de una vez.
--
-- Correr DESPUÉS de la migración de las franjas de 20:00 a 22:00.
--
-- El CU no se versiona: el repo es público y la contraseña inicial es el CU.
-- Antes de correrlo, poner el CU real en @cu. Ya se corrió en producción
-- (confirmado 2026-10-13); se conserva como registro de lo que se hizo.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @cu = '<CU>';

SET @pref = (
    SELECT p.id
      FROM preferencia p
      JOIN profesor pr ON pr.id = p.profesor_id
      JOIN semestre s  ON s.id  = p.semestre_id
     WHERE pr.cu = @cu
       AND s.estado = 'activo'
);

-- 0. Revisar antes: debe salir UNA fila, del departamento de Estadística (si
--    no, la rejilla no le muestra las franjas de 20:00 a 22:00). Si @pref es
--    NULL es que no ha abierto el formulario: el INSERT de abajo falla y no
--    escribe nada.
SELECT @pref AS preferencia_id, pr.cu, pr.nombre, d.nombre AS departamento, p.estado
  FROM preferencia p
  JOIN profesor pr      ON pr.id = p.profesor_id
  LEFT JOIN departamento d ON d.id = pr.departamento_id
 WHERE p.id = @pref;

-- 1. Las celdas -----------------------------------------------------------------

INSERT INTO disponibilidad (preferencia_id, dia, franja_id, nivel)
SELECT @pref, dias.valor, f.id,
       CASE WHEN f.hora_inicio < '20:00:00'                 THEN 'amarillo'
            WHEN dias.valor IN ('lunes', 'miercoles')       THEN 'verde'
            ELSE 'rojo' END
  FROM franja_horaria f
 CROSS JOIN (SELECT 'lunes' AS valor UNION ALL SELECT 'martes' UNION ALL
             SELECT 'miercoles' UNION ALL SELECT 'jueves') dias
 WHERE f.hora_inicio >= '18:00:00' AND f.hora_inicio < '22:00:00'
ON DUPLICATE KEY UPDATE nivel = VALUES(nivel);

-- Verificación: 32 filas. Lunes a jueves de 18:00 a 19:30 en amarillo; de
-- 20:00 a 21:30, verde lunes y miércoles y rojo martes y jueves.
SELECT d.dia, f.hora_inicio, d.nivel
  FROM disponibilidad d
  JOIN franja_horaria f ON f.id = d.franja_id
 WHERE d.preferencia_id = @pref
   AND f.hora_inicio >= '18:00:00'
 ORDER BY FIELD(d.dia, 'lunes', 'martes', 'miercoles', 'jueves', 'viernes'), f.orden;
