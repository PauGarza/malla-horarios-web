-- =============================================================================
-- Ajuste 2026-10-13 — un profesor pasa de Actuaría a Estadística
--
-- Al registrarse eligió Actuaría por error; es de Estadística. Todavía no contestaba
-- el formulario, así que solo se cambia profesor.departamento_id: no hay
-- preferencia_materia con materias de Actuaría que limpiar. Lo demás (rol,
-- contrato, contraseña) se queda igual.
--
-- La pertenencia a un departamento es solo esa columna: en cuanto cambia, el
-- profesor ve el formulario de Estadística al entrar y aparece en las
-- respuestas y el reporte de Estadística en vez de los de Actuaría.
--
-- Si @prof sale NULL, el nombre no coincidió (revisar acentos); si da
-- "Subquery returns more than 1 row", hay más de uno con ese nombre y hay que
-- afinar el LIKE. En ambos casos el UPDATE no toca nada.
-- Idempotente: correrlo otra vez no cambia nada.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @act  = (SELECT id FROM departamento WHERE clave_prefijo = 'ACT');
SET @est  = (SELECT id FROM departamento WHERE clave_prefijo = 'EST');
SET @prof = (SELECT id FROM profesor WHERE nombre LIKE '%Rojas Nandayapa%');

-- Antes: debe salir una fila, en Actuaría, sin preferencia en el semestre activo.
SELECT pr.id, pr.nombre, pr.rol, pr.tipo_contrato, d.nombre AS departamento,
       (SELECT COUNT(*) FROM preferencia p JOIN semestre s ON s.id = p.semestre_id
         WHERE p.profesor_id = pr.id AND s.estado = 'activo') AS preferencias_activas
  FROM profesor pr
  JOIN departamento d ON d.id = pr.departamento_id
 WHERE pr.id = @prof;

UPDATE profesor
   SET departamento_id = @est
 WHERE id = @prof
   AND departamento_id = @act;

-- Después: departamento = Estadística.
SELECT pr.id, pr.nombre, d.nombre AS departamento
  FROM profesor pr
  JOIN departamento d ON d.id = pr.departamento_id
 WHERE pr.id = @prof;
