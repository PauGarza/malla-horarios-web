-- =============================================================================
-- Migración 2026-10-27 — Avisos descartados de la malla
--
-- La jefatura revisa y edita la malla (api/malla.php). Hay avisos (ámbar) que
-- ya se vieron y no se van a resolver: un profesor en horas amarillas que sí
-- aceptó, una materia que no marcó en verde, un grupo con más alumnos esperados
-- que lugares... Descartarlos los quita de la cuenta y de la lista de avisos, y
-- quedan en "Descartados", con quién y cuándo, para restaurarlos.
--
-- Solo avisos: un choque (rojo) es algo que la base o la subida rechazarían, y
-- no se descarta.
--
-- llave identifica el aviso tal cual: su tipo, sus grupos, sus franjas y sus
-- datos (frontend/src/lib/mallaVista.js, llaveAviso). Si el grupo se mueve o
-- cambia de profesor, el aviso es otro y vuelve a salir. Los grupos van por su
-- grupo_id: una nueva subida del motor crea grupos nuevos y los descartes
-- anteriores dejan de aplicar (se quedan en la tabla sin efecto).
-- llave_sha1 es la que se indexa: llave puede pasar de los 191 caracteres que
-- MariaDB 5.5 deja indexar en utf8mb4.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin la tabla, la malla da 500.
-- Se puede repetir: CREATE TABLE IF NOT EXISTS.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS malla_aviso_descartado (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    semestre_id     INT NOT NULL,
    departamento_id INT NOT NULL COMMENT 'Departamento del grupo del aviso: quién puede descartarlo y restaurarlo.',
    llave           TEXT NOT NULL COMMENT 'El aviso tal cual (tipo, grupos, franjas, datos); ver mallaVista.js llaveAviso.',
    llave_sha1      CHAR(40) NOT NULL,
    descripcion     VARCHAR(500) NOT NULL COMMENT 'El texto del aviso al descartarlo, para leerlo después.',
    descartado_por  INT NOT NULL,
    descartado_at   DATETIME NOT NULL COMMENT 'UTC.',
    UNIQUE KEY uq_mad_aviso (semestre_id, llave_sha1),
    CONSTRAINT fk_mad_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id),
    CONSTRAINT fk_mad_depto    FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_mad_por      FOREIGN KEY (descartado_por)  REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Avisos de la malla que la jefatura descarto (api/malla.php).';

SHOW TABLES LIKE 'malla_aviso_descartado';
