-- =============================================================================
-- Limpieza 2026-10-02 — el formulario de prueba que aparece arriba de Beatriz
--
-- En "Preferencias recibidas" (api/panel.php) la lista va ordenada por nombre,
-- así que lo que sale "arriba de Beatriz" (RUMBOS PELLICER IRMA BEATRIZ) es el
-- profesor de Matemáticas con el nombre inmediatamente anterior. Fue una
-- prueba (probablemente del alta de cuenta de registro.php) y se borra.
--
-- Se corre en phpMyAdmin EN DOS PASOS, a propósito: el borrado va por CU
-- explícito, nunca por "lo que esté arriba", para no borrar a nadie real.
--
-- RESULTADO (2026-10-02): el PASO 1 mostró que arriba de Beatriz solo había
-- profesores reales sin formulario; la prueba era el formulario de la PROPIA
-- Beatriz. Se borró con esto (1 fila; la cuenta quedó intacta), y el PASO 2
-- no se usó:
--
--   DELETE FROM preferencia
--    WHERE profesor_id = (SELECT id FROM profesor WHERE nombre = 'RUMBOS PELLICER IRMA BEATRIZ')
--      AND semestre_id = (SELECT id FROM semestre WHERE estado = 'activo');
--
-- (En la base se corrió con el CU. Aquí va por nombre porque el repo es
-- público y la contraseña inicial de cada cuenta es su CU.)
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PASO 1. Mirar quién está justo arriba de Beatriz en el panel de Matemáticas.
--         Anota el CU de la fila de prueba.

SELECT p.id, p.cu, p.nombre, p.rol, p.tipo_contrato, p.password_predeterminada,
       pref.estado AS formulario, pref.enviado_at
  FROM profesor p
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
  LEFT JOIN preferencia pref
         ON pref.profesor_id = p.id
        AND pref.semestre_id = (SELECT id FROM semestre WHERE estado = 'activo')
 WHERE p.tipo_contrato IS NOT NULL AND p.activo = 1
   AND p.nombre <= 'RUMBOS PELLICER IRMA BEATRIZ'
 ORDER BY p.nombre DESC
 LIMIT 4;

-- PASO 2. Pon el CU de la prueba en la línea de abajo (entre las comillas) y
--         corre TODO el bloque. Las guardias hacen que no pase nada si el CU
--         es de una jefatura o de un admin.
--
--         El CU va escrito directo y no en una variable @cu a propósito: un
--         texto entre comillas se adapta al collation de la columna, una
--         variable no, y phpMyAdmin puede dejar la conexión en otro collation
--         (error 1267, ver README.md "El collation, que costó un error 1267").

SET @id_prueba = (SELECT id FROM profesor
                   WHERE cu = 'PON_AQUI_EL_CU'
                     AND rol = 'profesor');

-- Debe salir UNA fila: la de la prueba. Si sale vacía, el CU no existe o es
-- de una jefatura, y lo de abajo no borra nada.
SELECT id, cu, nombre, rol FROM profesor WHERE id = @id_prueba;

START TRANSACTION;

-- Su formulario: preferencia_materia, disponibilidad y preferencia_respuesta
-- se van solas (ON DELETE CASCADE).
DELETE FROM preferencia WHERE profesor_id = @id_prueba;
DELETE FROM bloqueo_profesor_materia WHERE profesor_id = @id_prueba;
DELETE FROM imparte_profesor WHERE profesor_id = @id_prueba;
-- intento_login no se toca: no tiene llave foránea y se limpia sola.
-- La cuenta. Si la prueba era SOLO el formulario y la cuenta es de una persona
-- real, comenta esta línea: lo de arriba ya borró el formulario.
DELETE FROM profesor WHERE id = @id_prueba;

COMMIT;

-- Verificación: debe dar 0.
SELECT COUNT(*) AS sigue_ahi FROM profesor WHERE id = @id_prueba;
