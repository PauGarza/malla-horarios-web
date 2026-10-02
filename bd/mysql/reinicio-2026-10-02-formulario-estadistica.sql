-- =============================================================================
-- Reinicio 2026-10-02 — formulario de Estadística del semestre activo
--
-- Por qué: cuando la jefatura de Estadística abrió el editor por primera vez,
-- asegurar_formulario() lo sembró con la plantilla de MATEMÁTICAS ("Cursos de
-- cálculo — cobertura departamental" + "Catálogo de materias" con mínimo 5).
-- Y como sus materias no tenían fila en materia_cuestionario, la regla
-- fail-open las metió TODAS en la primera sección de materias: la de cálculo,
-- que solo ven tiempo completo y medio tiempo.
--
-- Desde 2026-10-02 la plantilla depende del departamento
-- (secciones_por_defecto() en api/lib/catalogo.php): fuera de Matemáticas es
-- una sola sección "Materias del departamento", sin mínimo. Este archivo borra
-- lo sembrado para que, al volver a abrir el editor, se siembre la plantilla
-- nueva.
--
-- CORRER DESPUÉS de desplegar el API nuevo (`npm run deploy:api`). Si se corre
-- antes y alguien abre el editor de Estadística, se vuelve a sembrar la
-- plantilla vieja.
--
-- Protección: si algún profesor de Estadística ya tiene preferencia (borrador o
-- enviada) en el semestre activo, NO borra nada. Tampoco toca la publicación
-- ni el texto de introducción (departamento_semestre_config) ni el catálogo.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @depto_est = (SELECT id FROM departamento WHERE clave_prefijo = 'EST');
SET @sem_activo = (SELECT id FROM semestre WHERE estado = 'activo');
SET @con_respuestas = (
    SELECT COUNT(*) FROM preferencia pref
      JOIN profesor p ON p.id = pref.profesor_id
     WHERE p.departamento_id = @depto_est AND pref.semestre_id = @sem_activo
);

-- Debe decir 0. Si no, para aquí: alguien ya contestó y se arregla a mano en
-- el editor (Eliminar la sección de cálculo y reacomodar).
SELECT @con_respuestas AS preferencias_de_estadistica;

START TRANSACTION;

-- En qué sección iba cada materia de Estadística este semestre.
DELETE mc FROM materia_cuestionario mc
  JOIN materia m ON m.id = mc.materia_id
 WHERE m.departamento_id = @depto_est
   AND mc.semestre_id = @sem_activo
   AND @con_respuestas = 0;

-- Las secciones (activas y borradas en suave). Sin filas, el editor siembra
-- la plantilla la próxima vez que se abra.
DELETE FROM cuestionario_seccion
 WHERE departamento_id = @depto_est
   AND semestre_id = @sem_activo
   AND @con_respuestas = 0;

COMMIT;

-- Verificación: las dos deben dar 0.
SELECT COUNT(*) AS secciones_est FROM cuestionario_seccion
 WHERE departamento_id = @depto_est AND semestre_id = @sem_activo;
SELECT COUNT(*) AS asignaciones_est FROM materia_cuestionario mc
  JOIN materia m ON m.id = mc.materia_id
 WHERE m.departamento_id = @depto_est AND mc.semestre_id = @sem_activo;
