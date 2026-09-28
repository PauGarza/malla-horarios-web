-- =============================================================================
-- Autoplanear — triggers de restricciones duras (MySQL)
-- Traduccion de ../triggers.sql. Requiere schema-mysql.sql cargado.
--
-- Estas reglas son agregados (dependen de otras filas ya existentes), asi que
-- no caben en un CHECK de columna. El esquema se mantiene normalizado: no se
-- duplican columnas de profesor/salon/semestre en imparte_horario solo para
-- poder usar UNIQUE.
--
-- Tres diferencias con plpgsql que hay que cuidar al leer esto:
--   - RAISE EXCEPTION            -> SIGNAL SQLSTATE '45000' (desde MySQL 5.5).
--   - FOUND                      -> no existe; se cuenta con SELECT COUNT(*) INTO.
--   - IS DISTINCT FROM           -> no existe; NOT (a <=> b), donde <=> es la
--                                   comparacion segura con NULL.
-- Y la cuarta, la que decide la forma del archivo: MySQL no tiene
-- "BEFORE INSERT OR UPDATE". Las 4 validaciones de ../triggers.sql se juntan
-- en UN procedimiento y los dos triggers (INSERT y UPDATE) lo llaman, para no
-- duplicar el cuerpo ni recorrer las mismas tablas cuatro veces por fila.
-- =============================================================================

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
    --    semestre, mismo dia/franja), sin importar en que imparte este cada uno.
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
       );
    IF v_conflictos > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Traslape de profesor: ya tiene una clase asignada en esa franja';
    END IF;

    -- 2. Un salon no puede tener dos grupos al mismo tiempo (RN02).
    SELECT COUNT(*) INTO v_conflictos
      FROM imparte_horario ih
      JOIN imparte i2 ON i2.id = ih.imparte_id
      JOIN grupo g2  ON g2.id = i2.grupo_id
     WHERE ih.id <> IFNULL(p_id, -1)
       AND ih.dia = p_dia
       AND ih.franja_id = p_franja_id
       AND ih.salon_id = p_salon_id
       AND g2.semestre_id = v_semestre_id;
    IF v_conflictos > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Traslape de salon: ya esta ocupado en esa franja';
    END IF;

    -- 3. El salon debe estar autorizado para el depto en ese semestre/dia/franja.
    --    En V1 la tabla se siembra permisiva (seed-mysql.sql), asi que esto no
    --    bloquea nada hasta que se carguen datos reales de Servicios Escolares.
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
    --     (Calculo Numerico y parientes siempre en RHCC302, con datos reales.)
    IF v_tipo_requerido IS NOT NULL THEN
        SELECT tipo INTO v_tipo_salon FROM salon WHERE id = p_salon_id;
        -- <=> es la comparacion segura con NULL; NOT(a <=> b) = IS DISTINCT FROM.
        IF NOT (v_tipo_salon <=> v_tipo_requerido) THEN
            SIGNAL SQLSTATE '45000'
              SET MESSAGE_TEXT = 'El salon no es del tipo que requiere la materia';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_imparte_horario_ins BEFORE INSERT ON imparte_horario FOR EACH ROW
BEGIN
    -- p_id NULL: en un INSERT todavia no hay id propio que excluir de la busqueda
    -- de conflictos (el COALESCE(NEW.id, -1) del original).
    CALL sp_validar_imparte_horario(NULL, NEW.imparte_id, NEW.dia, NEW.franja_id, NEW.salon_id);
END$$

CREATE TRIGGER trg_imparte_horario_upd BEFORE UPDATE ON imparte_horario FOR EACH ROW
BEGIN
    CALL sp_validar_imparte_horario(NEW.id, NEW.imparte_id, NEW.dia, NEW.franja_id, NEW.salon_id);
END$$

-- Suma de creditos: igual que en Postgres, NO es trigger automatico a proposito.
-- Forzarlo en cada INSERT impediria construir la malla incrementalmente (un
-- grupo de 6 creditos se arma fila por fila y a medio construir la suma no
-- cierra). La aplicacion la llama cuando el Jefe marca el grupo como asignado
-- o lo publica.
CREATE FUNCTION fn_validar_creditos_imparte(p_imparte_id INT)
RETURNS BOOLEAN
READS SQL DATA
BEGIN
    DECLARE v_creditos INT;
    DECLARE v_horas DECIMAL(6,2);
    SELECT m.creditos INTO v_creditos
      FROM imparte i JOIN grupo g ON g.id = i.grupo_id JOIN materia m ON m.id = g.materia_id
     WHERE i.id = p_imparte_id;
    SELECT COUNT(*) * 0.5 INTO v_horas FROM imparte_horario WHERE imparte_id = p_imparte_id;
    RETURN v_horas = v_creditos;
END$$

DELIMITER ;

-- Si CREATE FUNCTION da el error 1418 ("binary logging is enabled and you do
-- not have the SUPER privilege..."), el hosting tiene
-- log_bin_trust_function_creators = 0. READS SQL DATA ya esta puesto arriba;
-- si aun asi persiste, mover esa validacion a PHP — son dos consultas y ningun
-- endpoint la usa todavia (el motor de asignacion no existe).
--
-- Los dos triggers de ../rls-policies.sql NO se traducen:
-- trg_bloquear_automodificacion_modo_materias y trg_limitar_reapertura_jefe
-- existen solo para acotar politicas RLS necesariamente mas amplias que su
-- intencion. Un endpoint que no acepta el campo no necesita trigger.
