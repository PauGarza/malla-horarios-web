-- =============================================================================
-- MAT 05 tambien para Estadistica, lunes y miercoles de 19:00 a 21:00
-- (Primavera 2027)
--
-- EST-11102 004 (Inferencia Estadistica, cupo 33) pasa a lunes y miercoles de
-- 19:00 a 21:00. A esa hora no queda salon libre de Estadistica, y MAT 05
-- (36 lugares) esta libre. Decision de la usuaria (2026-11-05).
--
-- Que hace: agrega 8 filas a salon_disponibilidad_departamento (4 franjas por
-- 2 dias) para Estadistica. Solo esas horas, para que el motor no use este salon
-- en otras corridas de Estadistica. Lo que ya tiene Matematicas no cambia.
--
-- Correrlo ANTES de descargar los datos de Estadistica. Sin estas filas, el
-- sistema rechazaria el salon por no estar autorizado para el departamento.
--
-- Se puede repetir (INSERT IGNORE).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sem   = (SELECT id FROM semestre WHERE tipo = 'primavera' AND anio = 2027);
SET @est   = (SELECT id FROM departamento WHERE clave_prefijo = 'EST');
SET @salon = (SELECT id FROM salon WHERE nombre = 'MAT 05' AND activo = 1);

-- -----------------------------------------------------------------------------
-- Antes
-- -----------------------------------------------------------------------------

-- Una fila, con los tres ids llenos y capacidad 36. Si alguno sale NULL, el
-- INSERT de abajo no escribe nada.
SELECT @sem AS primavera_2027, @est AS estadistica, @salon AS mat_05,
       (SELECT capacidad FROM salon WHERE id = @salon) AS capacidad;

-- Vacia: nadie ocupa el salon en esas horas.
SELECT m.clave, g.numero, ih.dia, f.hora_inicio
  FROM imparte_horario ih
  JOIN franja_horaria f ON f.id = ih.franja_id
  JOIN imparte i ON i.id = ih.imparte_id
  JOIN grupo g   ON g.id = i.grupo_id AND g.semestre_id = @sem AND g.estado <> 'cancelado'
  JOIN materia m ON m.id = g.materia_id
 WHERE ih.salon_id = @salon
   AND ih.dia IN ('lunes', 'miercoles')
   AND f.hora_inicio >= '19:00:00'
   AND f.hora_fin <= '21:00:00'
 ORDER BY ih.dia, f.hora_inicio;

-- -----------------------------------------------------------------------------
-- El salon, para Estadistica
-- -----------------------------------------------------------------------------

INSERT IGNORE INTO salon_disponibilidad_departamento (salon_id, departamento_id, semestre_id, dia, franja_id)
SELECT @salon, @est, @sem, x.dia, f.id
  FROM (SELECT 'lunes' AS dia UNION ALL SELECT 'miercoles') x
  JOIN franja_horaria f ON f.hora_inicio >= '19:00:00'
                       AND f.hora_fin <= '21:00:00'
                       AND (f.dias IS NULL OR FIND_IN_SET(x.dia, f.dias))
 WHERE @sem IS NOT NULL AND @est IS NOT NULL AND @salon IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Despues
-- -----------------------------------------------------------------------------

-- Ocho filas: lunes y miercoles, de las 19:00 a las 20:30 de inicio.
SELECT sdd.dia, f.hora_inicio, f.hora_fin
  FROM salon_disponibilidad_departamento sdd
  JOIN franja_horaria f ON f.id = sdd.franja_id
 WHERE sdd.salon_id = @salon AND sdd.departamento_id = @est AND sdd.semestre_id = @sem
 ORDER BY sdd.dia, f.hora_inicio;
