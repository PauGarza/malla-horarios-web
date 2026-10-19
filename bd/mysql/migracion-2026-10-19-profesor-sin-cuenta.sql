-- =============================================================================
-- Migración 2026-10-19 — profesores sin cuenta (D45)
--
-- Actuaría no usa el sistema: sus profesores no contestan el formulario y su
-- jefatura arma la programación con su propio proceso. Pero su resultado sí
-- tiene que quedar registrado aquí, como grupos publicados, para que la malla
-- los muestre y el motor los respete (grupos_fijos; y, cuando el profesor es
-- de otro departamento, horas ocupadas). imparte_profesor pide un profesor_id,
-- así que esos profesores necesitan una fila en profesor aunque nunca entren.
--
-- Un "profesor sin cuenta" es una fila con:
--   cu = NULL, password_hash = NULL  -> no puede entrar (login busca por cu)
--   activo = 0, tipo_contrato = NULL -> fuera de paneles, reportes, respuestas,
--                                       asignaciones directas y del paquete del
--                                       motor: todos filtran activo = 1 AND
--                                       tipo_contrato IS NOT NULL.
-- Solo existe para que un grupo publicado diga quién lo da.
--
-- cu sigue siendo UNIQUE: MariaDB admite varios NULL en un índice único, así
-- que los CU reales siguen protegidos. Si uno de estos profesores se registra
-- después con su CU, queda una fila nueva; habría que pasar sus grupos a esa
-- fila y borrar la sin cuenta (ver diseno-bd.md §18).
--
-- chk_profesor_depto (contrato obligatorio para rol profesor) es uno de los
-- CHECK que MariaDB 5.5 ignora y que no tiene trigger, así que no hay nada
-- que relajar en la base; schema-mysql.sql lo documenta con la excepción.
--
-- Correr ANTES de datos-actuaria-primavera-2027-mysql.sql. No toca el API: se
-- puede correr en cualquier momento. Una sola vez (repetirla no cambia nada).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE profesor
    MODIFY cu VARCHAR(10) NULL
        COMMENT 'Clave Unica: identificador de login para cualquier rol. Tambien es la password inicial. NULL = profesor sin cuenta (D45).',
    MODIFY password_hash VARCHAR(255) NULL
        COMMENT 'bcrypt, manejado por la app. NUNCA se selecciona fuera de login.php / cambiar-password.php. NULL = profesor sin cuenta (D45).';

-- Verificación: cu y password_hash con "YES" en Null; cu sigue con UNI en Key.
SHOW COLUMNS FROM profesor WHERE Field IN ('cu', 'password_hash');
