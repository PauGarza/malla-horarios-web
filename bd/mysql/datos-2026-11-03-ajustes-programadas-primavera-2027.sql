-- =============================================================================
-- Datos 2026-11-03 — Ajustes de Materias programadas, Primavera 2027
--
-- Las correcciones que la jefatura de Matemáticas pidió para el Excel de
-- Primavera 2027 y que hasta ahora vivían en un CSV del script local. Solo
-- cambian los archivos de "Archivos de Matemáticas", nunca la malla.
--
--   MAT-14400-001  separar     el grupo 001 es para ACT + ECO: se abre solo al 100%
--   MAT-24407-001  vaciar      sin pareja al separar MAT-14400-001: solo clave, grupo y materia
--   MAT-14400-002  confirmado  100% a MAT-14400 y 0% a MAT-24407 es correcto
--   MAT-24431-001  porcentaje  0
--   MAT-24435-001  porcentaje  100
--   MAT-24100-001  confirmado  100% a MAT-24100 y 0% a MAT-24110 es correcto
--
-- Correr DESPUÉS de migracion-2026-11-03-ajustes-programadas.sql. Queda como
-- creado por la primera cuenta admin. Se puede repetir: ON DUPLICATE KEY
-- UPDATE deja el mismo valor y motivo.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

INSERT INTO ajuste_programadas
       (semestre_id, materia_id, numero, accion, valor, motivo, creado_por, creado_at)
SELECT s.id, m.id, a.numero, a.accion, a.valor, a.motivo,
       (SELECT id FROM profesor WHERE rol = 'admin' ORDER BY id LIMIT 1),
       UTC_TIMESTAMP()
  FROM (SELECT 'MAT-14400' AS clave, '001' AS numero, 'separar' AS accion, NULL AS valor,
               'El grupo 001 es para ACT + ECO: se abre solo al 100%' AS motivo
        UNION ALL SELECT 'MAT-24407', '001', 'vaciar', NULL,
               'Sin pareja al separar MAT-14400-001: se lista sin profesor ni horario'
        UNION ALL SELECT 'MAT-14400', '002', 'confirmado', NULL,
               '100% a MAT-14400 y 0% a MAT-24407 es correcto'
        UNION ALL SELECT 'MAT-24431', '001', 'porcentaje', 0, 'Corrección de la jefatura'
        UNION ALL SELECT 'MAT-24435', '001', 'porcentaje', 100, 'Corrección de la jefatura'
        UNION ALL SELECT 'MAT-24100', '001', 'confirmado', NULL,
               '100% a MAT-24100 y 0% a MAT-24110 es correcto') a
  JOIN materia m  ON m.clave = a.clave
  JOIN semestre s ON s.tipo = 'primavera' AND s.anio = 2027
ON DUPLICATE KEY UPDATE valor = VALUES(valor), motivo = VALUES(motivo);

-- Verificación: deben salir 6 renglones.
SELECT m.clave, a.numero, a.accion, a.valor, a.motivo
  FROM ajuste_programadas a
  JOIN materia m  ON m.id = a.materia_id
  JOIN semestre s ON s.id = a.semestre_id AND s.tipo = 'primavera' AND s.anio = 2027
 ORDER BY m.clave, a.numero;
