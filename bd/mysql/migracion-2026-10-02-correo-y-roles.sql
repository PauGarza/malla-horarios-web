-- =============================================================================
-- Migración 2026-10-02 — correo del profesor y roles de la jefatura
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. El API nuevo
-- lee profesor.correo en catalogos.php (que pide TODA pantalla al arrancar):
-- si se despliega primero, todo el sitio responde 500 hasta que se corra esto.
--
-- Idempotente salvo el ALTER: si el ALTER da "Duplicate column name 'correo'",
-- la columna ya estaba; sigue con el resto.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1. Correo del profesor (opcional) ---------------------------------------------

ALTER TABLE profesor
  ADD COLUMN correo VARCHAR(255) NULL
      COMMENT 'Opcional (2026-10-02). Lo captura la persona en Mi perfil o al darse de alta. En minusculas.'
      AFTER nombre;

-- 2. Roles -------------------------------------------------------------------------
--
-- Beatriz Rumbos: jefe_division. Ezequiel Soto: jefe_departamento. Los dos con
-- departamento = Matemáticas, que es lo que acota lo que ven:
--   * Soto, como jefe_departamento, ya solo veía Matemáticas.
--   * Rumbos veía los 3 departamentos; desde hoy el API la acota a su
--     departamento_id (DIVISION_SOLO_SU_DEPARTAMENTO en api/lib/auth.php),
--     conservando solo el manejo de semestres. Por eso aquí importa que su
--     departamento_id sea Matemáticas: con otro, vería ese otro.
--
-- Es lo que ya decían BD/datos-matematicas.sql y la migración del 2026-09-25;
-- se reafirma por si algo quedó distinto en la base en vivo.
--
-- Se buscan por NOMBRE y no por CU a propósito: este repo es público y la
-- contraseña inicial de cada cuenta es su CU, así que escribir aquí un CU real
-- es publicar sus credenciales (ver TODO.md §0, 2026-09-24).

UPDATE profesor p
  JOIN departamento d ON d.clave_prefijo = 'MAT'
   SET p.rol = 'jefe_division', p.departamento_id = d.id
 WHERE p.nombre = 'RUMBOS PELLICER IRMA BEATRIZ';

UPDATE profesor p
  JOIN departamento d ON d.clave_prefijo = 'MAT'
   SET p.rol = 'jefe_departamento', p.departamento_id = d.id
 WHERE p.nombre = 'SOTO SANCHEZ JOSÉ EZEQUIEL';

-- Verificación: dos filas, las dos con depto MAT.
SELECT p.nombre, p.rol, d.clave_prefijo AS depto, p.activo
  FROM profesor p LEFT JOIN departamento d ON d.id = p.departamento_id
 WHERE p.nombre IN ('RUMBOS PELLICER IRMA BEATRIZ', 'SOTO SANCHEZ JOSÉ EZEQUIEL');

-- Nadie más con jefatura que no se espere (debe dar solo esas dos, más admin):
SELECT p.nombre, p.rol FROM profesor p
 WHERE p.rol IN ('jefe_departamento', 'jefe_division', 'admin');
