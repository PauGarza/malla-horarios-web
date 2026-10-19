-- =============================================================================
-- Migración 2026-10-13 (d) — descarga y subida de datos del motor
--
-- Prepara la base para api/motor-entrada.php (descarga el paquete
-- autoplanear-entrada/2) y api/motor-salida.php (valida y escribe el
-- autoplanear-salida/2 en grupo / imparte / imparte_profesor / imparte_horario
-- / imparte_co_oferta). Formato en malla-horarios/docs/convencion-datos-motor.md.
--
-- Cuatro cambios:
--
-- 1. grupo.crn acepta NULL. El motor no da CRN: lo asigna Servicios Escolares
--    después. MariaDB 5.5 admite varios NULL en un UNIQUE, así que
--    uq_grupo_crn (semestre_id, crn) sigue protegiendo los CRN reales.
--
-- 2. imparte_horario.salon_id acepta NULL ("modo sin salones", D44). Este
--    semestre todavía no hay salones asignados: el motor corre sin salones,
--    asigna profesor y horario, y el grupo queda en 'en_asignacion' hasta que
--    se carguen los salones y se vuelva a correr.
--
-- 3. sp_validar_imparte_horario:
--    - un grupo espejo (co-oferta) es UNA clase física con dos claves, o sea
--      dos imparte con el mismo profesor, salón y horario. Antes la segunda
--      clave se rechazaba como traslape de profesor y de salón. Ahora los
--      chequeos 1 y 2 ignoran los imparte ligados por imparte_co_oferta (en
--      cualquier dirección). Por eso el API inserta el vínculo ANTES que el
--      horario.
--    - con salon_id NULL se saltan los chequeos de salón (2, 3 y 3b).
--    Los triggers trg_imparte_horario_ins/_upd llaman al procedimiento por
--    nombre: no hay que tocarlos.
--
-- 4. Tablas motor_descarga y motor_corrida: la huella de cada descarga (para
--    avisar si el resultado está desfasado, §4.1 de la convención) y lo que
--    trae cada resultado aplicado que no cabe en grupo/imparte (sin_asignar,
--    avisos, métricas), para la vista de malla.
--
-- ADITIVA: correr en phpMyAdmin ANTES de `npm run deploy:api`. Con el API nuevo
-- y sin las tablas, la pestaña "Datos para el motor" da 500.
-- Una sola vez (el DROP PROCEDURE la hace repetible, los ALTER también).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

-- 1 y 2 -----------------------------------------------------------------------

ALTER TABLE grupo
    MODIFY crn INT NULL COMMENT 'NULL hasta que Servicios Escolares asigne el CRN (el motor no lo da).';

ALTER TABLE imparte_horario
    MODIFY salon_id INT NULL COMMENT 'NULL = todavia sin salon (modo sin salones, D44).';

-- 3 ---------------------------------------------------------------------------

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

-- 4 ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS motor_descarga (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    semestre_id   INT NOT NULL,
    departamentos VARCHAR(50) NOT NULL COMMENT 'Ids del alcance, ordenados y separados por coma: "1" o "1,2,3".',
    con_salones   TINYINT(1) NOT NULL COMMENT '0 = se descargo con salones: [] (modo sin salones, D44).',
    generado_at   VARCHAR(32) NOT NULL COMMENT 'Tal cual va en el JSON (ISO 8601 con -06:00); la salida lo devuelve en entrada.generado_at.',
    huella        CHAR(64) NOT NULL COMMENT 'SHA-256 del paquete sin generado_at ni generado_por. Si al subir no coincide, el resultado esta desfasado.',
    generado_por  INT NOT NULL,
    descargado_at DATETIME NOT NULL COMMENT 'UTC.',
    UNIQUE KEY uq_motor_descarga (semestre_id, generado_at, departamentos),
    CONSTRAINT fk_md_semestre FOREIGN KEY (semestre_id)  REFERENCES semestre(id),
    CONSTRAINT fk_md_por      FOREIGN KEY (generado_por) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cada paquete autoplanear-entrada descargado para el motor. Ver api/motor-entrada.php.';

CREATE TABLE IF NOT EXISTS motor_corrida (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    semestre_id         INT NOT NULL,
    departamentos       VARCHAR(50) NOT NULL COMMENT 'Mismo formato que motor_descarga.departamentos.',
    descarga_id         INT NULL COMMENT 'NULL = el resultado responde a una descarga que no se reconocio.',
    desfasada           TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = algo cambio desde la descarga y se aplico de todos modos.',
    motor               LONGTEXT NULL COMMENT 'JSON: el bloque motor de la salida (nombre, version, parametros).',
    sin_asignar         LONGTEXT NULL COMMENT 'JSON: sin_asignar de la salida (§4.3).',
    avisos              LONGTEXT NULL COMMENT 'JSON: {motor: [...], sistema: [...]} (§4.4 y blandas de §5).',
    metricas            LONGTEXT NULL COMMENT 'JSON: metricas de la salida (§4.5), sin interpretar.',
    grupos_creados      INT NOT NULL,
    grupos_reemplazados INT NOT NULL,
    subido_por          INT NOT NULL,
    subido_at           DATETIME NOT NULL COMMENT 'UTC.',
    KEY idx_mco_semestre (semestre_id),
    CONSTRAINT fk_mco_semestre FOREIGN KEY (semestre_id) REFERENCES semestre(id),
    CONSTRAINT fk_mco_descarga FOREIGN KEY (descarga_id) REFERENCES motor_descarga(id),
    CONSTRAINT fk_mco_por      FOREIGN KEY (subido_por)  REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cada resultado del motor aplicado (api/motor-salida.php). La vista de malla lee aqui sin_asignar y avisos.';

-- Verificación: crn y salon_id con "YES" en Null, y las dos tablas nuevas.
SHOW COLUMNS FROM grupo LIKE 'crn';
SHOW COLUMNS FROM imparte_horario LIKE 'salon_id';
SHOW CREATE TABLE motor_descarga;
SHOW CREATE TABLE motor_corrida;
