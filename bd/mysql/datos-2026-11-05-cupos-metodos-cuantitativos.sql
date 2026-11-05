-- =============================================================================
-- Cupo de Metodos Cuantitativos para Derecho en sus salones nuevos
-- (Primavera 2027)
--
-- Mover una clase en la malla cambia su horario y su salon, pero no su cupo. A
-- peticion de la jefatura de Matematicas (2026-11-05) los dos grupos pasan a las
-- 08:30-10:00, en salones mas chicos:
--
--   MAT-10101 001   lunes y miercoles, MAT 08 (30 lugares)   cupo 34 -> 30
--   MAT-10101 002   martes y jueves,   MAT 01 (33 lugares)   cupo 34 -> 33
--
-- Correrlo DESPUES de mover las clases en la malla. Cada grupo solo se actualiza
-- si ya esta en su salon nuevo a las 08:30 esos dias; si no, no cambia nada.
--
-- No toca horarios, salones ni profesores. Se puede repetir.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sem = (SELECT id FROM semestre WHERE tipo = 'primavera' AND anio = 2027);

-- -----------------------------------------------------------------------------
-- Antes
--
-- Dos filas, con cupo 34. Cada una debe traer su salon nuevo, sus dos dias, 6
-- bloques y el horario 08:30-10:00. Si no, falta mover la clase en la malla.
-- -----------------------------------------------------------------------------
SELECT m.clave, g.numero, g.cupo_maximo, g.publicado, s.nombre AS salon, s.capacidad,
       GROUP_CONCAT(DISTINCT ih.dia ORDER BY ih.dia) AS dias,
       COUNT(*) AS bloques,
       MIN(f.hora_inicio) AS desde,
       MAX(f.hora_fin) AS hasta
  FROM grupo g
  JOIN materia m ON m.id = g.materia_id
  JOIN imparte i ON i.grupo_id = g.id
  JOIN imparte_horario ih ON ih.imparte_id = i.id
  JOIN franja_horaria f ON f.id = ih.franja_id
  LEFT JOIN salon s ON s.id = ih.salon_id
 WHERE g.semestre_id = @sem
   AND m.clave = 'MAT-10101'
   AND g.numero IN ('001', '002')
 GROUP BY m.clave, g.numero, g.cupo_maximo, g.publicado, s.nombre, s.capacidad
 ORDER BY g.numero;

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- Grupo 001: lunes y miercoles a las 08:30 en MAT 08
-- -----------------------------------------------------------------------------
UPDATE grupo g
  JOIN materia m ON m.id = g.materia_id
   SET g.cupo_maximo = 30
 WHERE g.semestre_id = @sem
   AND m.clave = 'MAT-10101'
   AND g.numero = '001'
   AND EXISTS (
       SELECT 1
         FROM imparte i
         JOIN imparte_horario ih ON ih.imparte_id = i.id
         JOIN franja_horaria f ON f.id = ih.franja_id
         JOIN salon s ON s.id = ih.salon_id
        WHERE i.grupo_id = g.id
          AND s.nombre = 'MAT 08'
          AND ih.dia = 'lunes'
          AND f.hora_inicio = '08:30:00'
   )
   AND EXISTS (
       SELECT 1
         FROM imparte i
         JOIN imparte_horario ih ON ih.imparte_id = i.id
         JOIN franja_horaria f ON f.id = ih.franja_id
         JOIN salon s ON s.id = ih.salon_id
        WHERE i.grupo_id = g.id
          AND s.nombre = 'MAT 08'
          AND ih.dia = 'miercoles'
          AND f.hora_inicio = '08:30:00'
   );

-- -----------------------------------------------------------------------------
-- Grupo 002: martes y jueves a las 08:30 en MAT 01
-- -----------------------------------------------------------------------------
UPDATE grupo g
  JOIN materia m ON m.id = g.materia_id
   SET g.cupo_maximo = 33
 WHERE g.semestre_id = @sem
   AND m.clave = 'MAT-10101'
   AND g.numero = '002'
   AND EXISTS (
       SELECT 1
         FROM imparte i
         JOIN imparte_horario ih ON ih.imparte_id = i.id
         JOIN franja_horaria f ON f.id = ih.franja_id
         JOIN salon s ON s.id = ih.salon_id
        WHERE i.grupo_id = g.id
          AND s.nombre = 'MAT 01'
          AND ih.dia = 'martes'
          AND f.hora_inicio = '08:30:00'
   )
   AND EXISTS (
       SELECT 1
         FROM imparte i
         JOIN imparte_horario ih ON ih.imparte_id = i.id
         JOIN franja_horaria f ON f.id = ih.franja_id
         JOIN salon s ON s.id = ih.salon_id
        WHERE i.grupo_id = g.id
          AND s.nombre = 'MAT 01'
          AND ih.dia = 'jueves'
          AND f.hora_inicio = '08:30:00'
   );

COMMIT;

-- -----------------------------------------------------------------------------
-- Despues
--
-- Dos filas: 001 con cupo 30 en MAT 08 y 002 con cupo 33 en MAT 01.
-- -----------------------------------------------------------------------------
SELECT m.clave, g.numero, g.cupo_maximo, s.nombre AS salon, s.capacidad,
       GROUP_CONCAT(DISTINCT ih.dia ORDER BY ih.dia) AS dias,
       MIN(f.hora_inicio) AS desde,
       MAX(f.hora_fin) AS hasta
  FROM grupo g
  JOIN materia m ON m.id = g.materia_id
  JOIN imparte i ON i.grupo_id = g.id
  JOIN imparte_horario ih ON ih.imparte_id = i.id
  JOIN franja_horaria f ON f.id = ih.franja_id
  LEFT JOIN salon s ON s.id = ih.salon_id
 WHERE g.semestre_id = @sem
   AND m.clave = 'MAT-10101'
   AND g.numero IN ('001', '002')
 GROUP BY m.clave, g.numero, g.cupo_maximo, s.nombre, s.capacidad
 ORDER BY g.numero;
