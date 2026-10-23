-- =============================================================================
-- Migración 2026-10-23 — "Profesor por asignar"
--
-- Un profesor comodín por departamento que no es una persona: sirve para
--   1. que la jefatura fije en Asignaciones directas una materia que todavía no
--      tiene profesor ("este grupo se abre, el profesor se ve después"), y
--   2. que el motor le ponga horario a un grupo que ningún profesor puede dar,
--      en vez de dejarlo fuera de la malla (sin_asignar). En la salida del
--      motor ese grupo viene con profesores: [] y al subirlo se guarda con
--      este profesor (api/lib/motor.php, motor_aplicar).
--
-- Es una fila de profesor como los "sin cuenta" de D45 (cu y password_hash
-- NULL, activo = 0, tipo_contrato NULL), así que ya queda fuera de login,
-- paneles, reportes, respuestas y del paquete del motor, que filtran
-- activo = 1 AND tipo_contrato IS NOT NULL. Lo que lo distingue es
-- por_asignar = 1, y eso es lo que hay que preguntar: nunca por el nombre.
--
-- Uno por departamento y no uno global: asignaciones.php exige que el profesor
-- sea del departamento de la materia, y un grupo de Matemáticas por asignar es
-- "por asignar en Matemáticas". La unicidad (uno por departamento) la cuida el
-- INSERT de abajo; MariaDB 5.5 no tiene índices parciales para exigirla.
--
-- sp_validar_imparte_horario: el chequeo 1 (traslape de profesor) ignora a
-- estos profesores. Varios grupos por asignar a la misma hora no chocan entre
-- sí: cada uno lo va a dar alguien distinto. Los triggers lo llaman por nombre,
-- no hay que tocarlos.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin la columna, Asignaciones directas, la descarga del motor y la malla
-- dan 500.
-- UNA sola vez: MariaDB 5.5 no tiene ADD COLUMN IF NOT EXISTS. El INSERT y el
-- procedimiento sí se pueden repetir.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

ALTER TABLE profesor
    ADD COLUMN por_asignar TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '1 = "Profesor por asignar" de su departamento: no es una persona, marca un grupo sin profesor todavia (2026-10-23).'
        AFTER activo;

INSERT INTO profesor
       (cu, password_hash, nombre, correo, rol, departamento_id, tipo_contrato,
        password_predeterminada, estado_especial, activo, por_asignar)
SELECT NULL, NULL, 'Profesor por asignar', NULL, 'profesor', d.id, NULL, 0, NULL, 0, 1
  FROM departamento d
 WHERE NOT EXISTS (SELECT 1 FROM profesor p WHERE p.por_asignar = 1 AND p.departamento_id = d.id);

DROP PROCEDURE IF EXISTS sp_validar_imparte_horario;

DELIMITER $$

CREATE PROCEDURE sp_validar_imparte_horario(
    IN p_id INT, IN p_imparte_id INT, IN p_dia VARCHAR(10),
    IN p_franja_id INT, IN p_salon_id INT
)
BEGIN
    DECLARE v_semestre_id     INT;
    DECLARE v_departamento_id INT;
    DECLARE v_tipo_requerido  VARCHAR(255);
    DECLARE v_tipo_salon      VARCHAR(255);
    DECLARE v_conflictos      INT;
    DECLARE v_autorizado      INT;

    SELECT g.semestre_id, m.departamento_id, m.tipo_salon_requerido
      INTO v_semestre_id, v_departamento_id, v_tipo_requerido
      FROM imparte i
      JOIN grupo g   ON g.id = i.grupo_id
      JOIN materia m ON m.id = g.materia_id
     WHERE i.id = p_imparte_id;

    -- 1. Un profesor no puede estar en dos grupos al mismo tiempo (mismo
    --    semestre, mismo dia/franja), salvo que sean la misma clase con otra
    --    clave (grupo espejo, ligado en imparte_co_oferta).
    SELECT COUNT(*) INTO v_conflictos
      FROM imparte_horario ih
      JOIN imparte_profesor ip ON ip.imparte_id = ih.imparte_id
      JOIN imparte i2 ON i2.id = ih.imparte_id
      JOIN grupo g2  ON g2.id = i2.grupo_id
     WHERE ih.id <> IFNULL(p_id, -1)
       AND ih.dia = p_dia
       AND ih.franja_id = p_franja_id
       AND g2.semestre_id = v_semestre_id
       AND ip.profesor_id IN (
           SELECT profesor_id FROM imparte_profesor WHERE imparte_id = p_imparte_id
       )
       -- "Profesor por asignar" (2026-10-23) no es una persona: puede estar
       -- en muchos grupos a la misma hora.
       AND NOT EXISTS (
           SELECT 1 FROM profesor pa WHERE pa.id = ip.profesor_id AND pa.por_asignar = 1
       )
       AND NOT EXISTS (
           SELECT 1 FROM imparte_co_oferta ico
            WHERE (ico.imparte_id = p_imparte_id AND ico.imparte_relacionado_id = ih.imparte_id)
               OR (ico.imparte_id = ih.imparte_id AND ico.imparte_relacionado_id = p_imparte_id)
       );
    IF v_conflictos > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Traslape de profesor: ya tiene una clase asignada en esa franja';
    END IF;

    -- Sin salon todavia (D44): no hay salon que validar.
    IF p_salon_id IS NOT NULL THEN
        -- 2. Un salon no puede tener dos grupos al mismo tiempo (RN02), salvo
        --    el grupo espejo de la misma clase.
        SELECT COUNT(*) INTO v_conflictos
          FROM imparte_horario ih
          JOIN imparte i2 ON i2.id = ih.imparte_id
          JOIN grupo g2  ON g2.id = i2.grupo_id
         WHERE ih.id <> IFNULL(p_id, -1)
           AND ih.dia = p_dia
           AND ih.franja_id = p_franja_id
           AND ih.salon_id = p_salon_id
           AND g2.semestre_id = v_semestre_id
           AND NOT EXISTS (
               SELECT 1 FROM imparte_co_oferta ico
                WHERE (ico.imparte_id = p_imparte_id AND ico.imparte_relacionado_id = ih.imparte_id)
                   OR (ico.imparte_id = ih.imparte_id AND ico.imparte_relacionado_id = p_imparte_id)
           );
        IF v_conflictos > 0 THEN
            SIGNAL SQLSTATE '45000'
              SET MESSAGE_TEXT = 'Traslape de salon: ya esta ocupado en esa franja';
        END IF;

        -- 3. El salon debe estar autorizado para el depto en ese semestre/dia/franja.
        SELECT COUNT(*) INTO v_autorizado
          FROM salon_disponibilidad_departamento sdd
         WHERE sdd.salon_id = p_salon_id
           AND sdd.departamento_id = v_departamento_id
           AND sdd.semestre_id = v_semestre_id
           AND sdd.dia = p_dia
           AND sdd.franja_id = p_franja_id;
        IF v_autorizado = 0 THEN
            SIGNAL SQLSTATE '45000'
              SET MESSAGE_TEXT = 'El salon no esta autorizado para ese departamento en esa franja';
        END IF;

        -- 3b. Si la materia exige un tipo de salon, el salon debe cumplirlo.
        IF v_tipo_requerido IS NOT NULL THEN
            SELECT tipo INTO v_tipo_salon FROM salon WHERE id = p_salon_id;
            IF NOT (v_tipo_salon <=> v_tipo_requerido) THEN
                SIGNAL SQLSTATE '45000'
                  SET MESSAGE_TEXT = 'El salon no es del tipo que requiere la materia';
            END IF;
        END IF;
    END IF;
END$$

DELIMITER ;

-- Verificación: la columna, y un "Profesor por asignar" por departamento.
SHOW COLUMNS FROM profesor LIKE 'por_asignar';
SELECT p.id, p.nombre, d.nombre AS departamento, p.activo, p.cu
  FROM profesor p JOIN departamento d ON d.id = p.departamento_id
 WHERE p.por_asignar = 1
 ORDER BY d.id;
