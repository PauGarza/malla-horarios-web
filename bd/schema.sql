-- =============================================================================
-- Autoplanear — esquema de base de datos (PostgreSQL)
-- Ver diseno-bd.md para el razonamiento detrás de cada tabla/decisión.
--
-- Hosting confirmado 2026-09-21: proveedor de base de datos administrado en la
-- nube (ver diseno-bd.md §4). Autenticación manejada por la aplicación
-- (profesor.password_hash), no por el sistema de auth nativo del proveedor —
-- decisión explícita para no acoplar credenciales al proveedor de cara a una
-- posible migración de infraestructura a futuro. Esto significa que RLS no
-- puede usar auth.uid(); ver rls-policies.sql para el mecanismo real (JWT
-- propio con claim personalizado, vía una función de backend).
--
-- Login unificado (2026-09-21): NO existe una tabla `usuario` separada. Jefe
-- de Departamento/Servicios Escolares/Nómina/admin inician sesión con el mismo
-- `profesor.cu` + password que cualquier profesor — un Jefe de Departamento ya
-- es un profesor (también da clases); lo único que cambia es profesor.rol,
-- que determina qué pestañas/vistas adicionales ve. Ver diseno-bd.md §4.
--
-- Orden de carga: schema.sql -> triggers.sql -> rls-policies.sql -> seed.sql
-- Corrido contra el proyecto real de base de datos 2026-09-21.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos (enums)
-- -----------------------------------------------------------------------------

-- 'medio_tiempo' se agregó 2026-09-24 al cargar el concentrado real de un
-- departamento: maneja "1/2 tiempo" como categoría propia, no como un caso de
-- asignatura. Queda pendiente definir cómo le aplican RN03 (tope de 10
-- hrs/semana, hoy escrito para asignatura) y RN04.
-- Va al final y no en orden lógico a propósito: en la base ya existente entró
-- con ALTER TYPE ... ADD VALUE, que lo pone al final, y el orden del enum es el
-- que usa cualquier ORDER BY sobre la columna. Correr este archivo desde cero
-- tiene que producir exactamente la misma base.
CREATE TYPE tipo_contrato_enum AS ENUM ('tiempo_completo', 'asignatura', 'medio_tiempo');

CREATE TYPE modo_materias_enum AS ENUM ('todas', 'personalizada', 'ninguna');

CREATE TYPE rol_enum AS ENUM ('profesor', 'jefe_departamento', 'servicios_escolares', 'nomina', 'admin');

CREATE TYPE tipo_semestre_enum AS ENUM ('primavera', 'verano', 'otono');

CREATE TYPE dia_semana_enum AS ENUM ('lunes', 'martes', 'miercoles', 'jueves', 'viernes');

CREATE TYPE nivel_preferencia_enum AS ENUM ('verde', 'amarillo', 'rojo');

CREATE TYPE estado_grupo_enum AS ENUM ('demanda', 'en_asignacion', 'asignado', 'cancelado');

CREATE TYPE estado_preferencia_enum AS ENUM ('borrador', 'enviado');

-- -----------------------------------------------------------------------------
-- Catálogo académico
-- -----------------------------------------------------------------------------

CREATE TABLE departamento (
    id              serial PRIMARY KEY,
    nombre          text NOT NULL UNIQUE,
    clave_prefijo   varchar(5) NOT NULL UNIQUE
);
COMMENT ON TABLE departamento IS 'Los 3 departamentos de Ciencias Exactas en alcance de V1: Matemáticas, Actuaría, Estadística.';

CREATE TABLE profesor (
    id                      serial PRIMARY KEY,
    cu                      varchar(10) NOT NULL UNIQUE,
    password_hash           text NOT NULL,
    nombre                  text NOT NULL,
    rol                     rol_enum NOT NULL DEFAULT 'profesor',
    departamento_id         int NULL REFERENCES departamento(id),
    tipo_contrato           tipo_contrato_enum NULL,
    modo_materias_elegibles modo_materias_enum NOT NULL DEFAULT 'todas',
    password_predeterminada boolean NOT NULL DEFAULT true,
    estado_especial         text NULL,
    activo                  boolean NOT NULL DEFAULT true,
    CHECK (rol IN ('admin', 'servicios_escolares', 'nomina') OR (departamento_id IS NOT NULL AND tipo_contrato IS NOT NULL))
);
COMMENT ON TABLE profesor IS 'Login unificado 2026-09-21: TODA persona con acceso al sistema es una fila aquí (profesor, Jefe de Departamento, Servicios Escolares, Nómina, admin) — ya no existe una tabla usuario separada. Un Jefe de Departamento sigue siendo profesor (también da clases) y su rol solo desbloquea pestañas/vistas adicionales en el frontend, no una cuenta distinta. Un admin/Servicios Escolares/Nómina que no da clases también recibe una fila aquí (con departamento_id/tipo_contrato en NULL) para que TODOS inicien sesión con el mismo mecanismo (cu + password).';
COMMENT ON COLUMN profesor.cu IS 'Clave Única — identificador de login para cualquier rol. Evita duplicados por fuzzy-match de nombre. También es la contraseña inicial (decisión 2026-09-21: cambiarla es opcional, no un requisito).';
COMMENT ON COLUMN profesor.rol IS 'profesor = rol base (default), sin pestañas adicionales. jefe_departamento/servicios_escolares/nomina/admin ven más vistas en el frontend según este valor — se firma como claim directo en el JWT de login (más barato que consultarlo en cada política RLS), ver rls-policies.sql.';
COMMENT ON COLUMN profesor.departamento_id IS 'NULL solo permitido para rol admin/servicios_escolares/nomina (ver CHECK) — cualquiera que dé clases (profesor o jefe_departamento) pertenece a un departamento.';
COMMENT ON COLUMN profesor.password_hash IS 'Hash (bcrypt) manejado por la aplicación, no por un proveedor de autenticación externo — decisión explícita 2026-09-21 para no acoplar las credenciales al proveedor de base de datos si el proyecto migra de infraestructura en el futuro. Nunca texto plano. Se inicializa como hash(cu). Ver rls-policies.sql para cómo se autentican las peticiones.';
COMMENT ON COLUMN profesor.password_predeterminada IS 'true = sigue usando la contraseña por defecto (= cu), nunca la cambió. No bloquea nada (cambiarla es opcional, no un requisito), solo permite que la vista de admin/Jefe de Departamento identifique quién no la ha cambiado.';
COMMENT ON COLUMN profesor.modo_materias_elegibles IS 'todas = ve el catálogo completo de su depto; personalizada = ver profesor_materia_elegible; ninguna = no puede elegir materias este semestre. Solo aplica a quien realmente da clases.';
COMMENT ON COLUMN profesor.estado_especial IS 'Sabático/licencia/jubilación — motivo por el que no se le debe asignar carga este semestre, aunque siga siendo parte del departamento. NULL = sin novedad. Se separa de `activo` a propósito: `activo` es si la cuenta sirve para entrar al sistema, esto es la situación laboral. Agregada 2026-09-24 al cargar el concentrado real de un departamento, donde 5 de 45 traían este dato.';

CREATE TABLE plan_estudio (
    id      serial PRIMARY KEY,
    nombre  text NOT NULL,
    activo  boolean NOT NULL DEFAULT true
);
COMMENT ON TABLE plan_estudio IS 'Puede ser un plan conjunto entre varios departamentos (ver plan_estudio_departamento), ej. MCD/MR.';

CREATE TABLE plan_estudio_departamento (
    plan_estudio_id int NOT NULL REFERENCES plan_estudio(id) ON DELETE CASCADE,
    departamento_id int NOT NULL REFERENCES departamento(id),
    PRIMARY KEY (plan_estudio_id, departamento_id)
);

CREATE TABLE materia (
    id                      serial PRIMARY KEY,
    clave                   varchar(20) NOT NULL UNIQUE,
    nombre                  text NOT NULL,
    creditos                int NOT NULL CHECK (creditos > 0),
    departamento_id         int NOT NULL REFERENCES departamento(id),
    anual                   boolean NOT NULL DEFAULT false,
    tipo_salon_requerido    text NULL,
    activa                  boolean NOT NULL DEFAULT true
);
COMMENT ON COLUMN materia.clave IS 'Patrón real {prefijo}-##### confirmado en reportes de Servicios Escolares, ej. MAT-12200, ACT-11300, EST-10101.';
COMMENT ON COLUMN materia.departamento_id IS 'Una materia pertenece a exactamente un departamento; es plan_estudio_materia el que cruza departamentos.';
COMMENT ON COLUMN materia.tipo_salon_requerido IS 'NULL = cualquier salón sirve. Si se especifica (ej. ''Sala de cómputo''), debe igualar salon.tipo al asignar imparte_horario.salon_id — confirmado con datos reales: Cálculo Numérico, Análisis Numérico, Optimización Numérica y Matemática Computacional siempre se dan en RHCC302.';

CREATE TABLE profesor_materia_elegible (
    profesor_id int NOT NULL REFERENCES profesor(id) ON DELETE CASCADE,
    materia_id  int NOT NULL REFERENCES materia(id) ON DELETE CASCADE,
    PRIMARY KEY (profesor_id, materia_id)
);
COMMENT ON TABLE profesor_materia_elegible IS 'Solo se consulta cuando profesor.modo_materias_elegibles = personalizada.';

CREATE TABLE plan_estudio_materia (
    id              serial PRIMARY KEY,
    plan_estudio_id int NOT NULL REFERENCES plan_estudio(id) ON DELETE CASCADE,
    materia_id      int NOT NULL REFERENCES materia(id),
    semestre_plan   int NOT NULL,
    UNIQUE (plan_estudio_id, materia_id)
);
COMMENT ON COLUMN plan_estudio_materia.semestre_plan IS 'Número de semestre dentro del plan (1..N) — no confundir con la tabla semestre (calendario).';

CREATE TABLE materia_prerequisito (
    materia_id      int NOT NULL REFERENCES materia(id),
    prerequisito_id int NOT NULL REFERENCES materia(id),
    plan_estudio_id int NULL REFERENCES plan_estudio(id),
    PRIMARY KEY (materia_id, prerequisito_id, plan_estudio_id),
    CHECK (materia_id <> prerequisito_id)
);
COMMENT ON TABLE materia_prerequisito IS 'Seriación; plan_estudio_id NULL = aplica en todos los planes.';

CREATE TABLE materia_co_oferta (
    materia_id      int NOT NULL REFERENCES materia(id),
    co_ofertada_id  int NOT NULL REFERENCES materia(id),
    PRIMARY KEY (materia_id, co_ofertada_id),
    CHECK (materia_id <> co_ofertada_id)
);
COMMENT ON TABLE materia_co_oferta IS 'Catálogo: qué claves de materia SON la misma clase con otro nombre/clave (confirmado con reportes reales de Servicios Escolares). No es lo mismo que materia_equivalencia.';

CREATE TABLE materia_equivalencia (
    materia_origen_id  int NOT NULL REFERENCES materia(id),
    materia_destino_id int NOT NULL REFERENCES materia(id),
    plan_estudio_id    int NULL REFERENCES plan_estudio(id),
    PRIMARY KEY (materia_origen_id, materia_destino_id, plan_estudio_id),
    CHECK (materia_origen_id <> materia_destino_id)
);
COMMENT ON TABLE materia_equivalencia IS 'Revalidación entre planes de estudio, sin relación con el semestre. Coincide con equivalenciasTodas.xlsx de DACC/MATERIAS.';

-- -----------------------------------------------------------------------------
-- Semestre y demanda
-- -----------------------------------------------------------------------------

CREATE TABLE semestre (
    id      serial PRIMARY KEY,
    tipo    tipo_semestre_enum NOT NULL,
    anio    int NOT NULL,
    etiqueta text GENERATED ALWAYS AS (
        (CASE tipo
            WHEN 'primavera' THEN 'primavera'
            WHEN 'verano'    THEN 'verano'
            WHEN 'otono'     THEN 'otono'
        END) || '-' || anio::text
    ) STORED,
    UNIQUE (tipo, anio)
);
COMMENT ON COLUMN semestre.etiqueta IS 'CASE en vez de tipo::text: el cast de enum a text no es IMMUTABLE en Postgres, y una columna GENERATED STORED lo exige.';

CREATE TABLE departamento_semestre_config (
    departamento_id             int NOT NULL REFERENCES departamento(id),
    semestre_id                 int NOT NULL REFERENCES semestre(id),
    mostrar_seleccion_materias  boolean NOT NULL DEFAULT true,
    horas_minimas_verde         numeric(5,2) NOT NULL DEFAULT 10,
    PRIMARY KEY (departamento_id, semestre_id)
);
COMMENT ON TABLE departamento_semestre_config IS 'Configuración por departamento y semestre, editable por admin/Jefe de Departamento. No existía como tabla hasta 2026-09-21.';
COMMENT ON COLUMN departamento_semestre_config.mostrar_seleccion_materias IS 'false = el cuestionario de ese departamento ese semestre NO muestra selección de materias en absoluto — el profesor solo declara disponibilidad de horario (preferencia_materia queda vacío, disponibilidad se sigue capturando igual).';
COMMENT ON COLUMN departamento_semestre_config.horas_minimas_verde IS 'Resuelve D18 de GUIA-DECISIONES.md con un valor por defecto (10), configurable por Jefe de Departamento — no hay un valor único institucional, cada departamento puede ajustarlo.';

CREATE TYPE seccion_cuestionario_enum AS ENUM ('cobertura_departamental', 'catalogo_general', 'oculta');

CREATE TABLE materia_cuestionario (
    materia_id   int NOT NULL REFERENCES materia(id) ON DELETE CASCADE,
    semestre_id  int NOT NULL REFERENCES semestre(id) ON DELETE CASCADE,
    seccion      seccion_cuestionario_enum NOT NULL DEFAULT 'catalogo_general',
    alias_de_id  int NULL REFERENCES materia(id),
    etiqueta     text NULL,
    orden        int NULL,
    revisado     boolean NOT NULL DEFAULT false,
    PRIMARY KEY (materia_id, semestre_id),
    CHECK (alias_de_id IS NULL OR alias_de_id <> materia_id),
    CHECK (alias_de_id IS NULL OR seccion = 'oculta')
);
CREATE INDEX idx_materia_cuestionario_semestre ON materia_cuestionario (semestre_id);

COMMENT ON TABLE materia_cuestionario IS 'Qué materias aparecen en el cuestionario de preferencias ese semestre y en qué sección. Mismo grano que estimacion_demanda pero independiente de ella a propósito (2026-09-24): el catálogo del cuestionario lo decide el Jefe de Departamento, no la existencia de una estimación de demanda de Servicios Escolares. Antes de esta tabla el formulario filtraba por estimacion_demanda y, con esa tabla vacía, ningún profesor veía ninguna materia.';
COMMENT ON COLUMN materia_cuestionario.seccion IS 'cobertura_departamental = el bloque de arriba del cuestionario (mínimo 2 en verde, solo lo ven tiempo completo y medio tiempo); catalogo_general = el resto (mínimo 5 en verde); oculta = no aparece. Una materia SIN fila en esta tabla se trata como catalogo_general (fail-open, igual que la ausencia de departamento_semestre_config): es preferible que sobre una materia a que el profesor se quede sin catálogo.';
COMMENT ON COLUMN materia_cuestionario.alias_de_id IS 'Esta materia es el nombre viejo de alias_de_id y se muestra como "(antes ...)" en la fila de aquella, en vez de como una fila propia. Se cura a mano: NO se deriva de materia_co_oferta, que significa otra cosa (misma clase impartida en el mismo horario, no materia renombrada) y cuya componente conexa mayor, con datos reales, tuvo 13 materias incluidas las 5 de cobertura departamental — derivarlo de ahí las fusionaría todas y borraría la sección.';
COMMENT ON COLUMN materia_cuestionario.etiqueta IS 'Nombre a mostrar cuando materia.nombre no sirve tal cual: typos del reporte oficial de Servicios Escolares, o falta la aclaración de carrera. NULL = usar materia.nombre. El sufijo "(antes X)" NO se escribe aquí, se calcula de alias_de_id. materia.nombre no se corrige a propósito: debe seguir cotejando contra el reporte original.';
COMMENT ON COLUMN materia_cuestionario.revisado IS 'false = la fila la puso un seed automático y el Jefe de Departamento todavía no la confirma. La vista de configuración las ordena primero para que las resuelva. Copiar la config de un semestre a otro lo resetea a false: copiar no es confirmar.';

CREATE TABLE estimacion_demanda (
    id                      serial PRIMARY KEY,
    materia_id              int NOT NULL REFERENCES materia(id),
    semestre_id             int NOT NULL REFERENCES semestre(id),
    alumnos_total           int NOT NULL,
    nuevo_ingreso           int NOT NULL DEFAULT 0,
    pct_baja                numeric(5,2) NULL,
    pct_reprobacion         numeric(5,2) NULL,
    con_prerrequisito       int NOT NULL DEFAULT 0,
    demanda_ajustada        numeric(8,2) NULL,
    capacidad_planeacion    int NULL,
    grupos_periodo_anterior int NOT NULL DEFAULT 0,
    grupos_sugeridos        int NOT NULL,
    mostrar_en_cuestionario boolean NOT NULL DEFAULT true,
    UNIQUE (materia_id, semestre_id)
);
COMMENT ON TABLE estimacion_demanda IS 'Estructura tomada directamente de los reportes reales de estimación de demanda (Mat/Act/Est 202603.pdf) — mismas 15 columnas en los 3 departamentos. grupos_sugeridos dispara cuántas filas de grupo crear (RF13). grupos_sugeridos = 0 es un valor válido y se conserva (materia con demanda pero sin grupo sugerido este semestre) — la UI de admin/Jefe debe distinguirlo visualmente, no ocultarlo.';
COMMENT ON COLUMN estimacion_demanda.demanda_ajustada IS 'Columna "Suma" del reporte real — demanda ya ajustada por Servicios Escolares (no es simplemente alumnos_total, incluye su propio cálculo con baja/reprobación/prerrequisito). Se guarda tal cual se reporta, no se intenta recalcular.';
COMMENT ON COLUMN estimacion_demanda.capacidad_planeacion IS 'Columna "Cap." del reporte real — cupo de referencia que usa Servicios Escolares para estimar grupos_sugeridos ≈ ceil(demanda_ajustada / capacidad_planeacion). Constante en los 3 reportes revisados (30), pero se guarda por semestre en vez de fijarla, por si cambia.';
COMMENT ON COLUMN estimacion_demanda.mostrar_en_cuestionario IS 'Visibilidad GLOBAL por semestre, activable por admin/Jefe de Departamento (independiente de profesor_materia_elegible, que es la personalización POR profesor) — ej. para ocultar una materia sin demanda real este semestre sin borrar su fila de estimacion_demanda.';

-- -----------------------------------------------------------------------------
-- Horario y espacio
-- -----------------------------------------------------------------------------

CREATE TABLE franja_horaria (
    id          serial PRIMARY KEY,
    hora_inicio time NOT NULL UNIQUE,
    hora_fin    time NOT NULL,
    orden       int NOT NULL
);
COMMENT ON TABLE franja_horaria IS 'Catálogo fijo, 07:00-14:00 y 16:00-20:00 en bloques de 30 min (22 franjas). Nunca se inserta una franja entre 14:00-16:00 (RN05, comida) ni después de las 20:00 (decisión confirmada 2026-09-09).';

CREATE TABLE salon (
    id          serial PRIMARY KEY,
    nombre      text NOT NULL,
    edificio    text NULL,
    capacidad   int NOT NULL CHECK (capacidad > 0),
    tipo        text NULL,
    activo      boolean NOT NULL DEFAULT true
);

CREATE TABLE salon_disponibilidad_departamento (
    salon_id        int NOT NULL REFERENCES salon(id),
    departamento_id int NOT NULL REFERENCES departamento(id),
    semestre_id     int NOT NULL REFERENCES semestre(id),
    dia             dia_semana_enum NOT NULL,
    franja_id       int NOT NULL REFERENCES franja_horaria(id),
    PRIMARY KEY (salon_id, departamento_id, semestre_id, dia, franja_id)
);
COMMENT ON TABLE salon_disponibilidad_departamento IS 'Qué salón/día/franja autoriza Servicios Escolares a cada departamento (act salones 202601.pdf). En V1 se siembra permisivo: los 3 departamentos comparten todo el pool (ver seed.sql).';

-- -----------------------------------------------------------------------------
-- Malla y asignación: Grupo (borrador) -> Imparte (confirmado)
-- -----------------------------------------------------------------------------

CREATE TABLE grupo (
    id              serial PRIMARY KEY,
    crn             int NOT NULL,
    materia_id      int NOT NULL REFERENCES materia(id),
    semestre_id     int NOT NULL REFERENCES semestre(id),
    numero          varchar(3) NOT NULL,
    cupo_maximo     int NULL,
    estado          estado_grupo_enum NOT NULL DEFAULT 'demanda',
    publicado       boolean NOT NULL DEFAULT false,
    continua_de_id  int NULL REFERENCES grupo(id),
    UNIQUE (materia_id, semestre_id, numero),
    UNIQUE (semestre_id, crn)
);
COMMENT ON TABLE grupo IS 'Estado de trabajo/borrador de la malla: se crea desde estimacion_demanda, antes de asignar profesor/salón/horario (REQUERIMIENTOS.md §3.4).';
COMMENT ON COLUMN grupo.publicado IS 'RN09: una vez publicado, no debería cambiarse el salón salvo que lo pida Dirección Escolar.';
COMMENT ON COLUMN grupo.continua_de_id IS 'Solo para materia.anual = true: enlaza este grupo con el grupo del semestre anterior del que es continuación. Son dos grupos independientes (cada uno con su propio semestre_id, imparte, etc.) unidos solo para mostrarlos/reportarlos juntos — no un grupo que abarca dos semestres.';

CREATE TABLE imparte (
    id          serial PRIMARY KEY,
    grupo_id    int NOT NULL UNIQUE REFERENCES grupo(id),
    overrides   jsonb NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE imparte IS 'La asignación ya confirmada de un grupo (1:1). Tabla histórica: solo se inserta cuando el grupo se confirma (REQUERIMIENTOS.md §3.4).';
COMMENT ON COLUMN imparte.overrides IS 'Excepciones puntuales a nivel instancia (nombre/créditos/etc.), análogo a CourseInstance.overrides de Mat·Scheduler.';

CREATE TABLE imparte_profesor (
    imparte_id  int NOT NULL REFERENCES imparte(id) ON DELETE CASCADE,
    profesor_id int NOT NULL REFERENCES profesor(id),
    PRIMARY KEY (imparte_id, profesor_id)
);
COMMENT ON TABLE imparte_profesor IS 'N:M — co-titularidad confirmada con datos reales (ej. CRN 2425 con dos profesores).';

CREATE TABLE imparte_co_oferta (
    imparte_id              int NOT NULL REFERENCES imparte(id),
    imparte_relacionado_id  int NOT NULL REFERENCES imparte(id),
    porcentaje_responsabilidad numeric(5,2) NOT NULL,
    PRIMARY KEY (imparte_id, imparte_relacionado_id),
    CHECK (imparte_id <> imparte_relacionado_id)
);
COMMENT ON TABLE imparte_co_oferta IS 'Instancia concreta de co-oferta (mismo profesor/horario/salón, materias con clave distinta que son la misma clase) con el % de responsabilidad real por clave, ej. CRN 2312 100% / CRN 2348 0%.';

CREATE TABLE imparte_horario (
    id          serial PRIMARY KEY,
    imparte_id  int NOT NULL REFERENCES imparte(id) ON DELETE CASCADE,
    dia         dia_semana_enum NOT NULL,
    franja_id   int NOT NULL REFERENCES franja_horaria(id),
    salon_id    int NOT NULL REFERENCES salon(id),
    UNIQUE (imparte_id, dia, franja_id)
);
COMMENT ON TABLE imparte_horario IS 'Bloques de 30 min de un imparte, cada uno con su propio salón (confirmado: un grupo puede reunirse en salones distintos según el día). Sin columnas denormalizadas: ver triggers.sql para no-doble-booking.';

-- -----------------------------------------------------------------------------
-- Preferencias de profesores
-- -----------------------------------------------------------------------------

CREATE TABLE preferencia (
    id                      serial PRIMARY KEY,
    profesor_id             int NOT NULL REFERENCES profesor(id),
    semestre_id             int NOT NULL REFERENCES semestre(id),
    num_cursos_max          int NOT NULL CHECK (num_cursos_max BETWEEN 1 AND 6),
    otro_curso              text NULL,
    horarios_otro_depto     text NULL,
    observaciones_cursos    text NULL,
    observaciones_horarios  text NULL,
    estado                  estado_preferencia_enum NOT NULL DEFAULT 'borrador',
    enviado_at              timestamptz NULL,
    UNIQUE (profesor_id, semestre_id)
);
COMMENT ON COLUMN preferencia.horarios_otro_depto IS 'Solo relevante si profesor.tipo_contrato = asignatura (RN03: tope 10 hrs/semana cruzando departamentos).';

CREATE TABLE preferencia_materia (
    id                      serial PRIMARY KEY,
    preferencia_id          int NOT NULL REFERENCES preferencia(id) ON DELETE CASCADE,
    materia_id              int NOT NULL REFERENCES materia(id),
    nivel                   nivel_preferencia_enum NOT NULL,
    cobertura_departamental boolean NOT NULL DEFAULT false,
    UNIQUE (preferencia_id, materia_id)
);
COMMENT ON TABLE preferencia_materia IS 'Restricción BLANDA: ranking de materias deseadas por el profesor.';
COMMENT ON COLUMN preferencia_materia.cobertura_departamental IS 'Marca el subgrupo de cálculo con cobertura departamental (umbral mínimo de verdes para Tiempo Completo: 2 en este subgrupo + 5 en el resto).';

CREATE TABLE disponibilidad (
    id              serial PRIMARY KEY,
    preferencia_id  int NOT NULL REFERENCES preferencia(id) ON DELETE CASCADE,
    dia             dia_semana_enum NOT NULL,
    franja_id       int NOT NULL REFERENCES franja_horaria(id),
    nivel           nivel_preferencia_enum NOT NULL,
    UNIQUE (preferencia_id, dia, franja_id)
);
COMMENT ON TABLE disponibilidad IS 'Restricción DURA (when2meet: verde/amarillo/rojo), separada estructuralmente de preferencia_materia por recomendación de la literatura UCTP.';
