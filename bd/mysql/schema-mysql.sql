-- =============================================================================
-- Autoplanear — esquema MySQL
-- Traducción de ../schema.sql (PostgreSQL). El razonamiento de cada tabla y
-- cada columna vive en ../diseno-bd.md; aquí los COMMENT son cortos porque
-- MySQL tope a 1024 caracteres por columna y 2048 por tabla, y varios
-- comentarios del original los pasan. El original NO se recorta.
--
-- Servidor confirmado 2026-09-25: MariaDB 5.5.68 (`SELECT VERSION()`).
-- Es de 2020 y no tiene varias cosas que sí tienen MySQL 5.7/8: eso decide tres
-- columnas de este archivo, cada una anotada donde aparece.
--
-- Orden de carga (ver README.md de esta carpeta):
--   schema-mysql.sql
--   checks-como-triggers.sql     <- OBLIGATORIO en 5.5, ver abajo
--   triggers-mysql.sql
--   [seed-mysql.sql]             <- NO al migrar desde Supabase, ver README.md
--
-- ADVERTENCIA sobre los CHECK: MariaDB 5.5 los PARSEA y los IGNORA en silencio
-- — no da error ni warning, simplemente nunca rechazan nada (el CHECK real
-- llegó en MariaDB 10.2). Se dejan escritos porque documentan la intención y
-- porque el día que este esquema corra en algo más nuevo empiezan a funcionar
-- solos, pero HOY no protegen nada: lo que protege es
-- checks-como-triggers.sql, más la validación en PHP de cada endpoint.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- El default de la BASE, no solo el de las tablas. Cada tabla de aqui declara
-- utf8mb4 explicito, asi que los datos estarian bien de todas formas; esto es
-- para lo que se cree DESPUES. Una tabla o una rutina creada mas adelante sin
-- especificar charset hereda el default de la base, y si ese default es latin1
-- (como venia la base del ITAM) el problema aparece mucho despues, como acentos
-- rotos en una pantalla nueva. Los parametros VARCHAR de un PROCEDURE tambien
-- lo heredan.
-- Sin nombre de base: aplica a la que este seleccionada.
ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Catálogo académico
-- -----------------------------------------------------------------------------

CREATE TABLE departamento (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    -- VARCHAR(191) y no TEXT porque lleva UNIQUE: InnoDB antiguo tope el
    -- índice a 767 bytes, que con utf8mb4 son 191 caracteres.
    nombre        VARCHAR(191) NOT NULL UNIQUE,
    clave_prefijo VARCHAR(5)   NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Los 3 departamentos de Ciencias Exactas en alcance de V1.';

CREATE TABLE profesor (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    cu                      VARCHAR(10)  NOT NULL UNIQUE
                            COMMENT 'Clave Unica: identificador de login para cualquier rol. Tambien es la password inicial.',
    password_hash           VARCHAR(255) NOT NULL
                            COMMENT 'bcrypt, manejado por la app. NUNCA se selecciona fuera de login.php / cambiar-password.php.',
    nombre                  VARCHAR(255) NOT NULL,
    correo                  VARCHAR(255) NULL
                            COMMENT 'Opcional (2026-10-02). Lo captura la persona en Mi perfil o al darse de alta. En minusculas.',
    -- jefe_division se agrego 2026-09-25: la division academica (DACE) esta
    -- arriba de los departamentos, asi que su alcance son los 3 (Matematicas,
    -- Actuaria, Estadistica). Es un rol academico y NO es lo mismo que admin,
    -- que queda para quien administre el sistema. Quien dirige la division
    -- tambien da clases, asi que conserva departamento_id y tipo_contrato.
    rol                     ENUM('profesor','jefe_departamento','jefe_division','servicios_escolares','nomina','admin')
                            NOT NULL DEFAULT 'profesor'
                            COMMENT 'Se firma como claim del JWT en el login. Ver diseno-bd.md 4.1.',
    departamento_id         INT NULL
                            COMMENT 'NULL solo para admin/servicios_escolares/nomina (ver chk_profesor_depto).',
    tipo_contrato           ENUM('tiempo_completo','asignatura','medio_tiempo') NULL,
    -- modo_materias_elegibles se elimino el 2026-09-28: todos los profesores
    -- de un departamento ven el mismo formulario. Ver bloqueo_profesor_materia.
    password_predeterminada TINYINT(1) NOT NULL DEFAULT 1
                            COMMENT '1 = sigue usando la password por defecto (= cu). No bloquea nada.',
    estado_especial         VARCHAR(255) NULL
                            COMMENT 'Sabatico/licencia/jubilacion. Distinto de activo, que es si la cuenta sirve para entrar.',
    activo                  TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT fk_profesor_departamento FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT chk_profesor_depto CHECK (
        rol IN ('admin','servicios_escolares','nomina')
        OR (departamento_id IS NOT NULL AND tipo_contrato IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Login unificado: TODA persona con acceso es una fila aqui. Ver diseno-bd.md 4.1.';

CREATE TABLE plan_estudio (
    id     INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    activo TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Puede ser un plan conjunto entre departamentos (ver plan_estudio_departamento).';

CREATE TABLE plan_estudio_departamento (
    plan_estudio_id INT NOT NULL,
    departamento_id INT NOT NULL,
    PRIMARY KEY (plan_estudio_id, departamento_id),
    KEY idx_ped_depto (departamento_id),
    CONSTRAINT fk_ped_plan  FOREIGN KEY (plan_estudio_id) REFERENCES plan_estudio(id) ON DELETE CASCADE,
    CONSTRAINT fk_ped_depto FOREIGN KEY (departamento_id) REFERENCES departamento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE materia (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    clave                VARCHAR(20)  NOT NULL UNIQUE
                         COMMENT 'Patron real {prefijo}-#####, ej. MAT-12200.',
    nombre               VARCHAR(255) NOT NULL,
    creditos             INT NOT NULL,
    departamento_id      INT NOT NULL
                         COMMENT 'Una materia pertenece a exactamente un depto; plan_estudio_materia es lo que cruza.',
    anual                TINYINT(1) NOT NULL DEFAULT 0,
    tipo_salon_requerido VARCHAR(255) NULL
                         COMMENT 'NULL = cualquier salon. Si se especifica debe igualar salon.tipo.',
    activa               TINYINT(1) NOT NULL DEFAULT 1,
    KEY idx_materia_depto (departamento_id),
    CONSTRAINT fk_materia_departamento FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT chk_materia_creditos CHECK (creditos > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- profesor_materia_elegible (lista personalizada de materias por profesor) se
-- elimino el 2026-09-28. Ver migracion-2026-09-28-limpieza.sql.

CREATE TABLE plan_estudio_materia (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    plan_estudio_id INT NOT NULL,
    materia_id      INT NOT NULL,
    semestre_plan   INT NOT NULL COMMENT 'Numero de semestre DENTRO del plan (1..N), no la tabla semestre.',
    UNIQUE KEY uq_pem (plan_estudio_id, materia_id),
    KEY idx_pem_materia (materia_id),
    CONSTRAINT fk_pem_plan    FOREIGN KEY (plan_estudio_id) REFERENCES plan_estudio(id) ON DELETE CASCADE,
    CONSTRAINT fk_pem_materia FOREIGN KEY (materia_id)      REFERENCES materia(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- id + UNIQUE en vez de PK compuesta: plan_estudio_id tiene que poder ser NULL
-- ("aplica en todos los planes") y una columna de PRIMARY KEY nunca admite
-- NULL, ni en Postgres ni en MySQL — el `int NULL` de ../schema.sql se ignora
-- en silencio y esas filas NUNCA se pudieron guardar. Ver README.md.
-- Salvedad: un indice UNIQUE de MySQL admite varios NULL repetidos, asi que
-- esto protege contra duplicados entre planes concretos pero no contra dos
-- filas "aplica a todos" identicas.
CREATE TABLE materia_prerequisito (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    materia_id      INT NOT NULL,
    prerequisito_id INT NOT NULL,
    plan_estudio_id INT NULL COMMENT 'NULL = aplica en todos los planes.',
    UNIQUE KEY uq_prereq (materia_id, prerequisito_id, plan_estudio_id),
    KEY idx_prereq_prereq (prerequisito_id),
    KEY idx_prereq_plan (plan_estudio_id),
    CONSTRAINT fk_prereq_materia FOREIGN KEY (materia_id)      REFERENCES materia(id),
    CONSTRAINT fk_prereq_prereq  FOREIGN KEY (prerequisito_id) REFERENCES materia(id),
    CONSTRAINT fk_prereq_plan    FOREIGN KEY (plan_estudio_id) REFERENCES plan_estudio(id),
    CONSTRAINT chk_prereq_distinta CHECK (materia_id <> prerequisito_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Seriacion.';

CREATE TABLE materia_co_oferta (
    materia_id     INT NOT NULL,
    co_ofertada_id INT NOT NULL,
    PRIMARY KEY (materia_id, co_ofertada_id),
    KEY idx_coof_co (co_ofertada_id),
    CONSTRAINT fk_coof_materia FOREIGN KEY (materia_id)     REFERENCES materia(id),
    CONSTRAINT fk_coof_co      FOREIGN KEY (co_ofertada_id) REFERENCES materia(id),
    CONSTRAINT chk_coof_distinta CHECK (materia_id <> co_ofertada_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catalogo: que claves SON la misma clase. Se guarda en ambas direcciones. No es materia_equivalencia.';

-- Mismo arreglo que materia_prerequisito: plan_estudio_id nullable no cabia en
-- la PK compuesta del original.
CREATE TABLE materia_equivalencia (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    materia_origen_id  INT NOT NULL,
    materia_destino_id INT NOT NULL,
    plan_estudio_id    INT NULL COMMENT 'NULL = aplica en todos los planes.',
    UNIQUE KEY uq_equiv (materia_origen_id, materia_destino_id, plan_estudio_id),
    KEY idx_equiv_destino (materia_destino_id),
    KEY idx_equiv_plan (plan_estudio_id),
    CONSTRAINT fk_equiv_origen  FOREIGN KEY (materia_origen_id)  REFERENCES materia(id),
    CONSTRAINT fk_equiv_destino FOREIGN KEY (materia_destino_id) REFERENCES materia(id),
    CONSTRAINT fk_equiv_plan    FOREIGN KEY (plan_estudio_id)    REFERENCES plan_estudio(id),
    CONSTRAINT chk_equiv_distinta CHECK (materia_origen_id <> materia_destino_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Revalidacion entre planes de estudio.';

-- -----------------------------------------------------------------------------
-- Semestre y demanda
-- -----------------------------------------------------------------------------

-- CAMBIO POR MariaDB 5.5 (1 de 3): `etiqueta` deja de ser columna.
--
-- En Postgres era GENERATED ALWAYS AS ... STORED. MariaDB 5.5 sí tiene columnas
-- calculadas, pero con otra palabra (PERSISTENT en vez de STORED) y con
-- restricciones sobre qué expresiones acepta; un CONCAT sobre un ENUM está
-- justo en la zona gris. No vale arriesgar el arranque del esquema por una
-- columna derivada de otras dos que ya están aquí: se calcula al leerla, en
-- api/catalogos.php, que es el ÚNICO lugar del sistema que la consulta.
--
-- Efecto secundario bueno: desaparece el problema de importar una columna
-- generada, que el plan tenía que advertir aparte (§9.3, punto 5).
CREATE TABLE semestre (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    tipo     ENUM('primavera','verano','otono') NOT NULL,
    anio     INT NOT NULL,
    -- Desde 2026-09-29: exactamente UN semestre activo (en el que se trabaja);
    -- los cerrados quedan de consulta. Lo garantiza api/semestres.php en una
    -- transaccion, porque MariaDB 5.5 no tiene indices parciales.
    estado      ENUM('activo','cerrado') NOT NULL DEFAULT 'cerrado',
    abierto_at  DATETIME NULL COMMENT 'UTC. Cuando se activo por ultima vez.',
    abierto_por INT NULL,
    cerrado_at  DATETIME NULL COMMENT 'UTC.',
    UNIQUE KEY uq_semestre (tipo, anio),
    CONSTRAINT fk_semestre_abierto_por FOREIGN KEY (abierto_por) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='etiqueta ("otono-2026") se calcula al leer, no se guarda. Ver api/catalogos.php.';

CREATE TABLE departamento_semestre_config (
    departamento_id            INT NOT NULL,
    semestre_id                INT NOT NULL,
    mostrar_seleccion_materias TINYINT(1) NOT NULL DEFAULT 1
                               COMMENT 'OBSOLETA desde 2026-09-28: no tener secciones de materias equivale a 0. No se lee.',
    horas_minimas_verde        DECIMAL(5,2) NOT NULL DEFAULT 10
                               COMMENT 'D18 de GUIA-DECISIONES.md, configurable por Jefe de Departamento.',
    texto_introduccion         TEXT NULL
                               COMMENT 'NULL = texto por defecto (api/lib/catalogo.php).',
    publicado                  TINYINT(1) NOT NULL DEFAULT 0
                               COMMENT '0 = los profesores todavia no ven el formulario.',
    publicado_at               DATETIME NULL COMMENT 'UTC.',
    publicado_por              INT NULL,
    PRIMARY KEY (departamento_id, semestre_id),
    KEY idx_dsc_semestre (semestre_id),
    CONSTRAINT fk_dsc_depto         FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_dsc_semestre      FOREIGN KEY (semestre_id)     REFERENCES semestre(id),
    CONSTRAINT fk_dsc_publicado_por FOREIGN KEY (publicado_por)   REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sin fila = defaults y SIN publicar. Editable por admin/Jefe de Departamento.';

-- El formulario de un depto/semestre es una lista ORDENADA de secciones que la
-- jefatura edita (2026-09-28). Sin filas, el editor siembra la plantilla de
-- secciones_por_defecto() en api/lib/catalogo.php la primera vez que se abre.
CREATE TABLE cuestionario_seccion (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    departamento_id         INT NOT NULL,
    semestre_id             INT NOT NULL,
    tipo                    ENUM('num_cursos','materias','disponibilidad','abierta') NOT NULL
                            COMMENT 'disponibilidad: exactamente una por depto/semestre. num_cursos: a lo mas una, opcional desde 2026-10-02 (se valida en PHP).',
    titulo                  VARCHAR(255) NOT NULL,
    descripcion             TEXT NULL,
    audiencia               ENUM('todos','tiempo_completo_medio','asignatura') NOT NULL DEFAULT 'todos'
                            COMMENT 'Materias de una seccion que el profesor no ve se agregan a su primera seccion de materias visible.',
    minimo_verdes           INT NULL COMMENT 'Solo tipo materias. NULL = sin minimo.',
    cobertura_departamental TINYINT(1) NOT NULL DEFAULT 0
                            COMMENT 'Solo tipo materias. Se copia a preferencia_materia.cobertura_departamental.',
    obligatoria             TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Solo tipo abierta.',
    orden                   INT NOT NULL,
    activa                  TINYINT(1) NOT NULL DEFAULT 1
                            COMMENT '0 = borrada desde el editor. Borrado suave: preferencia_respuesta la referencia.',
    KEY idx_cs_depto_semestre (departamento_id, semestre_id),
    KEY idx_cs_semestre (semestre_id),
    CONSTRAINT fk_cs_depto    FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_cs_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bloques del formulario de un depto/semestre, en orden. Editable por jefatura.';

CREATE TABLE materia_cuestionario (
    materia_id  INT NOT NULL,
    semestre_id INT NOT NULL,
    seccion_id  INT NULL
                COMMENT 'NULL = oculta. Sin fila = primera seccion de materias para todos (fail-open).',
    alias_de_id INT NULL
                COMMENT 'Esta materia es el nombre viejo de alias_de_id. Se cura a mano, NO se deriva de materia_co_oferta.',
    etiqueta    VARCHAR(255) NULL
                COMMENT 'Nombre a mostrar cuando materia.nombre no sirve tal cual. NULL = usar materia.nombre.',
    orden       INT NULL,
    revisado    TINYINT(1) NOT NULL DEFAULT 0
                COMMENT '0 = la puso un seed automatico y el Jefe no la confirma todavia.',
    PRIMARY KEY (materia_id, semestre_id),
    KEY idx_materia_cuestionario_semestre (semestre_id),
    KEY idx_mc_alias (alias_de_id),
    KEY idx_mc_seccion (seccion_id),
    CONSTRAINT fk_mc_materia  FOREIGN KEY (materia_id)  REFERENCES materia(id)  ON DELETE CASCADE,
    CONSTRAINT fk_mc_semestre FOREIGN KEY (semestre_id) REFERENCES semestre(id) ON DELETE CASCADE,
    CONSTRAINT fk_mc_seccion  FOREIGN KEY (seccion_id)  REFERENCES cuestionario_seccion(id),
    CONSTRAINT fk_mc_alias    FOREIGN KEY (alias_de_id) REFERENCES materia(id),
    CONSTRAINT chk_mc_alias_distinto CHECK (alias_de_id IS NULL OR alias_de_id <> materia_id),
    CONSTRAINT chk_mc_alias_oculta   CHECK (alias_de_id IS NULL OR seccion_id IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Que materias aparecen en el cuestionario y en que seccion. Independiente de estimacion_demanda a proposito.';

CREATE TABLE estimacion_demanda (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    materia_id              INT NOT NULL,
    semestre_id             INT NOT NULL,
    alumnos_total           INT NOT NULL,
    nuevo_ingreso           INT NOT NULL DEFAULT 0,
    pct_baja                DECIMAL(5,2) NULL,
    pct_reprobacion         DECIMAL(5,2) NULL,
    con_prerrequisito       DECIMAL(8,2) NOT NULL DEFAULT 0 COMMENT 'Columna "Prerr.". Actuaria la trae con decimales.',
    demanda_ajustada        DECIMAL(8,2) NULL COMMENT 'Columna "Suma" del reporte real. Se guarda tal cual, no se recalcula.',
    capacidad_planeacion    INT NULL COMMENT 'Columna "Cap." del reporte real.',
    grupos_periodo_anterior INT NOT NULL DEFAULT 0,
    grupos_sugeridos        INT NOT NULL COMMENT '0 es valido y se conserva: materia con demanda pero sin grupo sugerido.',
    mostrar_en_cuestionario TINYINT(1) NOT NULL DEFAULT 1
                            COMMENT 'Visibilidad para la vista de demanda. Lo que ve el profesor lo decide materia_cuestionario.',
    UNIQUE KEY uq_estimacion (materia_id, semestre_id),
    KEY idx_ed_semestre (semestre_id),
    CONSTRAINT fk_ed_materia  FOREIGN KEY (materia_id)  REFERENCES materia(id),
    CONSTRAINT fk_ed_semestre FOREIGN KEY (semestre_id) REFERENCES semestre(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estructura tomada de los reportes reales de estimacion de demanda (15 columnas).';

-- -----------------------------------------------------------------------------
-- Horario y espacio
-- -----------------------------------------------------------------------------

CREATE TABLE franja_horaria (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    hora_inicio TIME NOT NULL UNIQUE,
    hora_fin    TIME NOT NULL,
    orden       INT  NOT NULL,
    dias        SET('lunes','martes','miercoles','jueves','viernes') NULL
                COMMENT 'NULL = todos los dias. 2026-10-02: 14:00-14:30 solo martes y jueves.'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catalogo fijo: 07:00-14:00 y 16:00-20:00 en bloques de 30 min, mas 14:00-14:30 solo mar/jue (23 franjas). RN05 + esa excepcion.';

CREATE TABLE salon (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    nombre    VARCHAR(255) NOT NULL,
    edificio  VARCHAR(255) NULL,
    capacidad INT NOT NULL,
    tipo      VARCHAR(255) NULL,
    activo    TINYINT(1) NOT NULL DEFAULT 1,
    CONSTRAINT chk_salon_capacidad CHECK (capacidad > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE salon_disponibilidad_departamento (
    salon_id        INT NOT NULL,
    departamento_id INT NOT NULL,
    semestre_id     INT NOT NULL,
    dia             ENUM('lunes','martes','miercoles','jueves','viernes') NOT NULL,
    franja_id       INT NOT NULL,
    PRIMARY KEY (salon_id, departamento_id, semestre_id, dia, franja_id),
    KEY idx_sdd_depto (departamento_id),
    KEY idx_sdd_semestre (semestre_id),
    KEY idx_sdd_franja (franja_id),
    CONSTRAINT fk_sdd_salon    FOREIGN KEY (salon_id)        REFERENCES salon(id),
    CONSTRAINT fk_sdd_depto    FOREIGN KEY (departamento_id) REFERENCES departamento(id),
    CONSTRAINT fk_sdd_semestre FOREIGN KEY (semestre_id)     REFERENCES semestre(id),
    CONSTRAINT fk_sdd_franja   FOREIGN KEY (franja_id)       REFERENCES franja_horaria(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Que salon/dia/franja autoriza Servicios Escolares a cada depto. En V1 se siembra permisivo.';

-- -----------------------------------------------------------------------------
-- Malla y asignacion: grupo (borrador) -> imparte (confirmado)
-- -----------------------------------------------------------------------------

CREATE TABLE grupo (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    crn            INT NOT NULL,
    materia_id     INT NOT NULL,
    semestre_id    INT NOT NULL,
    numero         VARCHAR(3) NOT NULL,
    cupo_maximo    INT NULL,
    estado         ENUM('demanda','en_asignacion','asignado','cancelado') NOT NULL DEFAULT 'demanda',
    publicado      TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'RN09: publicado no deberia cambiar de salon.',
    continua_de_id INT NULL COMMENT 'Solo para materia.anual: enlaza con el grupo del semestre anterior.',
    UNIQUE KEY uq_grupo_numero (materia_id, semestre_id, numero),
    UNIQUE KEY uq_grupo_crn (semestre_id, crn),
    KEY idx_grupo_continua (continua_de_id),
    CONSTRAINT fk_grupo_materia  FOREIGN KEY (materia_id)     REFERENCES materia(id),
    CONSTRAINT fk_grupo_semestre FOREIGN KEY (semestre_id)    REFERENCES semestre(id),
    CONSTRAINT fk_grupo_continua FOREIGN KEY (continua_de_id) REFERENCES grupo(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estado borrador de la malla: se crea desde estimacion_demanda, antes de asignar profesor/salon/horario.';

-- CAMBIO POR MariaDB 5.5 (2 y 3 de 3), las dos en esta tabla:
--
-- overrides: el tipo JSON no existe en 5.5 (MySQL lo trajo en 5.7; MariaDB, en
--   10.2, y encima como alias de LONGTEXT). Aqui es LONGTEXT directamente. Se
--   pierden los operadores de JSON, que de todas formas ya se perdian al salir
--   de jsonb. La columna esta vacia hoy.
--
-- created_at / updated_at: en 5.5 solo un TIMESTAMP puede llevar
--   CURRENT_TIMESTAMP automatico, y solo UNO por tabla (DATETIME con DEFAULT
--   CURRENT_TIMESTAMP llego en MySQL 5.6 / MariaDB 10.0). Asi que el automatico
--   se le da a updated_at, que es el que se queria arreglar: en Postgres tenia
--   DEFAULT now() pero ningun trigger que lo actualizara, asi que nunca cambiaba
--   despues del INSERT. created_at lo escribe la aplicacion.
--
--   Costo de usar TIMESTAMP: el limite de 2038. Aceptable aqui y en ningun otro
--   lado del esquema: esta tabla no la escribe ningun endpoint todavia (el motor
--   de asignacion no existe) y para entonces el hosting habra cambiado. La
--   conexion fija SET time_zone = '+00:00' (api/lib/db.php), asi que lo que se
--   guarda y se lee es UTC.
CREATE TABLE imparte (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    grupo_id   INT NOT NULL UNIQUE,
    overrides  LONGTEXT NULL COMMENT 'JSON. Excepciones puntuales a nivel instancia (nombre/creditos/etc.).',
    created_at DATETIME NOT NULL COMMENT 'UTC. La escribe la aplicacion al insertar.',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
               COMMENT 'UTC. Automatica.',
    CONSTRAINT fk_imparte_grupo FOREIGN KEY (grupo_id) REFERENCES grupo(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='La asignacion ya confirmada de un grupo (1:1). Tabla historica.';

CREATE TABLE imparte_profesor (
    imparte_id  INT NOT NULL,
    profesor_id INT NOT NULL,
    PRIMARY KEY (imparte_id, profesor_id),
    KEY idx_ip_profesor (profesor_id),
    CONSTRAINT fk_ip_imparte  FOREIGN KEY (imparte_id)  REFERENCES imparte(id) ON DELETE CASCADE,
    CONSTRAINT fk_ip_profesor FOREIGN KEY (profesor_id) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='N:M, co-titularidad (confirmada con datos reales).';

CREATE TABLE imparte_co_oferta (
    imparte_id                 INT NOT NULL,
    imparte_relacionado_id     INT NOT NULL,
    porcentaje_responsabilidad DECIMAL(5,2) NOT NULL,
    PRIMARY KEY (imparte_id, imparte_relacionado_id),
    KEY idx_ico_rel (imparte_relacionado_id),
    CONSTRAINT fk_ico_imparte FOREIGN KEY (imparte_id)             REFERENCES imparte(id),
    CONSTRAINT fk_ico_rel     FOREIGN KEY (imparte_relacionado_id) REFERENCES imparte(id),
    CONSTRAINT chk_ico_distinto CHECK (imparte_id <> imparte_relacionado_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Instancia concreta de co-oferta con el % de responsabilidad real por clave.';

CREATE TABLE imparte_horario (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    imparte_id INT NOT NULL,
    dia        ENUM('lunes','martes','miercoles','jueves','viernes') NOT NULL,
    franja_id  INT NOT NULL,
    salon_id   INT NOT NULL,
    UNIQUE KEY uq_ih (imparte_id, dia, franja_id),
    KEY idx_ih_franja (franja_id),
    KEY idx_ih_salon (salon_id),
    CONSTRAINT fk_ih_imparte FOREIGN KEY (imparte_id) REFERENCES imparte(id) ON DELETE CASCADE,
    CONSTRAINT fk_ih_franja  FOREIGN KEY (franja_id)  REFERENCES franja_horaria(id),
    CONSTRAINT fk_ih_salon   FOREIGN KEY (salon_id)   REFERENCES salon(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bloques de 30 min de un imparte, cada uno con su propio salon. Ver triggers-mysql.sql.';

-- -----------------------------------------------------------------------------
-- Preferencias de profesores
-- -----------------------------------------------------------------------------

CREATE TABLE preferencia (
    id                     INT AUTO_INCREMENT PRIMARY KEY,
    profesor_id            INT NOT NULL,
    semestre_id            INT NOT NULL,
    num_cursos_max         INT NULL
                           COMMENT 'NULL = el formulario no tenia la pregunta (opcional desde 2026-10-02).',
    otro_curso             TEXT NULL,
    horarios_otro_depto    TEXT NULL COMMENT 'OBSOLETA desde 2026-09-28: ahora es una pregunta abierta (preferencia_respuesta).',
    observaciones_cursos   TEXT NULL COMMENT 'OBSOLETA desde 2026-09-28: ahora es una pregunta abierta (preferencia_respuesta).',
    observaciones_horarios TEXT NULL COMMENT 'OBSOLETA desde 2026-09-28: ahora es una pregunta abierta (preferencia_respuesta).',
    estado                 ENUM('borrador','enviado') NOT NULL DEFAULT 'borrador',
    enviado_at             DATETIME NULL COMMENT 'UTC.',
    UNIQUE KEY uq_preferencia (profesor_id, semestre_id),
    KEY idx_pref_semestre (semestre_id),
    CONSTRAINT fk_pref_profesor FOREIGN KEY (profesor_id) REFERENCES profesor(id),
    CONSTRAINT fk_pref_semestre FOREIGN KEY (semestre_id) REFERENCES semestre(id),
    CONSTRAINT chk_pref_cursos CHECK (num_cursos_max BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE preferencia_materia (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    preferencia_id          INT NOT NULL,
    materia_id              INT NOT NULL,
    nivel                   ENUM('verde','amarillo','rojo') NOT NULL,
    cobertura_departamental TINYINT(1) NOT NULL DEFAULT 0
                            COMMENT 'Marca el subgrupo con umbral propio de verdes (2 aqui + 5 en el resto).',
    UNIQUE KEY uq_pref_materia (preferencia_id, materia_id),
    KEY idx_pm_materia (materia_id),
    CONSTRAINT fk_pm_preferencia FOREIGN KEY (preferencia_id) REFERENCES preferencia(id) ON DELETE CASCADE,
    CONSTRAINT fk_pm_materia     FOREIGN KEY (materia_id)     REFERENCES materia(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Restriccion BLANDA: ranking de materias deseadas.';

CREATE TABLE disponibilidad (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    preferencia_id INT NOT NULL,
    dia            ENUM('lunes','martes','miercoles','jueves','viernes') NOT NULL,
    franja_id      INT NOT NULL,
    nivel          ENUM('verde','amarillo','rojo') NOT NULL,
    UNIQUE KEY uq_disponibilidad (preferencia_id, dia, franja_id),
    KEY idx_disp_franja (franja_id),
    CONSTRAINT fk_disp_preferencia FOREIGN KEY (preferencia_id) REFERENCES preferencia(id) ON DELETE CASCADE,
    CONSTRAINT fk_disp_franja      FOREIGN KEY (franja_id)      REFERENCES franja_horaria(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Restriccion DURA (verde/amarillo/rojo), separada de preferencia_materia por recomendacion de la literatura UCTP.';

CREATE TABLE preferencia_respuesta (
    preferencia_id INT NOT NULL,
    seccion_id     INT NOT NULL,
    texto          TEXT NOT NULL,
    PRIMARY KEY (preferencia_id, seccion_id),
    KEY idx_pr_seccion (seccion_id),
    CONSTRAINT fk_pr_preferencia FOREIGN KEY (preferencia_id) REFERENCES preferencia(id) ON DELETE CASCADE,
    CONSTRAINT fk_pr_seccion     FOREIGN KEY (seccion_id)     REFERENCES cuestionario_seccion(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Respuesta a una seccion tipo abierta.';

-- La jefatura bloquea pares profesor-materia antes de correr el motor
-- (2026-09-28). Capa aparte a proposito: la respuesta del profesor se conserva
-- intacta, al desbloquear vuelve a contar, y el profesor nunca ve el bloqueo.
CREATE TABLE bloqueo_profesor_materia (
    profesor_id   INT NOT NULL,
    materia_id    INT NOT NULL,
    semestre_id   INT NOT NULL,
    bloqueado_por INT NOT NULL,
    bloqueado_at  DATETIME NOT NULL COMMENT 'UTC.',
    PRIMARY KEY (profesor_id, materia_id, semestre_id),
    KEY idx_bpm_materia (materia_id),
    KEY idx_bpm_semestre (semestre_id),
    CONSTRAINT fk_bpm_profesor FOREIGN KEY (profesor_id)   REFERENCES profesor(id),
    CONSTRAINT fk_bpm_materia  FOREIGN KEY (materia_id)    REFERENCES materia(id),
    CONSTRAINT fk_bpm_semestre FOREIGN KEY (semestre_id)   REFERENCES semestre(id),
    CONSTRAINT fk_bpm_por      FOREIGN KEY (bloqueado_por) REFERENCES profesor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Restriccion DURA para el motor. Capa aparte: no toca preferencia_materia y el profesor nunca la ve.';

-- -----------------------------------------------------------------------------
-- Infraestructura del API (no existe en el esquema de Postgres)
-- -----------------------------------------------------------------------------

-- Las Edge Functions limitaban intentos con un Map en memoria del proceso. PHP
-- no tiene estado entre peticiones: cada request arranca de cero, asi que ese
-- codigo no se puede portar y el limite se guarda aqui.
CREATE TABLE intento_login (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    llave   VARCHAR(64) NOT NULL
            COMMENT 'cu en login.php, profesor_id en cambiar-password.php. Prefijo para no mezclarlos.',
    momento DATETIME NOT NULL COMMENT 'UTC.',
    KEY idx_intento_llave_momento (llave, momento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Rate limiting del login. Se limpia sola: cada consulta borra lo mas viejo que la ventana.';
