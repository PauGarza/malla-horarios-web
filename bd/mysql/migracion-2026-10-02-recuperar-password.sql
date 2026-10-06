-- =============================================================================
-- Migración 2026-10-02 — recuperar la contraseña por correo
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Los endpoints
-- nuevos (olvide-password.php, restablecer-password.php) escriben en la tabla
-- recuperacion_password; sin ella responden 500.
--
-- Qué cambia:
--   1. profesor.correo pasa a UNIQUE. La recuperación se pide con el correo y
--      nada más, así que un correo tiene que señalar a UNA cuenta. La columna
--      sigue admitiendo NULL (UNIQUE permite varios NULL): el roster cargado
--      con cargar-profesores.php no trae correos, y a esas personas la app les
--      pide el suyo al entrar. Lo obligatorio se exige en el API, no aquí.
--   2. Tabla recuperacion_password: un token de un solo uso por solicitud.
--
-- Los correos de las jefaturas NO van aquí: el script que los asigna busca por
-- CU, y este repo es público (ver la nota de migracion-2026-10-02-correo-y-roles.sql).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 0. Antes del UNIQUE: ¿hay correos repetidos? Debe dar CERO filas. Si da
--    alguna, corregir a mano esas cuentas antes de seguir, o el ALTER falla.
SELECT correo, COUNT(*) AS cuentas
  FROM profesor
 WHERE correo IS NOT NULL
 GROUP BY correo
HAVING COUNT(*) > 1;

-- 1. Correo único ------------------------------------------------------------------
--
-- VARCHAR(191) y no 255: con utf8mb4, InnoDB de MariaDB 5.5 topa un índice en
-- 767 bytes = 191 caracteres (mismo motivo que departamento.nombre). Un correo
-- real no se acerca a eso; normalizar_correo() en api/lib/auth.php ya corta en 191.

ALTER TABLE profesor
  MODIFY COLUMN correo VARCHAR(191) NULL
      COMMENT 'Obligatorio en el API desde 2026-10-02 (registro y Mi perfil); NULL solo en el roster que aun no lo captura. Unico: con el se recupera la contrasena. En minusculas.',
  ADD UNIQUE KEY uq_profesor_correo (correo);

-- 2. Tokens de recuperación -----------------------------------------------------------
--
-- Se guarda el SHA-256 del token, nunca el token: quien lea esta tabla (un
-- respaldo, phpMyAdmin) no puede usarla para entrar a ninguna cuenta.
-- DATETIME y no TIMESTAMP: MariaDB 5.5 solo admite un TIMESTAMP con default por
-- tabla, y el resto del esquema guarda UTC en DATETIME desde PHP.

CREATE TABLE IF NOT EXISTS recuperacion_password (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    profesor_id INT NOT NULL,
    token_hash  CHAR(64) NOT NULL COMMENT 'SHA-256 en hex del token que va en el enlace.',
    creado_at   DATETIME NOT NULL COMMENT 'UTC.',
    expira_at   DATETIME NOT NULL COMMENT 'UTC. Una hora despues de creado_at.',
    usado_at    DATETIME NULL     COMMENT 'UTC. Se llena al restablecer; un token usado no vuelve a servir.',
    UNIQUE KEY uq_recuperacion_token (token_hash),
    KEY idx_recuperacion_profesor (profesor_id),
    CONSTRAINT fk_recuperacion_profesor FOREIGN KEY (profesor_id) REFERENCES profesor(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Enlaces de "olvide mi contrasena". Se limpia sola: cada solicitud borra los vencidos.';

-- Verificación: la tabla existe y correo ya es único.
SHOW INDEX FROM profesor WHERE Key_name = 'uq_profesor_correo';
SHOW CREATE TABLE recuperacion_password;
