-- =============================================================================
-- Limpieza 2026-10-02 — borrar las cuentas de profesores de Matemáticas
--
-- Decisión de la usuaria: en vez de usar el roster precargado (cargar-profesores.php,
-- contraseña inicial = CU, sin correo), cada profesor crea su propia cuenta en
-- "Crear cuenta", que desde hoy exige correo para poder recuperar la contraseña.
--
-- Qué se borra: toda cuenta con rol = 'profesor' del departamento MAT, junto
-- con lo que cuelga de ella (formularios, bloqueos, asignaciones, enlaces de
-- recuperación). Qué NO se borra, por las guardias del WHERE: las jefaturas
-- (Rumbos es jefe_division y Soto jefe_departamento, los dos de MAT), admin,
-- y todo lo de Actuaría y Estadística.
--
-- Se corre en phpMyAdmin EN DOS PASOS: primero mirar, luego borrar.
-- Sin CU en el archivo a propósito (repo público): se filtra por rol y depto.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PASO 1. Mirar. ---------------------------------------------------------------
--
-- (a) Cuántas cuentas se van a borrar.
SELECT COUNT(*) AS cuentas_a_borrar
  FROM profesor p
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
 WHERE p.rol = 'profesor';

-- (b) Las que parecen creadas o usadas por la persona misma: tienen correo o
--     ya cambiaron la contraseña. El roster precargado no tiene ninguna de las
--     dos. Si aquí sale alguien real, esa persona tendrá que volver a darse de
--     alta; decidir antes de seguir.
SELECT p.id, p.nombre, p.correo, p.password_predeterminada
  FROM profesor p
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
 WHERE p.rol = 'profesor'
   AND (p.correo IS NOT NULL OR p.password_predeterminada = 0);

-- (c) Formularios que se perderían (de cualquier semestre).
SELECT p.nombre, s.tipo, s.anio, pref.estado
  FROM preferencia pref
  JOIN profesor p     ON p.id = pref.profesor_id
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
  JOIN semestre s     ON s.id = pref.semestre_id
 WHERE p.rol = 'profesor';

-- (d) Quién se queda en MAT: deben salir Rumbos y Soto.
SELECT p.nombre, p.rol
  FROM profesor p
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
 WHERE p.rol <> 'profesor';


-- PASO 2. Borrar. Correr TODO el bloque de una vez. ------------------------------
--
-- DELETE con JOIN y no con "WHERE profesor_id IN (SELECT ... FROM profesor)":
-- MariaDB no deja borrar de profesor con una subconsulta sobre profesor.
-- Los hijos van antes que profesor porque sus FK no tienen ON DELETE CASCADE
-- (salvo recuperacion_password y los hijos de preferencia, que sí lo tienen).

START TRANSACTION;

-- preferencia_materia, disponibilidad y preferencia_respuesta caen solas (CASCADE).
DELETE pref FROM preferencia pref
  JOIN profesor p     ON p.id = pref.profesor_id
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
 WHERE p.rol = 'profesor';

DELETE b FROM bloqueo_profesor_materia b
  JOIN profesor p     ON p.id = b.profesor_id
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
 WHERE p.rol = 'profesor';

DELETE ip FROM imparte_profesor ip
  JOIN profesor p     ON p.id = ip.profesor_id
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
 WHERE p.rol = 'profesor';

DELETE p FROM profesor p
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT'
 WHERE p.rol = 'profesor';

COMMIT;

-- Verificación: 0 profesores en MAT; siguen Rumbos y Soto.
SELECT p.nombre, p.rol
  FROM profesor p
  JOIN departamento d ON d.id = p.departamento_id AND d.clave_prefijo = 'MAT';
