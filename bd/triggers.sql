-- =============================================================================
-- Autoplanear — triggers de restricciones duras
-- Requiere haber corrido schema.sql primero.
--
-- NO EJECUTAR TODAVÍA: pendiente de revisión del usuario.
--
-- Estas reglas son agregados (dependen de otras filas ya existentes), así que no
-- caben en un CHECK simple de columna — por eso se aplican como trigger sobre
-- imparte_horario. El esquema se mantiene normalizado: no se duplican columnas de
-- profesor/salón/semestre en imparte_horario solo para poder usar UNIQUE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Un profesor no puede estar en dos grupos al mismo tiempo (mismo semestre,
--    mismo día/franja), sin importar en qué imparte esté cada uno.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validar_no_doble_booking_profesor()
RETURNS trigger AS $$
DECLARE
    v_semestre_id int;
    v_conflicto    record;
BEGIN
    SELECT g.semestre_id INTO v_semestre_id
    FROM imparte i
    JOIN grupo g ON g.id = i.grupo_id
    WHERE i.id = NEW.imparte_id;

    SELECT ih.id, ih.imparte_id, ip.profesor_id
    INTO v_conflicto
    FROM imparte_horario ih
    JOIN imparte_profesor ip ON ip.imparte_id = ih.imparte_id
    JOIN imparte i2 ON i2.id = ih.imparte_id
    JOIN grupo g2 ON g2.id = i2.grupo_id
    WHERE ih.id <> COALESCE(NEW.id, -1)
      AND ih.dia = NEW.dia
      AND ih.franja_id = NEW.franja_id
      AND g2.semestre_id = v_semestre_id
      AND ip.profesor_id IN (
          SELECT profesor_id FROM imparte_profesor WHERE imparte_id = NEW.imparte_id
      )
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Traslape de profesor: el profesor % ya tiene una clase asignada el % en la franja % (imparte_horario existente id=%)',
            v_conflicto.profesor_id, NEW.dia, NEW.franja_id, v_conflicto.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_doble_booking_profesor
    BEFORE INSERT OR UPDATE ON imparte_horario
    FOR EACH ROW
    EXECUTE FUNCTION fn_validar_no_doble_booking_profesor();

-- -----------------------------------------------------------------------------
-- 2. Un salón no puede tener dos grupos al mismo tiempo (mismo semestre, mismo
--    día/franja) — RN02.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validar_no_doble_booking_salon()
RETURNS trigger AS $$
DECLARE
    v_semestre_id int;
    v_conflicto    record;
BEGIN
    SELECT g.semestre_id INTO v_semestre_id
    FROM imparte i
    JOIN grupo g ON g.id = i.grupo_id
    WHERE i.id = NEW.imparte_id;

    SELECT ih.id, ih.imparte_id
    INTO v_conflicto
    FROM imparte_horario ih
    JOIN imparte i2 ON i2.id = ih.imparte_id
    JOIN grupo g2 ON g2.id = i2.grupo_id
    WHERE ih.id <> COALESCE(NEW.id, -1)
      AND ih.dia = NEW.dia
      AND ih.franja_id = NEW.franja_id
      AND ih.salon_id = NEW.salon_id
      AND g2.semestre_id = v_semestre_id
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Traslape de salón: el salón % ya está ocupado el % en la franja % (imparte_horario existente id=%)',
            NEW.salon_id, NEW.dia, NEW.franja_id, v_conflicto.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_doble_booking_salon
    BEFORE INSERT OR UPDATE ON imparte_horario
    FOR EACH ROW
    EXECUTE FUNCTION fn_validar_no_doble_booking_salon();

-- -----------------------------------------------------------------------------
-- 3. El salón asignado debe estar autorizado para el departamento del grupo en
--    ese semestre/día/franja (salon_disponibilidad_departamento).
--    NOTA: en V1 la tabla se siembra permisiva (los 3 departamentos comparten
--    todo el pool, ver seed.sql), así que este trigger no bloqueará nada hasta
--    que se carguen datos reales y restrictivos de Servicios Escolares.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validar_salon_autorizado_departamento()
RETURNS trigger AS $$
DECLARE
    v_departamento_id int;
    v_semestre_id      int;
BEGIN
    SELECT m.departamento_id, g.semestre_id
    INTO v_departamento_id, v_semestre_id
    FROM imparte i
    JOIN grupo g ON g.id = i.grupo_id
    JOIN materia m ON m.id = g.materia_id
    WHERE i.id = NEW.imparte_id;

    IF NOT EXISTS (
        SELECT 1 FROM salon_disponibilidad_departamento sdd
        WHERE sdd.salon_id = NEW.salon_id
          AND sdd.departamento_id = v_departamento_id
          AND sdd.semestre_id = v_semestre_id
          AND sdd.dia = NEW.dia
          AND sdd.franja_id = NEW.franja_id
    ) THEN
        RAISE EXCEPTION
            'El salón % no está autorizado para el departamento % el % en la franja % del semestre %',
            NEW.salon_id, v_departamento_id, NEW.dia, NEW.franja_id, v_semestre_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_salon_autorizado_departamento
    BEFORE INSERT OR UPDATE ON imparte_horario
    FOR EACH ROW
    EXECUTE FUNCTION fn_validar_salon_autorizado_departamento();

-- -----------------------------------------------------------------------------
-- 3b. Si la materia exige un tipo de salón específico (ej. 'Sala de cómputo',
--     confirmado con datos reales: Cálculo Numérico/Análisis Numérico/
--     Optimización Numérica/Matemática Computacional siempre en RHCC302), el
--     salón asignado debe cumplirlo.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validar_tipo_salon_requerido()
RETURNS trigger AS $$
DECLARE
    v_tipo_requerido text;
    v_tipo_salon      text;
BEGIN
    SELECT m.tipo_salon_requerido INTO v_tipo_requerido
    FROM imparte i
    JOIN grupo g ON g.id = i.grupo_id
    JOIN materia m ON m.id = g.materia_id
    WHERE i.id = NEW.imparte_id;

    IF v_tipo_requerido IS NULL THEN
        RETURN NEW; -- cualquier salón sirve
    END IF;

    SELECT tipo INTO v_tipo_salon FROM salon WHERE id = NEW.salon_id;

    IF v_tipo_salon IS DISTINCT FROM v_tipo_requerido THEN
        RAISE EXCEPTION
            'El salón % es de tipo % pero la materia requiere tipo %',
            NEW.salon_id, v_tipo_salon, v_tipo_requerido;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tipo_salon_requerido
    BEFORE INSERT OR UPDATE ON imparte_horario
    FOR EACH ROW
    EXECUTE FUNCTION fn_validar_tipo_salon_requerido();

-- -----------------------------------------------------------------------------
-- 4. Suma de créditos: no es un trigger automático a propósito.
--
-- Forzarlo en cada INSERT de imparte_horario impediría construir la malla
-- incrementalmente (un grupo de 6 créditos se arma fila por fila, y a medio
-- construir la suma todavía no cierra). Se deja como función de validación que
-- la aplicación llama explícitamente cuando el Jefe de Departamento marca el
-- grupo como 'asignado' (estado_grupo_enum) o cuando lo publica.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validar_creditos_imparte(p_imparte_id int)
RETURNS boolean AS $$
DECLARE
    v_creditos_esperados int;
    v_horas_asignadas    numeric;
BEGIN
    SELECT m.creditos INTO v_creditos_esperados
    FROM imparte i
    JOIN grupo g ON g.id = i.grupo_id
    JOIN materia m ON m.id = g.materia_id
    WHERE i.id = p_imparte_id;

    SELECT COUNT(*) * 0.5 INTO v_horas_asignadas
    FROM imparte_horario
    WHERE imparte_id = p_imparte_id;

    RETURN v_horas_asignadas = v_creditos_esperados;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_validar_creditos_imparte IS
    'Llamar desde la aplicación antes de marcar un grupo como asignado/publicado. No es un trigger automático — ver comentario arriba.';
