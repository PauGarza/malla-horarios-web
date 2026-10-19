-- =============================================================================
-- Limpieza 2026-10-13 — quitar los 7 salones de ejemplo del seed
--
-- seed-mysql.sql sembró 7 salones (RH107, RH109, RH301, PF105, RHB-1, RHB-2,
-- RHCC302) solo para poder probar el esquema, con una disponibilidad inventada:
-- los 3 departamentos en todas las franjas. No son una asignación de Servicios
-- Escolares. Con la descarga para el motor (api/motor-entrada.php) ya estorban:
-- si alguien marca "Incluir salones", el motor repartiría la malla entre esos 7
-- como si fueran reales. Decisión de la usuaria: quitarlos. Hasta que se carguen
-- los salones reales del semestre se trabaja en modo sin salones (D44).
--
-- Se borran su disponibilidad (salon_disponibilidad_departamento, todos los
-- semestres) y las filas de salon. Un salón que ya use algún imparte_horario NO
-- se toca: la llave foránea lo impediría y, además, sería señal de que alguien
-- ya aplicó un resultado con salones; ese caso se revisa a mano.
--
-- Va por nombre (los ids dependen del orden de carga). Idempotente: correrlo
-- otra vez no borra nada más. Correr completo en phpMyAdmin; no depende del
-- deploy.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Antes: deben salir los 7, con usos_en_horario = 0 y sus franjas autorizadas.
SELECT s.id, s.nombre, s.capacidad, s.tipo, s.activo,
       (SELECT COUNT(*) FROM salon_disponibilidad_departamento sdd WHERE sdd.salon_id = s.id) AS franjas_autorizadas,
       (SELECT COUNT(*) FROM imparte_horario ih WHERE ih.salon_id = s.id) AS usos_en_horario
  FROM salon s
 WHERE s.nombre IN ('RH107', 'RH109', 'RH301', 'PF105', 'RHB-1', 'RHB-2', 'RHCC302')
 ORDER BY s.nombre;

DELETE sdd
  FROM salon_disponibilidad_departamento sdd
  JOIN salon s ON s.id = sdd.salon_id
 WHERE s.nombre IN ('RH107', 'RH109', 'RH301', 'PF105', 'RHB-1', 'RHB-2', 'RHCC302')
   AND NOT EXISTS (SELECT 1 FROM imparte_horario ih WHERE ih.salon_id = s.id);

DELETE FROM salon
 WHERE nombre IN ('RH107', 'RH109', 'RH301', 'PF105', 'RHB-1', 'RHB-2', 'RHCC302')
   AND NOT EXISTS (SELECT 1 FROM imparte_horario ih WHERE ih.salon_id = salon.id);

-- Después: 0 filas aquí (o solo los que tenían usos_en_horario > 0) ...
SELECT s.id, s.nombre FROM salon s
 WHERE s.nombre IN ('RH107', 'RH109', 'RH301', 'PF105', 'RHB-1', 'RHB-2', 'RHCC302');

-- ... y lo que quede en el catálogo de salones (si solo existían los del seed: 0 y 0).
SELECT (SELECT COUNT(*) FROM salon) AS salones,
       (SELECT COUNT(*) FROM salon_disponibilidad_departamento) AS filas_disponibilidad;
