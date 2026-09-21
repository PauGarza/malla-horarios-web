-- =============================================================================
-- Autoplanear — Row Level Security
-- Requiere haber corrido schema.sql y triggers.sql primero.
--
-- Por qué existe este archivo: con el frontend en GitHub Pages (estático,
-- público) hablándole directo a la base de datos desde el navegador de cada
-- profesor, no hay backend intermedio que filtre quién puede leer/escribir
-- qué — la única capa de seguridad real es RLS. Sin esto, cualquier persona
-- con la clave pública (anon key) del proyecto —que es pública por diseño en
-- una app puramente cliente— podría leer o escribir cualquier fila de
-- cualquier tabla.
--
-- Autenticación: decisión 2026-09-21, credenciales manejadas por la app
-- (profesor.password_hash), NO por el sistema de autenticación propio del
-- proveedor de base de datos, para no acoplarlas a un proveedor específico de
-- cara a una posible migración de infraestructura. Esto significa que estas
-- políticas NO pueden usar auth.uid() (eso solo existe cuando el login pasa
-- por el sistema de auth nativo del proveedor). En su lugar:
--
--   1. Una función de login propia (backend/) recibe cu + password, valida
--      el hash con bcrypt, y si es válido firma un JWT propio con el secreto
--      JWT del proyecto — el mismo que usa la capa de API para validar
--      peticiones — incluyendo el claim estándar "role": "authenticated"
--      (para que se acepte como petición autenticada) más los claims
--      personalizados "profesor_id" y "rol".
--   2. El frontend usa ese JWT como Authorization Bearer en cada llamada —
--      la capa de API lo valida (misma firma que auth.uid() usaría) y expone
--      sus claims vía current_setting('request.jwt.claims').
--   3. Estas políticas leen esos claims de ahí, vía las funciones
--      app_profesor_id()/app_rol() de abajo, en vez de auth.uid().
--
-- Login unificado (2026-09-21): NO existe una tabla usuario/rol separada. Un
-- Jefe de Departamento/Servicios Escolares/Nómina/admin inicia sesión con el
-- mismo cu + password que cualquier profesor (un Jefe de Departamento también
-- da clases) — profesor.rol es lo único que cambia, y desbloquea políticas
-- adicionales más abajo en vez de pestañas ocultas solamente en el frontend
-- (la UI puede ocultar botones, pero la protección real vive aquí).
--
-- Todavía no se ha corrido contra ningún proyecto real.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_profesor_id() RETURNS int AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::json ->> 'profesor_id', '')::int;
$$ LANGUAGE sql STABLE;
COMMENT ON FUNCTION app_profesor_id IS
    'Lee el claim profesor_id del JWT propio (firmado por la función de login en backend/), NULL si no hay sesión o el token no trae ese claim.';

CREATE OR REPLACE FUNCTION app_rol() RETURNS text AS $$
    SELECT current_setting('request.jwt.claims', true)::json ->> 'rol';
$$ LANGUAGE sql STABLE;
COMMENT ON FUNCTION app_rol IS
    'Lee el claim rol del JWT propio (profesor.rol al momento del login — se firma directo en el token en vez de consultarse en cada política, por costo: cero queries extra por chequeo de RLS).';

-- -----------------------------------------------------------------------------
-- Catálogos: lectura abierta a cualquier sesión autenticada (con JWT propio
-- válido, sin importar el rol), sin escritura general desde el cliente —
-- excepto donde se indica explícitamente más abajo (materia/estimacion_demanda/
-- departamento_semestre_config, que Jefe de Departamento/admin sí necesitan
-- poder editar).
-- -----------------------------------------------------------------------------

ALTER TABLE departamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE materia ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_estudio ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_estudio_departamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_estudio_materia ENABLE ROW LEVEL SECURITY;
ALTER TABLE materia_prerequisito ENABLE ROW LEVEL SECURITY;
ALTER TABLE materia_co_oferta ENABLE ROW LEVEL SECURITY;
ALTER TABLE materia_equivalencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE semestre ENABLE ROW LEVEL SECURITY;
ALTER TABLE franja_horaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_disponibilidad_departamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE profesor_materia_elegible ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimacion_demanda ENABLE ROW LEVEL SECURITY;
ALTER TABLE departamento_semestre_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalogo_lectura_autenticados ON departamento
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON materia
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON plan_estudio
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON plan_estudio_departamento
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON plan_estudio_materia
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON materia_prerequisito
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON materia_co_oferta
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON materia_equivalencia
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON semestre
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON franja_horaria
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON salon
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON salon_disponibilidad_departamento
    FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogo_lectura_autenticados ON departamento_semestre_config
    FOR SELECT TO authenticated USING (true);

-- profesor_materia_elegible: un profesor solo necesita ver SU propia lista
-- personalizada (si modo_materias_elegibles = 'personalizada'), no la de otros.
CREATE POLICY propia_elegibilidad ON profesor_materia_elegible
    FOR SELECT TO authenticated
    USING (profesor_id = app_profesor_id());

-- RF15: la tabla la configura el Jefe de Departamento (o admin), no el propio
-- profesor — sin esta política, RLS bloqueaba por completo la escritura desde
-- el cliente y RF15 no tenía forma real de cumplirse.
CREATE POLICY jefe_elegibilidad_escritura ON profesor_materia_elegible
    FOR ALL TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento' AND profesor_id IN (
            SELECT id FROM profesor
            WHERE departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id())
        ))
    )
    WITH CHECK (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento' AND profesor_id IN (
            SELECT id FROM profesor
            WHERE departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id())
        ))
    );

-- -----------------------------------------------------------------------------
-- profesor: cada quien solo ve/edita su propia fila (nunca la de otro
-- profesor, y nunca password_hash de nadie vía este canal — ver nota abajo).
-- Jefe de Departamento/admin además pueden LEER el roster de su departamento
-- (o de todos, si admin) para las vistas de gestión — todavía sin escritura
-- desde el cliente (alta de profesores sigue siendo tarea de service_role).
-- -----------------------------------------------------------------------------

ALTER TABLE profesor ENABLE ROW LEVEL SECURITY;

CREATE POLICY propio_perfil_select ON profesor
    FOR SELECT TO authenticated
    USING (id = app_profesor_id());

CREATE POLICY roster_departamento_select ON profesor
    FOR SELECT TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento'
            AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    );
COMMENT ON POLICY roster_departamento_select ON profesor IS
    'admin ve el roster completo; jefe_departamento ve solo el roster de su propio departamento (comparado contra su propia fila, no un claim de departamento en el JWT, para no tener que reemitir el token si algún día cambia de departamento).';

-- Blindaje real 2026-09-21: privilegios a nivel de COLUMNA. Aunque las
-- políticas de arriba dejan pasar filas, 'authenticated' nunca recibe permiso
-- de leer password_hash — ni por error del frontend, ni por un cliente que
-- arme su propio SELECT *. Solo el rol de administrador de la base de datos
-- (nunca expuesto al navegador) la lee, para la función de login.
REVOKE ALL ON profesor FROM authenticated;
GRANT SELECT (id, cu, nombre, rol, departamento_id, tipo_contrato, modo_materias_elegibles,
              password_predeterminada, activo) ON profesor TO authenticated;
GRANT UPDATE (nombre) ON profesor TO authenticated; -- ampliar aquí si se habilitan más campos autoeditables

CREATE POLICY propio_perfil_update ON profesor
    FOR UPDATE TO authenticated
    USING (id = app_profesor_id())
    WITH CHECK (id = app_profesor_id());
COMMENT ON POLICY propio_perfil_update ON profesor IS
    'Combinada con el GRANT UPDATE (nombre) de arriba: cualquiera puede cambiar su propio nombre, nunca cu/rol/departamento_id/tipo_contrato/password_hash/password_predeterminada desde el cliente — esas requieren pasar por una función propia (ej. cambiar contraseña, o un ascenso de rol) con su propia validación, nunca un UPDATE directo del frontend.';

-- RF15: modo_materias_elegibles lo configura el Jefe de Departamento (o admin)
-- sobre OTROS profesores de su departamento, no el propio profesor.
GRANT UPDATE (modo_materias_elegibles) ON profesor TO authenticated;

CREATE POLICY jefe_modo_materias_update ON profesor
    FOR UPDATE TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento'
            AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    )
    WITH CHECK (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento'
            AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    );
COMMENT ON POLICY jefe_modo_materias_update ON profesor IS
    'Permite a Jefe de Departamento/admin editar modo_materias_elegibles de los profesores de su propio departamento (RF15).';

-- El GRANT UPDATE (modo_materias_elegibles) de arriba es necesariamente amplio
-- (Postgres no permite atar una columna a una sola política) — sin este
-- trigger, un profesor normal podría cambiarse su propio modo_materias_elegibles
-- aprovechando propio_perfil_update, que ya lo deja tocar su propia fila.
CREATE OR REPLACE FUNCTION fn_bloquear_automodificacion_modo_materias()
RETURNS trigger AS $$
BEGIN
    IF NEW.modo_materias_elegibles IS DISTINCT FROM OLD.modo_materias_elegibles
       AND app_rol() NOT IN ('admin', 'jefe_departamento') THEN
        RAISE EXCEPTION 'Solo Jefe de Departamento o admin puede cambiar modo_materias_elegibles';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bloquear_automodificacion_modo_materias
    BEFORE UPDATE ON profesor
    FOR EACH ROW
    EXECUTE FUNCTION fn_bloquear_automodificacion_modo_materias();

-- -----------------------------------------------------------------------------
-- preferencia / preferencia_materia / disponibilidad: el corazón de lo que
-- hay que proteger — cada profesor solo puede leer y escribir SU preferencia
-- del semestre, nunca la de un colega. Jefe de Departamento/admin pueden LEER
-- (no editar) las de su departamento, para RF14 (vista de asignación).
-- -----------------------------------------------------------------------------

ALTER TABLE preferencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE preferencia_materia ENABLE ROW LEVEL SECURITY;
ALTER TABLE disponibilidad ENABLE ROW LEVEL SECURITY;

CREATE POLICY propia_preferencia_select ON preferencia
    FOR SELECT TO authenticated
    USING (profesor_id = app_profesor_id());

CREATE POLICY departamento_preferencia_select ON preferencia
    FOR SELECT TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento' AND profesor_id IN (
            SELECT id FROM profesor
            WHERE departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id())
        ))
    );

CREATE POLICY propia_preferencia_insert ON preferencia
    FOR INSERT TO authenticated
    WITH CHECK (profesor_id = app_profesor_id());

CREATE POLICY propia_preferencia_update ON preferencia
    FOR UPDATE TO authenticated
    USING (profesor_id = app_profesor_id() AND estado = 'borrador')
    WITH CHECK (profesor_id = app_profesor_id());
COMMENT ON POLICY propia_preferencia_update ON preferencia IS
    'USING exige estado = borrador: una vez en enviado, el profesor ya no puede editar por su cuenta. Reabrirla es tarea de Jefe de Departamento — falta su política de UPDATE (pendiente, no bloquea recolectar preferencias).';

CREATE POLICY propia_preferencia_materia ON preferencia_materia
    FOR ALL TO authenticated
    USING (preferencia_id IN (SELECT id FROM preferencia WHERE profesor_id = app_profesor_id()))
    WITH CHECK (preferencia_id IN (SELECT id FROM preferencia WHERE profesor_id = app_profesor_id()));

CREATE POLICY departamento_preferencia_materia_select ON preferencia_materia
    FOR SELECT TO authenticated
    USING (preferencia_id IN (SELECT id FROM preferencia WHERE profesor_id IN (
        SELECT id FROM profesor WHERE app_rol() = 'admin'
           OR (app_rol() = 'jefe_departamento'
               AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    )));

CREATE POLICY propia_disponibilidad ON disponibilidad
    FOR ALL TO authenticated
    USING (preferencia_id IN (SELECT id FROM preferencia WHERE profesor_id = app_profesor_id()))
    WITH CHECK (preferencia_id IN (SELECT id FROM preferencia WHERE profesor_id = app_profesor_id()));

CREATE POLICY departamento_disponibilidad_select ON disponibilidad
    FOR SELECT TO authenticated
    USING (preferencia_id IN (SELECT id FROM preferencia WHERE profesor_id IN (
        SELECT id FROM profesor WHERE app_rol() = 'admin'
           OR (app_rol() = 'jefe_departamento'
               AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    )));

-- -----------------------------------------------------------------------------
-- Carga/edición de catálogo (materia, estimacion_demanda,
-- departamento_semestre_config): esto resuelve la pregunta de alcance de
-- diseno-bd.md §10.3 — ya NO hace falta un secreto compartido aparte para
-- admin/Jefe de Departamento. Con login unificado + rol en el JWT, Jefe de
-- Departamento inicia sesión igual que cualquier profesor y estas políticas
-- lo dejan editar el catálogo de SU departamento; admin, el de todos.
-- -----------------------------------------------------------------------------

CREATE POLICY materia_escritura_departamento ON materia
    FOR ALL TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento'
            AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    )
    WITH CHECK (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento'
            AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    );
COMMENT ON POLICY materia_escritura_departamento ON materia IS
    'Jefe de Departamento solo puede crear/editar materias de SU propio departamento (comparado contra su propia fila de profesor); admin, de cualquiera. Esta política se suma a catalogo_lectura_autenticados (que ya cubre SELECT para todos) — FOR ALL aquí sí incluye INSERT/UPDATE/DELETE.';

CREATE POLICY estimacion_demanda_lectura_visible ON estimacion_demanda
    FOR SELECT TO authenticated USING (mostrar_en_cuestionario = true);
COMMENT ON POLICY estimacion_demanda_lectura_visible ON estimacion_demanda IS
    'Un profesor normal solo ve materias con mostrar_en_cuestionario = true (incluye Sug = 0 si no se ocultó explícitamente). Ver política de abajo para Jefe de Departamento/admin, que sí necesitan ver TODO.';

CREATE POLICY estimacion_demanda_departamento ON estimacion_demanda
    FOR ALL TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento' AND materia_id IN (
            SELECT id FROM materia
            WHERE departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id())
        ))
    )
    WITH CHECK (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento' AND materia_id IN (
            SELECT id FROM materia
            WHERE departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id())
        ))
    );
COMMENT ON POLICY estimacion_demanda_departamento ON estimacion_demanda IS
    'Jefe de Departamento/admin ven y editan TODAS las filas de su alcance (incluidas Sug = 0 y las ocultas) — esta política es la ruta de carga del catálogo semestral (§10.3 de diseno-bd.md): un Jefe autenticado normal, con su mismo login, puede pegar la tabla del PDF de demanda y hacer upsert directo, sin secreto compartido ni herramienta aparte.';

CREATE POLICY departamento_config_escritura ON departamento_semestre_config
    FOR ALL TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento'
            AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    )
    WITH CHECK (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento'
            AND departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id()))
    );
COMMENT ON POLICY departamento_config_escritura ON departamento_semestre_config IS
    'Jefe de Departamento configura mostrar_seleccion_materias y horas_minimas_verde de SU departamento; admin, de cualquiera.';

-- -----------------------------------------------------------------------------
-- Malla/asignación (grupo, imparte, imparte_*): SIN políticas de escritura
-- para 'authenticated' todavía — a propósito. Esto es el motor de asignación
-- en sí (RF06/RF13/RF14), que no existe todavía como funcionalidad, más allá
-- del acceso de lectura ya resuelto arriba. Mientras tanto:
-- - RLS queda ENABLED (bloquea todo por defecto) para que nadie las toque
--   desde el cliente por accidente mientras no hay política explícita.
-- - Se siguen pudiendo escribir con el rol de administrador de la base de
--   datos (uso de scripts/admin, nunca expuesto al navegador).
-- -----------------------------------------------------------------------------

ALTER TABLE grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE imparte ENABLE ROW LEVEL SECURITY;
ALTER TABLE imparte_profesor ENABLE ROW LEVEL SECURITY;
ALTER TABLE imparte_co_oferta ENABLE ROW LEVEL SECURITY;
ALTER TABLE imparte_horario ENABLE ROW LEVEL SECURITY;

CREATE POLICY grupo_departamento_select ON grupo
    FOR SELECT TO authenticated
    USING (
        app_rol() = 'admin'
        OR (app_rol() = 'jefe_departamento' AND materia_id IN (
            SELECT id FROM materia
            WHERE departamento_id = (SELECT departamento_id FROM profesor WHERE id = app_profesor_id())
        ))
    );

-- Excepción concreta ya necesaria para V1: un profesor sí necesita poder
-- CONSULTAR (no editar) su propia asignación ya confirmada, una vez publicada.
CREATE POLICY propia_asignacion_select ON imparte
    FOR SELECT TO authenticated
    USING (
        id IN (SELECT imparte_id FROM imparte_profesor WHERE profesor_id = app_profesor_id())
        AND EXISTS (SELECT 1 FROM grupo g WHERE g.id = imparte.grupo_id AND g.publicado = true)
    );
COMMENT ON POLICY propia_asignacion_select ON imparte IS
    'Solo lectura, y solo una vez grupo.publicado = true (RN09) — antes de publicar, la malla en construcción no es visible para los profesores.';

-- Pendiente (no bloquea la recolección de preferencias ni la carga del
-- catálogo, que ya quedaron resueltas arriba): políticas de INSERT/UPDATE
-- para Jefe de Departamento sobre grupo/imparte/imparte_horario — depende de
-- que exista el motor de asignación en sí (RF06), no solo el login/rol.
