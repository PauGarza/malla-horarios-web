# Diseño de base de datos — Autoplanear

> Documento de diseño de base de datos de **Autoplanear** (sistema de asignación materias–horarios–
> profesores para la División de Ciencias Exactas del ITAM, proyecto de titulación de maestría,
> sucesor de Mat·Scheduler — ver `../V1-Cheque/`). Esta es la copia de trabajo de este documento
> pensada para el equipo — en particular, quien construya el motor de asignación: ver
> [`motor-asignacion.md`](motor-asignacion.md) para esa parte específica antes de leer todo esto.
> Referencias a `REQUERIMIENTOS.md`/`GUIA-DECISIONES.md`/`BITACORA.md` que aparezcan más abajo son a
> documentos de trabajo internos que no viven en este repo — no hacen falta para entender el esquema en
> sí, son solo contexto de por qué se tomó cada decisión.
>
> **Motor real (desde 2026-09-25): MySQL (MariaDB 5.5) en el servidor del ITAM**, no Postgres en la
> nube. Las tablas de §6 conservan la notación de Postgres con la que se diseñaron (`serial`,
> `boolean`, `timestamptz`…) porque el razonamiento sigue siendo el mismo; el DDL que corre de verdad
> es [`mysql/schema-mysql.sql`](mysql/schema-mysql.sql). Lo que cambió con la migración está en §14,
> y los cambios posteriores (correo y recuperación de contraseña, franjas por día y por
> departamento, número de cursos opcional) en §15, y el mínimo de horas en verde calculado por
> cursos (2026-10-13) en §17.

## 1. Contexto y fuentes

Ni Mat·Scheduler ni `DACC/MATERIAS` (los dos proyectos hermanos) usan base de datos real — ambos
viven en JSON/`localStorage`. Necesitar una base de datos real es, en sí mismo, un salto respecto a
todo lo construido hasta ahora en el ecosistema (`Investigacion/investigacion_tecnologias_sistema.md`).
Este diseño se construyó cruzando:

- El modelo de datos del pizarrón y su formalización en `REQUERIMIENTOS.md` §3 (Departamento, Plan de
  Estudio, Materia, Profesor, Grupo, Imparte, Alumno, Salón, Estimación de Demanda).
- El marco académico de UCTP (`Investigacion/investigacion_asignacion_horarios.md`): recomienda
  separar restricciones duras (disponibilidad) de blandas (preferencias) desde el modelo de datos, y
  confirma que el caso de ITAM es CB-CTP (basado en currícula), no PE-CTP (inscripción individual) —
  no hace falta modelar inscripción real de alumnos para construir la malla.
- El cuestionario de profesores (`../docs/mockup/cuestionario-profesores.md` + su mockup) y
  el precedente Mat·Scheduler (`V1-Cheque/` = `CHEQUE/`), que dan el contrato de datos de Profesor,
  Preferencia, Materia y Grupo/Imparte.
- **Documentos reales de Servicios Escolares** (`Info servicios escolares/`), revisados directamente
  para no adivinar el formato de los datos institucionales — ver §2.

## 2. Lo que cambió al revisar documentos reales de Servicios Escolares

Antes de este documento, el modelo se basaba en el pizarrón y en mockups. Al revisar los reportes
reales que sí genera Control Escolar, aparecieron patrones que no estaban documentados en ningún
lado y que sí cambian el esquema:

| Documento real | Qué reveló | Cómo cambió el diseño |
|---|---|---|
| `Mat 202603 (1).pdf` — Estimación de la demanda | Columnas reales: alumnos totales, % de baja/reprobación, alumnos con prerrequisito cubierto, grupos del periodo anterior y **grupos sugeridos** para el nuevo periodo. Es justo lo que dispara la creación de `Grupo`. | Nueva tabla `estimacion_demanda`, con `grupos_sugeridos` como el campo que efectivamente informa cuántas filas de `grupo` crear. |
| `max-min actual.pdf` — Número de alumnos por grupo inscrito | Dos hechos no documentados antes: (1) **un mismo grupo puede tener más de un profesor** (co-titularidad, ej. CRN 2425 con dos profesores); (2) **un mismo grupo puede reunirse en salones distintos según el día** (ej. CRN 2312: viernes en RH105, lunes/miércoles en RHSA3). | `imparte_profesor` como N:M (no un solo FK a profesor); `salon_id` se mueve de `imparte` a `imparte_horario` (por bloque de día, no por grupo completo). |
| `materias equivalentes.pdf` (a pesar del nombre) — en realidad "Profesores con el mismo horario" | Un profesor puede impartir dos materias con clave distinta en la misma sesión (mismo horario/salón), con un **% de responsabilidad** repartido entre ambas (ej. 100% Cálculo Multivariado / 0% Cálculo Dif. e Int. III). Se confirmó que es **la misma clase**, con nombre/clave distinta según el plan de estudio o departamento que la reconoce — no dos contenidos distintos a la vez. | `materia_co_oferta` (catálogo: qué claves SON la misma clase) + `imparte_co_oferta` (instancia concreta con el % de responsabilidad/crédito, porque cada clave puede pertenecer a un plan distinto con sus propios créditos). Esto también resuelve la pregunta abierta #8 de `REQUERIMIENTOS.md` §9: `otherCodes` (Mat·Scheduler) y `equivale` (revalidación entre planes) **son dos relaciones distintas**, confirmado. |
| `act salones 202601.pdf` — Asignación de salones por departamento | Servicios Escolares reparte salones a **cada departamento por día/horario específico** — un salón no está libre para cualquier departamento en cualquier horario. | Nueva tabla `salon_disponibilidad_departamento`. **Decisión de alcance V1**: para esta primera iteración, Matemáticas/Actuaría/Estadística van a **compartir el mismo pool completo de salones/horarios sin restricción entre sí** — el campo se deja en el esquema (así es la realidad institucional y puede necesitarse cuando se sume Servicios Escolares de verdad), pero los datos semilla de V1 no la usan para restringir. |

## 3. Decisiones de diseño (2026-09-09)

- **`Grupo` e `Imparte` quedan como tablas separadas.** Coincide con lo ya confirmado el 2026-08-21 en
  `REQUERIMIENTOS.md` §3.4: `Grupo` es el estado de trabajo/borrador (se crea desde la demanda, ahí se
  va asignando profesor/hora/salón); `Imparte` es la asignación ya concretada de ese grupo (1:1).
- **Alumno/inscripción se difiere fuera de V1.** `REQUERIMIENTOS.md` ya dejaba a `Alumno` sin
  atributos propios y su relación con `Imparte` como conceptual (demanda agregada, no inscripción
  individual) — se decidió no crear siquiera esa tabla placeholder en V1, porque no aporta
  nada consultable que `plan_estudio_materia` + `estimacion_demanda` no den ya. Se puede añadir sin
  fricción cuando haga falta.
- **Co-oferta y equivalencia de materias son relaciones separadas** (co-oferta = misma clase con otra
  clave, dentro del mismo semestre; equivalencia = revalidación entre planes de estudio, sin relación
  con el semestre). Resuelve la pregunta abierta #8 de `REQUERIMIENTOS.md` §9.
- **`Imparte` sí necesita un mecanismo de override por instancia** (columna `overrides jsonb`),
  análogo a `CourseInstance.overrides` de Mat·Scheduler. Resuelve la pregunta abierta #9 de
  `REQUERIMIENTOS.md` §9.
- **`profesor` guarda credencial de acceso** (`password_hash`, nunca texto plano). ~~Igual que
  `usuario` para los roles administrativos~~ — **superado 2026-09-21**: no existe una tabla `usuario`
  separada, el login está unificado en `profesor` (ver §4/§4.3).
- **`plan_estudio` puede pertenecer a más de un departamento** (planes conjuntos, ej. MCD/MR
  cruzando Mat/Act/Est) — se modela N:M vía `plan_estudio_departamento`, en vez de la FK simple que
  tenía el primer boceto.
- **Elegibilidad de materias por profesor.** El Jefe de Departamento puede configurar, por profesor,
  si puede elegir de todo el catálogo de su departamento, de una lista personalizada, o de ninguna
  materia ese semestre (`profesor.modo_materias_elegibles` + `profesor_materia_elegible`).
- **Rol Nómina** (ya mencionado en `REQUERIMIENTOS.md` §4/RF09 pero no en un enum concreto) se agrega
  formalmente a `profesor.rol` (ver §4.3 — no a una tabla `usuario` separada, que se descartó).
- **RN09 (no cambio de salón tras publicar)** se modela como bandera `grupo.publicado` — antes solo
  era una regla de proceso sin representación en el modelo.
- **Franja horaria: tope confirmado a las 20:00.** Los reportes reales de grupos muestran clases hasta
  las 22:00, pero es una restricción de política del departamento (no de disponibilidad de salones)
  que **no se quiere seguir permitiendo** — el catálogo de franjas se queda 07:00–14:00 y 16:00–20:00,
  22 franjas de 30 min, igual que ya tenía el mockup del cuestionario. **Matizado después (§15):**
  desde 2026-10-02 hay una franja 14:00–14:30 solo martes y jueves, y desde 2026-10-06 Estadística
  (y solo Estadística) llega hasta las 22:00 — 27 franjas en total.
- **Normalización explícita**: no se guardan columnas duplicadas (profesor/salón/semestre) solo para
  simplificar una restricción — las reglas de no-doble-booking se aplican con triggers (ver
  `triggers.sql`), no con columnas denormalizadas.

## 4. Dónde vive la base de datos — RESUELTO 2026-09-21: un proveedor de base de datos en la nube + GitHub Pages

> **Superado el 2026-09-25 (ver §14):** el sistema se mudó al servidor del ITAM
> (`horariosdace.itam.mx`, MariaDB 5.5 + PHP 7.4), con un API propio en PHP entre el navegador y la
> base. Ya no hay RLS ni Edge Functions: las 38 políticas se volvieron autorización explícita en los
> endpoints. Esta sección y sus subsecciones quedan como registro de la decisión anterior.

`Investigacion/investigacion_tecnologias_sistema.md` y `BITACORA.md` (2026-08-07) habían decidido
originalmente RNF04/RNF05: PostgreSQL en una PC propia de la oficina, Linux, con Docker, acceso solo
dentro de la red de ITAM (sin exposición a internet en V1). El 2026-09-09 se detectó que esa decisión
nunca se había cruzado contra la decisión, tomada por separado, de hospedar el proyecto en la nube
(GitHub Pages, un proveedor de base de datos administrado) — quedó anotado como conflicto abierto, sin
resolver.

**Se confirmó (2026-09-21) reemplazar RNF04/RNF05**: V1 usa **un proveedor de
base de datos administrado en la nube** (Postgres) para la base de datos y **GitHub Pages** para el
frontend estático, con el
objetivo concreto de empezar a recolectar respuestas reales de profesores. Motivo: es la opción más
rápida para arrancar la recolección, y el patrón de uso (picos estacionales) calza con un proveedor
administrado mejor que con una PC de oficina que alguien tiene que mantener encendida y respaldada a
mano. `REQUERIMIENTOS.md` §7 se actualiza para reflejar esto.

**Consecuencia de diseño nueva, no resuelta hasta ahora**: con el frontend viviendo en GitHub Pages
(estático, público) hablándole directo a la base de datos desde el navegador de cada profesor, **la seguridad
tiene que vivir en la base de datos** vía Row Level Security (RLS) — no hay backend intermedio que
filtre quién puede leer/escribir qué. Ver `rls-policies.sql` y §4.1.

### 4.1 Control de acceso (RLS) — necesario antes de recolectar datos reales

El mockup actual (`../docs/mockup/mockup-cuestionario.html`) simula login por CU sin ninguna seguridad
real (todo vive en `localStorage`). En una arquitectura con base de datos en la nube + GitHub Pages,
cualquier persona con las claves públicas del proyecto (que **son públicas por diseño** en una app
puramente cliente) podría leer o escribir cualquier fila si no hay políticas RLS activas — no es
opcional para V1, es la única capa de seguridad que existe.

**Decisión 2026-09-21 sobre quién maneja las contraseñas:** se evaluó usar el sistema de
autenticación nativo del proveedor de base de datos para no reinventar login, pero se decidió
que **la aplicación siga manejando sus propias contraseñas** (`profesor.password_hash`), para no
acoplar las credenciales al proveedor de cara a una posible migración de infraestructura a futuro — si
el proyecto se muda de proveedor, los usuarios y sus contraseñas se mudan con la base de datos, no se
quedan atrapados en un sistema de auth propietario.

**Decisión 2026-09-21 sobre login de Jefe de Departamento/admin: unificado con `profesor`, no una
tabla `usuario` aparte.** Un Jefe de Departamento también da clases, así que ya es una fila de
`profesor` — inicia sesión con el mismo `cu`+password que cualquier profesor, y lo único que cambia es
`profesor.rol` (nuevo, ver entidad `profesor` en §6), que desbloquea políticas/vistas adicionales. Un
admin/Servicios Escolares/Nómina que no dé clases también recibe una fila en `profesor` (con
`departamento_id`/`tipo_contrato` en NULL, permitido por el CHECK de la tabla) para que **todos** los
roles inicien sesión con el mismo mecanismo.

Esto tiene una consecuencia real: RLS normalmente identifica al usuario que hace la petición
vía `auth.uid()`, que **solo existe si el login pasó por el sistema de autenticación nativo del proveedor**. Con contraseñas propias, hay
que replicar ese mecanismo a mano:

1. Una **Edge Function de login** (código propio, corre en la infraestructura del proveedor pero es
   portable) recibe `cu` + password, valida el hash, y si es válido firma un JWT propio con el secreto
   del proyecto (incluye `"role": "authenticated"` + los claims `profesor_id` y `rol`).
2. El frontend usa ese JWT en cada llamada a la base de datos.
3. Las políticas de `rls-policies.sql` leen esos claims (`app_profesor_id()`/`app_rol()`) en vez de
   `auth.uid()`.

Principios aplicados en `rls-policies.sql`:
- **RLS activado en todas las tablas** que contienen datos capturados por profesores (`preferencia`,
  `preferencia_materia`, `disponibilidad`) — nadie puede leer/escribir sin una política explícita.
- **Cada profesor solo puede leer y escribir su propia fila**, comparando el claim `profesor_id` del
  JWT propio contra `profesor_id`/`profesor.id` directamente (no hace falta una columna de enlace
  adicional, a diferencia del enfoque con el sistema de autenticación nativo del proveedor).
- **Catálogos son de solo lectura** para cualquier sesión autenticada (JWT propio válido), salvo
  `materia`/`estimacion_demanda`/`departamento_semestre_config`, que Jefe de Departamento (de su
  propio departamento) y admin (de cualquiera) sí pueden editar — ver §10.3.
- **`grupo`/`imparte`/`imparte_horario` siguen sin política de escritura para nadie autenticado** —
  eso es el motor de asignación en sí (RF06), que no existe todavía más allá del acceso de lectura ya
  resuelto (ver `motor-asignacion.md` en la copia pública del repo del equipo).

**⚠️ Riesgo descubierto 2026-09-21, al crear el proyecto real:** el mecanismo del paso 1 (firmar un JWT
propio con "el secreto del proyecto") depende de que el proveedor siga aceptando verificación HS256 con
un secreto compartido. Los proyectos nuevos ya usan llaves de firma asimétricas (ECC P-256) como llave
"current" por defecto; el secreto HS256 compartido que necesitamos ahora vive marcado como "legacy",
señalado por el proveedor como algo que empujan a dejar de usar. Mientras esa llave no se revoque
manualmente, el diseño sigue funcionando — pero es una dependencia frágil de un mecanismo ya etiquetado
como legacy, no algo estable a largo plazo. **Regla operativa: nunca revocar la llave JWT legacy del
proyecto** hasta que este mecanismo se rediseñe. Pendiente evaluar a futuro: mover a un enfoque que no
dependa de un secreto legacy (ej. verificar el JWT propio dentro de cada función/RPC en vez de depender
de que la capa de API lo valide automáticamente).

### 4.2 Checklist antes de crear la estructura del proyecto

Checklist de lo que sigue pendiente de resolver sobre el diseño de la base de datos antes
de aprovisionar el proyecto real, para no descubrirlo a medio camino.

**Bloquea empezar a recolectar preferencias (hay que resolverlo antes o durante el setup):**
- [ ] **Construir la Edge Function de login** descrita en §4.1 — hoy no existe ningún código que
  verifique `password_hash` ni firme el JWT propio; sin esto, `rls-policies.sql` no tiene con qué
  identificar al profesor que hace la petición.
- [ ] **Decidir el algoritmo de hash** (bcrypt/argon2) y quién genera el `password_hash` inicial del
  roster — ¿contraseña temporal generada y comunicada por correo? ¿el profesor la crea en su primer
  ingreso? No está decidido en ningún documento todavía.
- [x] ~~Exponer el perfil de `profesor` sin `password_hash`~~ — **resuelto en §4.3**: privilegios a
  nivel de columna (`REVOKE ALL` + `GRANT SELECT (...)` sin `password_hash`) en `rls-policies.sql`, no
  hacía falta una vista/RPC aparte.
- [ ] **Construir el frontend real** que reemplace `mockup-cuestionario.html` — hoy no llama a ningún
  backend, todo vive en `localStorage`.
- [ ] **Cargar el roster real de profesores** (`cu`, nombre, departamento, tipo de contrato) — el
  mockup solo tiene una cuenta de prueba hardcodeada.
- [ ] **Cargar el catálogo real de materias por departamento** — no existe todavía en ningún archivo
  de este proyecto listo para insertar (los 37-38 nombres del mockup son de referencia, no una fuente
  de verdad confirmada).

**No bloquea la recolección de preferencias, pero sigue abierto (`GUIA-DECISIONES.md`):**
- ~~D18 — horas mínimas en verde por semana según tipo de contrato (pendiente de la junta de Jefes de
  Departamento).~~ Resuelta: primero 10 h fijas configurables (2026-09-21); desde 2026-10-13, un
  mínimo calculado con los cursos de cada profesor y un ratio de la jefatura (D40, §17).
- Mecanismo de cuentas: ¿reutilizar alguna credencial institucional de ITAM en vez de una nueva, ahora
  que sí se va a manejar contraseña propia? Vale la pena reconfirmarlo dado que cambió la decisión de
  auth — antes se asumía que esto quedaría resuelto por el sistema de autenticación nativo del proveedor.
- ~~Rol Jefe de Departamento en el JWT propio: falta decidir si el claim de rol se firma directo en el
  token... o se consulta `usuario.rol` en cada política~~ — **resuelto en §4.3**: se firma directo,
  y ya no existe una tabla `usuario` separada que consultar.

**Fuera de alcance de V1, ya documentado como decisión, no como hueco:** Alumno/inscripción real,
reposición de clases/oyentes/calendario, auditoría de reasignación de grupo (§10.2), motor de scoring/
evaluación docente (§10.1).

### 4.3 Decisiones tomadas 2026-09-21 sobre el checklist de §4.2

- **Login por defecto = CU, sin requisito de cambio.** `profesor.cu` es usuario y contraseña inicial;
  `profesor.password_predeterminada` (nuevo) marca si sigue sin cambiarla, solo para que admin/Jefe lo
  vean, nunca para bloquear nada.
- **Blindaje de `password_hash` — hecho con privilegios a nivel de columna** (`REVOKE`/`GRANT SELECT
  (...)` en `rls-policies.sql`), no solo con una política de fila: `authenticated` nunca puede leer
  esa columna sin importar la forma del `SELECT` que mande el cliente. Solo el rol de administrador de
  la base de datos (nunca expuesto al navegador) la lee, dentro de la Edge Function de login.
- **Login unificado — no existe tabla `usuario` aparte.** Jefe de Departamento/Servicios
  Escolares/Nómina/admin inician sesión con el mismo `profesor.cu`+password que cualquier profesor;
  `profesor.rol` (nuevo enum `rol_enum`, default `'profesor'`) es lo único que cambia. Un admin puro
  (que no da clases) también es una fila de `profesor`, con `departamento_id`/`tipo_contrato` en NULL
  (permitido por el `CHECK` de la tabla).
- **Edge Function de login — primer borrador escrito** en
  `malla-horarios/backend/supabase/functions/login/index.ts` (bcrypt + JWT propio firmado con el
  secreto del proyecto, claims `profesor_id` y `rol`, rate limiting mínimo por proceso). No probado —
  no existe proyecto real todavía donde desplegarlo.
- **Rol en el JWT: se firma como claim directo en el token** al momento del login (leído de
  `profesor.rol`), no se consulta la tabla en cada política — más barato en llamadas a la base (cero
  consultas extra por chequeo de RLS) y suficientemente seguro dado que el token ya tiene una duración
  corta (`TOKEN_TTL_SECONDS`, 12h por defecto): si a alguien le cambian el rol, el retraso hasta que se
  refleje es como máximo esa ventana, no indefinido.
- **Frontend real**: nueva carpeta `malla-horarios/frontend/` (React + Vite, ver su propio README).
  Se despliega a GitHub Pages vía GitHub Actions (build sin comitear `dist/`), pendiente de crear el
  workflow.
- **Carga de catálogo (materia/estimacion_demanda/departamento_semestre_config): resuelto sin
  herramienta aparte** — con login unificado + `rol` en el JWT, `rls-policies.sql` ya deja que un Jefe
  de Departamento autenticado normal edite el catálogo de su propio departamento (comparando
  `materia.departamento_id`/`estimacion_demanda`→`materia`→`departamento_id` contra su propia fila de
  `profesor`), y que admin edite cualquiera. Esto **resuelve la pregunta de alcance que quedaba abierta
  en §10.3** (¿secreto compartido simple vs. esperar login real de Jefe?) — ya no hace falta elegir,
  el login real de Jefe de Departamento resultó ser tan simple como el de cualquier profesor.
- **RF15 (elegibilidad de materias por profesor) — corregido 2026-09-21, revisión previa a
  aprovisionar.** `rls-policies.sql` tenía solo lectura (`propia_elegibilidad`) sobre
  `profesor_materia_elegible` y ningún permiso de escritura sobre `profesor.modo_materias_elegibles` —
  RF15 quedaba documentado pero sin forma real de cumplirse desde el cliente. Se agregó
  `jefe_elegibilidad_escritura` (política `FOR ALL` sobre `profesor_materia_elegible`, Jefe de
  Departamento/admin) y `jefe_modo_materias_update` + `GRANT UPDATE (modo_materias_elegibles)` +
  trigger `trg_bloquear_automodificacion_modo_materias` sobre `profesor` (el `GRANT` de columna es
  necesariamente amplio — Postgres no ata una columna a una sola política — así que el trigger es lo
  que impide que un profesor normal se cambie su propio `modo_materias_elegibles` aprovechando
  `propio_perfil_update`).
- **Función `app_departamento_id()` — eliminada 2026-09-21.** Quedó como placeholder roto ("redefinida
  abajo tras crear profesor", nunca se redefinió) sin usarse en ninguna política; todas ya resuelven
  departamento inline vía `(SELECT departamento_id FROM profesor WHERE id = app_profesor_id())`.

### 4.4 Pendiente real de §4.2 que sigue sin resolverse

- El workflow de GitHub Actions para el despliegue a Pages todavía no existe.
- El scaffold real de Vite/React todavía no existe (`frontend/` solo tiene el README).
- La Edge Function de login no se ha desplegado ni probado (no hay proyecto real todavía).
- El parser real de "pegar tabla → preview editable → upsert" (§10.3) no se ha construido — el acceso
  ya está resuelto (punto anterior), falta la pantalla/lógica en sí.

## 5. Alcance de V1

Construir la malla semestral y asignar profesores a grupos, para los 3 departamentos de Ciencias
Exactas. **No** incluye: inscripción real de alumnos, ni el motor de optimización/solver en sí (el
esquema solo deja los datos listos para que OR-Tools/PuLP los use después — ver
`Investigacion/investigacion_tecnologias_sistema.md` §7 — separando explícitamente restricciones
duras de preferencias blandas).

## 6. Entidades

### `departamento`
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| nombre | text UNIQUE NOT NULL | 'Matemáticas', 'Actuaría', 'Estadística' |
| clave_prefijo | varchar(5) UNIQUE NOT NULL | prefijo de clave de materia: 'MAT', 'ACT', 'EST' (confirmado en reportes reales) |

### `profesor`
**Login unificado (2026-09-21): esta tabla es la identidad de TODOS los roles**, no solo de quien da
clases — ver §4.1. Un admin/Servicios Escolares/Nómina que no dé clases también es una fila aquí, con
`departamento_id`/`tipo_contrato` en NULL (permitido por el `CHECK`).
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| cu | varchar(10) UNIQUE NOT NULL | Clave Única — login para cualquier rol; evita duplicados por fuzzy-match de nombre (bug detectado en Mat·Scheduler, `generate_data.py`). También es la contraseña inicial (decisión 2026-09-21, cambiarla es opcional) |
| password_hash | text NOT NULL | hash (bcrypt), nunca texto plano; se inicializa como `hash(cu)` |
| nombre | text NOT NULL | |
| correo | varchar(191) NULL UNIQUE | **Agregada 2026-10-02.** Lo captura la persona en "Mi perfil" o al darse de alta. Se guarda en minúsculas y se valida como correo. Para que la jefatura pueda contactar a cada profesor (cartas de asignación) y para **recuperar la contraseña** (§15): por eso es único — un correo señala a una sola cuenta. La base admite NULL (el roster cargado no trae correos), pero el API lo exige: a quien no lo tiene, la app se lo pide al entrar. 191 y no 255 por el tope de índice de InnoDB con utf8mb4 |
| rol | rol_enum NOT NULL DEFAULT 'profesor' | `profesor` \| `jefe_departamento` \| `jefe_division` \| `servicios_escolares` \| `nomina` \| `admin` — se firma directo como claim en el JWT de login, no se consulta en cada política RLS (más barato). **`jefe_division` se agregó 2026-09-25**: la División Académica (DACE) está arriba de los departamentos, así que su alcance son los 3 (Matemáticas, Actuaría, Estadística). Tiene el mismo alcance que `admin` pero no es lo mismo: admin administra el sistema, jefe_division dirige la división y sigue dando clases. En el código la pregunta se hace por comportamiento (`ve_todos_los_departamentos()` en `api/lib/auth.php`), nunca comparando contra un rol concreto. **Desde 2026-10-02, temporalmente, `jefe_division` ve solo su propio departamento** (Matemáticas) y conserva el manejo de semestres (`DIVISION_SOLO_SU_DEPARTAMENTO` y `administra_semestres()` en `api/lib/auth.php`) |
| departamento_id | int NULL FK → departamento | NULL solo si rol ∈ {admin, servicios_escolares, nomina}; obligatorio para profesor/jefe_departamento/jefe_division (ambos dan clases, confirmado 2026-08-21 que un profesor puede impartir materias de OTROS departamentos aunque pertenezca a uno solo) |
| tipo_contrato | tipo_contrato_enum NULL | `tiempo_completo` \| `asignatura` — taxonomía de 2 valores del cuestionario actual (autoritativa; la de 3 valores `hours`/`half-time`/`full-time` de Mat·Scheduler queda obsoleta). NULL bajo la misma condición que `departamento_id` |
| modo_materias_elegibles | modo_materias_enum NOT NULL DEFAULT 'todas' | `todas` \| `personalizada` \| `ninguna` — qué ve el profesor en su cuestionario; solo aplica a quien realmente da clases. **Eliminada 2026-09-28** (ver §12) |
| password_predeterminada | boolean NOT NULL DEFAULT true | true = sigue usando `cu` como contraseña, no la ha cambiado — informativo para admin/Jefe, no bloquea nada |
| estado_especial | text NULL | sabático/licencia/jubilación. Distinto de `activo`, que dice si la cuenta sirve para entrar |
| activo | boolean NOT NULL DEFAULT true | |
| CHECK | | `rol IN ('admin','servicios_escolares','nomina') OR (departamento_id IS NOT NULL AND tipo_contrato IS NOT NULL)` |

### `profesor_materia_elegible` — ELIMINADA 2026-09-28 (ver §12)
Solo relevante cuando `modo_materias_elegibles = 'personalizada'`; configurado por el Jefe de
Departamento.
| Columna | Tipo | Notas |
|---|---|---|
| profesor_id | int FK → profesor | |
| materia_id | int FK → materia | |
| PK(profesor_id, materia_id) | | |

### `plan_estudio`
Sin `departamento_id` directo: un plan conjunto (ej. MCD/MR) pertenece a 2+ departamentos.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| clave | varchar(10) NULL UNIQUE | carrera-versión del export de Oracle, p.ej. 'ACT-H', 'M.A-F'. NULL para un plan dado de alta a mano. Agregada 2026-10-21 (solo en MySQL) |
| nombre | text NOT NULL | p.ej. 'Lic. Actuaría', 'Maestría en Ciencia de Datos' |
| activo | boolean NOT NULL DEFAULT true | en los planes de Oracle, true = la versión más nueva de la carrera (la letra más alta); las anteriores se cargan igual, porque todavía hay alumnos en ellas |

### `plan_estudio_departamento` (N:M — planes conjuntos entre 2+ departamentos)
| Columna | Tipo | Notas |
|---|---|---|
| plan_estudio_id | int FK → plan_estudio | |
| departamento_id | int FK → departamento | |
| PK(plan_estudio_id, departamento_id) | | |

### `materia`
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| clave | varchar(20) UNIQUE NOT NULL | patrón real `{prefijo}-#####`, p.ej. 'MAT-12200', 'ACT-11300', 'EST-10101' |
| nombre | text NOT NULL | |
| creditos | int NOT NULL CHECK (creditos > 0) | |
| departamento_id | int NOT NULL FK → departamento | la materia pertenece a exactamente un departamento (confirmado 2026-08-07); es `plan_estudio_materia` el que cruza departamentos |
| anual | boolean NOT NULL DEFAULT false | distingue materias anuales vs. semestrales — ver `grupo.continua_de_id` para cómo se enlazan sus dos grupos |
| tipo_salon_requerido | text NULL | NULL = cualquier salón sirve. Confirmado con datos reales: Cálculo Numérico, Análisis Numérico, Optimización Numérica y Matemática Computacional siempre se dan en `RHCC302` (sala de cómputo) — nunca en un salón normal. Validado por trigger contra `salon.tipo` (`triggers.sql`). |
| activa | boolean NOT NULL DEFAULT true | |

### `plan_estudio_materia` (N:M — antes `Plan_Materia`; resuelve `Course.programs`, vacío en el 100% de los registros de Mat·Scheduler)
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| plan_estudio_id | int NOT NULL FK → plan_estudio | |
| materia_id | int NOT NULL FK → materia | |
| semestre_plan | int NOT NULL | número de semestre dentro del plan (1..N) — no confundir con `semestre` calendario |
| UNIQUE(plan_estudio_id, materia_id) | | |

### `materia_prerequisito` (self-referencial — seriación, antes implícita en `plan_estudio_materia`)
La seriación puede depender del plan de estudio.
| Columna | Tipo | Notas |
|---|---|---|
| materia_id | int FK → materia | la materia que tiene el requisito |
| prerequisito_id | int FK → materia | la materia requisito |
| plan_estudio_id | int NULL FK → plan_estudio | NULL = aplica en todos los planes |
| PK(materia_id, prerequisito_id, plan_estudio_id) | | CHECK(materia_id <> prerequisito_id) |

**Nota (RN01):** proteger horario entre materias seriadas ("cálculos seriados a la misma hora") queda
como idea a futuro, no implementada — depende de qué tan compatibles resulten las preferencias reales
de horario de los profesores (`GUIA-DECISIONES.md` D01/D07). Esta tabla solo guarda la seriación en sí.

### `materia_co_oferta` (self-referencial, simétrica — antes `Course.otherCodes`)
Catálogo: qué claves de materia SON la misma clase con otro nombre/clave (confirmado con reportes
reales: pares estables que se repiten entre semestres, ej. MAT-12201 con MAT-14102). También cubre el
caso de plan conjunto: dos materias de distinto departamento que son "la misma materia".
| Columna | Tipo | Notas |
|---|---|---|
| materia_id | int FK → materia | |
| co_ofertada_id | int FK → materia | |
| PK(materia_id, co_ofertada_id) | | CHECK(materia_id <> co_ofertada_id) |

### `materia_equivalencia` (self-referencial — antes `Materia_Equivale`; revalidación entre planes)
Coincide con `equivalenciasTodas.xlsx` de `DACC/MATERIAS` (confirmado 2026-08-07) — no hay que
inventar el catálogo de equivalencias de cero.
| Columna | Tipo | Notas |
|---|---|---|
| materia_origen_id | int FK → materia | |
| materia_destino_id | int FK → materia | |
| plan_estudio_id | int NULL FK → plan_estudio | plan en el que aplica la revalidación, si es específico |
| PK(materia_origen_id, materia_destino_id, plan_estudio_id) | | CHECK(materia_origen_id <> materia_destino_id) |

### `semestre` (catálogo — evita strings libres tipo "2026-otono")
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| tipo | tipo_semestre_enum NOT NULL | `primavera` \| `verano` \| `otono` |
| anio | int NOT NULL | |
| etiqueta | text GENERATED (`tipo || '-' || anio`) | p.ej. 'otono-2026'. **En MySQL ya no es columna** (§14): se arma al leerla |
| estado | enum NOT NULL DEFAULT 'cerrado' | `activo` \| `cerrado`. **Exactamente uno activo** (§13), el que se está planeando |
| abierto_at / abierto_por / cerrado_at | datetime / int FK → profesor / datetime | cuándo y quién lo activó, cuándo se cerró (UTC) |
| UNIQUE(tipo, anio) | | |

### `departamento_semestre_config` (nueva, 2026-09-21)
Configuración por departamento y semestre, editable por Jefe de Departamento (de su propio
departamento) o admin (de cualquiera) — ver política `departamento_config_escritura` en
`rls-policies.sql`.
| Columna | Tipo | Notas |
|---|---|---|
| departamento_id | int FK → departamento | |
| semestre_id | int FK → semestre | |
| mostrar_seleccion_materias | boolean NOT NULL DEFAULT true | `false` = el cuestionario de ese departamento ese semestre NO muestra selección de materias — el profesor solo declara disponibilidad de horario. **Obsoleta desde 2026-09-28**: no tener secciones de materias en `cuestionario_seccion` significa lo mismo (§12) |
| horas_minimas_verde | numeric(5,2) NOT NULL DEFAULT 10 | **OBSOLETA desde 2026-10-13**: resolvía D18 con un valor fijo; el mínimo ahora se calcula (§17). No se lee |
| ratio_horas_verde | numeric(4,2) NOT NULL DEFAULT 1.00 | (nueva 2026-10-13, D40) tiempo completo y medio tiempo: mínimo de horas en verde = horas de sus cursos × ratio, hacia arriba a la media hora. 1–5, se valida en el API. Asignatura siempre va con 1 (§17) |
| texto_introduccion | text NULL | texto de arriba del formulario; NULL = el de siempre (§12) |
| publicado / publicado_at / publicado_por | boolean DEFAULT false / datetime / int FK → profesor | sin publicar, los profesores no ven el formulario y el API rechaza guardar (§12) |
| PK(departamento_id, semestre_id) | | |

### `estimacion_demanda` (antes `Estimación_Demanda` del boceto de 2026-08-11 — dispara la creación de `grupo`)
Estructura tomada directamente de los reportes reales de Servicios Escolares
(`Mat/Act/Est 202603 (1).pdf`) — mismas 15 columnas en los 3 departamentos, revisado 2026-09-21.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| materia_id | int NOT NULL FK → materia | |
| semestre_id | int NOT NULL FK → semestre | |
| alumnos_total | int NOT NULL | columna "A.T." del reporte |
| nuevo_ingreso | int NOT NULL DEFAULT 0 | columna "N.I." |
| pct_baja | numeric(5,2) NULL | |
| pct_reprobacion | numeric(5,2) NULL | |
| con_prerrequisito | numeric(8,2) NOT NULL DEFAULT 0 | alumnos que ya cubrieron el prerrequisito. Era `int`; pasó a decimal el 2026-09-29 porque Actuaría la trae con decimales (§13) |
| demanda_ajustada | numeric(8,2) NULL | columna "Suma" del reporte real — demanda ya ajustada por Servicios Escolares, se guarda tal cual, no se recalcula |
| capacidad_planeacion | int NULL | columna "Cap." — cupo de referencia usado para estimar `grupos_sugeridos`; constante (30) en los 3 reportes revisados, pero se guarda por fila por si cambia |
| grupos_periodo_anterior | int NOT NULL DEFAULT 0 | columna "2025" del reporte (offering previo) |
| grupos_sugeridos | int NOT NULL | columna "Sug" — la cifra que efectivamente dispara cuántos `grupo` crear (RF13). **0 es válido y se conserva** — la UI de admin/Jefe debe resaltarlo, no ocultarlo |
| mostrar_en_cuestionario | boolean NOT NULL DEFAULT true | visibilidad GLOBAL por semestre (independiente de `profesor_materia_elegible`, que es personalización POR profesor) |
| UNIQUE(materia_id, semestre_id) | | |

Nota de la columna "Hrs" del reporte real: `Hrs = grupos_sugeridos × creditos / 2` en las 3 muestras
revisadas — es derivable, no se guarda (evita redundancia mantenida a mano, ver §9). Ver
`motor-asignacion.md` (copia pública) para el detalle de mecanismo de carga (pegar tabla → preview →
upsert) y la normalización de clave (Matemáticas usa guion, Actuaría/Estadística no).

### `franja_horaria` (catálogo fijo de bloques de 30 min — hace estructuralmente imposible violar la regla de comida)
Se pre-carga con Lunes–Viernes 07:00–14:00 y 16:00–20:00 (22 franjas, igual que el mockup del
cuestionario) y **dos excepciones acotadas** (§15): 14:00–14:30 solo martes y jueves, y 20:00–22:00
solo para Estadística. 27 franjas en total. Fuera de esa media hora, nunca hay franja entre
14:00–16:00 (RN05).
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| hora_inicio | time NOT NULL UNIQUE | |
| hora_fin | time NOT NULL | |
| orden | int NOT NULL | para ordenar en UI |
| dias | set de días NULL | **Agregada 2026-10-02.** NULL = todos los días. La franja de 14:00 lleva `martes,jueves`: la rejilla la muestra bloqueada los demás días y el API descarta esas celdas |
| departamento_id | int NULL FK → departamento | **Agregada 2026-10-06.** NULL = todos los departamentos. Las 4 franjas de 20:00–22:00 llevan el id de Estadística: solo su formulario las muestra, el API descarta las celdas de quien no es de ese departamento, y solo Estadística tiene filas en `salon_disponibilidad_departamento` para ellas (así el trigger de `imparte_horario` rechaza asignarle esas horas a otro departamento) |

### `salon`
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| nombre | text NOT NULL | p.ej. 'RH107', 'PF105' (nomenclatura real de los reportes) |
| edificio | text NULL | p.ej. 'EDIFICIO 3 EN RIO HONDO' |
| capacidad | int NOT NULL CHECK (capacidad > 0) | |
| tipo | text NULL | p.ej. 'Butacas' |
| activo | boolean NOT NULL DEFAULT true | |

### `salon_disponibilidad_departamento`
Tomado de `act salones 202601.pdf`: un salón no está libre para cualquier departamento en cualquier
horario — Servicios Escolares reparte edificios/salones por departamento, día y rango horario cada
semestre. **Decisión de alcance V1** (ver §2 y §3): la tabla se queda en el esquema, pero los datos
semilla de esta primera iteración dan de alta los 3 departamentos compartiendo el mismo pool completo
de salones/horarios, sin restricción entre sí.
| Columna | Tipo | Notas |
|---|---|---|
| salon_id | int FK → salon | |
| departamento_id | int FK → departamento | |
| semestre_id | int FK → semestre | |
| dia | dia_semana_enum NOT NULL | |
| franja_id | int FK → franja_horaria | |
| PK(salon_id, departamento_id, semestre_id, dia, franja_id) | | |

### `grupo` (antes el "estado de trabajo/borrador" de `REQUERIMIENTOS.md` §3.4 — creado desde la demanda, ANTES de asignar profesor/salón/horario)
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| crn | int NOT NULL | folio real de Control Escolar (reportes: 2411, 2412...) |
| materia_id | int NOT NULL FK → materia | |
| semestre_id | int NOT NULL FK → semestre | |
| numero | varchar(3) NOT NULL | '001'..N, secuencial por materia+semestre (coincide con la clave-grupo real: `ACT-11300-001`) |
| cupo_maximo | int NULL | "Núm. Máx. Alum." del reporte real; valida contra `salon.capacidad` |
| estado | estado_grupo_enum NOT NULL DEFAULT 'demanda' | `demanda` \| `en_asignacion` \| `asignado` \| `cancelado` |
| publicado | boolean NOT NULL DEFAULT false | RN09: una vez publicado, no debería cambiar de salón salvo que lo pida Dirección Escolar |
| continua_de_id | int NULL FK → grupo | solo para `materia.anual = true`: enlaza este grupo con el del semestre anterior del que es continuación. **Son dos grupos independientes** (cada uno con su propio `semestre_id`, `imparte`, etc.), unidos solo para reportarlos/mostrarlos juntos — no un grupo que abarca dos semestres (decisión confirmada 2026-09-09, para no romper que `grupo` pertenezca a un solo semestre) |
| UNIQUE(materia_id, semestre_id, numero) | | |
| UNIQUE(semestre_id, crn) | | el CRN es folio único por periodo |

### `imparte` (antes `Imparte`/`CourseInstance` — la asignación concreta, 1:1 con `grupo`, tabla histórica de confirmados)
Ya no guarda profesor ni salón directamente (ver `imparte_profesor`/`imparte_horario`) — ambos pueden
variar por bloque de horario o ser más de uno, confirmado por los reportes reales.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| grupo_id | int NOT NULL UNIQUE FK → grupo | 1:1 — cada grupo tiene a lo más una asignación |
| overrides | jsonb NULL | excepciones puntuales a nivel instancia (nombre/créditos/etc.), resuelve la pregunta abierta #9 de `REQUERIMIENTOS.md` §9 (análogo a `CourseInstance.overrides` de Mat·Scheduler) |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

### `imparte_profesor` (N:M — co-titularidad confirmada por datos reales, ej. CRN 2425 con dos profesores)
| Columna | Tipo | Notas |
|---|---|---|
| imparte_id | int FK → imparte | |
| profesor_id | int FK → profesor | |
| PK(imparte_id, profesor_id) | | |

### `imparte_co_oferta` (co-oferta real, con % de responsabilidad — ver §2)
| Columna | Tipo | Notas |
|---|---|---|
| imparte_id | int FK → imparte | |
| imparte_relacionado_id | int FK → imparte | |
| porcentaje_responsabilidad | numeric(5,2) NOT NULL | % de responsabilidad/carga atribuido a `imparte_id` en esta co-oferta |
| PK(imparte_id, imparte_relacionado_id) | | CHECK(imparte_id <> imparte_relacionado_id) |

### `imparte_horario` (bloques de 30 min de un `imparte`, cada uno con su propio salón)
Confirmado por datos reales que el salón puede variar por día dentro del mismo grupo — por eso
`salon_id` vive aquí y no en `imparte`. Sin columnas denormalizadas: las restricciones de
no-doble-booking se aplican con triggers (`triggers.sql`), no duplicando profesor/salón/semestre como
columnas sueltas.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| imparte_id | int NOT NULL FK → imparte | |
| dia | dia_semana_enum NOT NULL | |
| franja_id | int NOT NULL FK → franja_horaria | |
| salon_id | int NOT NULL FK → salon | |
| UNIQUE(imparte_id, dia, franja_id) | | |

Reglas de negocio validadas vía trigger/aplicación (agregados, no expresables como CHECK simple):
- Ningún profesor de `imparte_profesor` de este `imparte` puede tener otro `imparte_horario` (de otro
  `imparte`, mismo semestre) en el mismo día/franja — RN sin nombre formal, "un profesor no puede
  estar en dos lugares a la vez".
- Ningún `salon_id` puede repetirse en el mismo día/franja/semestre en otro `imparte_horario` — RN02.
- `COUNT(*) * 0.5` horas de un `imparte_id` debe igualar `materia.creditos` del grupo correspondiente.
- Ningún par consecutivo de franjas debe dejar un hueco de media hora suelto en el día de un
  profesor/salón — RN06 (validación de aplicación, no trigger — depende de la malla completa del día).

### `preferencia` (antes `Preferencia` — Profesor × Semestre, reemplaza los dos Google Forms desconectados, RF04)
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| profesor_id | int NOT NULL FK → profesor | |
| semestre_id | int NOT NULL FK → semestre | |
| num_cursos_max | int NULL CHECK (num_cursos_max BETWEEN 1 AND 6) | **NULL del 2026-10-02 al 2026-10-13**, cuando la pregunta "Número de cursos" era opcional (§15). Desde entonces la pregunta es fija y el API exige 1–6; la columna sigue admitiendo NULL por las preferencias de ese intervalo (§17) |
| otro_curso | text NULL | |
| horarios_otro_depto | text NULL | solo relevante si `profesor.tipo_contrato = 'asignatura'` (RN03: tope 10 hrs/semana cruzando departamentos). **Obsoleta desde 2026-09-28**: ahora es una pregunta abierta (`preferencia_respuesta`, §12) |
| observaciones_cursos | text NULL | **Obsoleta desde 2026-09-28**, igual que la anterior |
| observaciones_horarios | text NULL | **Obsoleta desde 2026-09-28**, igual que la anterior |
| estado | estado_preferencia_enum NOT NULL DEFAULT 'borrador' | `borrador` \| `enviado` |
| enviado_at | timestamptz NULL | |
| UNIQUE(profesor_id, semestre_id) | | |

### `preferencia_materia` (antes `Preferencia_Materia` — restricción BLANDA, ranking de materias)
Las opciones que ve el profesor salen del formulario de su departamento (`cuestionario_seccion` +
`materia_cuestionario`, ver §12) — lógica de aplicación, no una FK adicional aquí. Hasta el
2026-09-28 además se filtraban por `profesor.modo_materias_elegibles` + `profesor_materia_elegible`.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| preferencia_id | int NOT NULL FK → preferencia | |
| materia_id | int NOT NULL FK → materia | |
| nivel | nivel_preferencia_enum NOT NULL | `verde` \| `amarillo` \| `rojo` |
| cobertura_departamental | boolean NOT NULL DEFAULT false | marca el subgrupo "cálculo con cobertura departamental" para el umbral mínimo de verdes (Tiempo Completo: 2+5; Asignatura: 5) |
| UNIQUE(preferencia_id, materia_id) | | |

### `disponibilidad` (restricción DURA — separada de la preferencia de materias por recomendación de la literatura UCTP y por D09/D10 de `GUIA-DECISIONES.md`)
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| preferencia_id | int NOT NULL FK → preferencia | |
| dia | dia_semana_enum NOT NULL | |
| franja_id | int NOT NULL FK → franja_horaria | comparte catálogo con `imparte_horario` |
| nivel | nivel_preferencia_enum NOT NULL | rejilla *when2meet*: verde = seguro disponible, amarillo = posible pero complicado, rojo = no disponible (D10, resuelto 2026-08-21) |
| UNIQUE(preferencia_id, dia, franja_id) | | |

**Mínimo de horas en verde (D18 → D40, `GUIA-DECISIONES.md`):** es una validación de aplicación al
momento de enviar, no una columna. Desde 2026-10-13 se calcula con lo que contesta el profesor: 3 h por
curso que pidió, más 1 h si tiene en verde una materia de 8 créditos, por el ratio de
`departamento_semestre_config.ratio_horas_verde` si es de tiempo completo o medio tiempo (§17).

### `cuestionario_seccion` (nueva 2026-09-28 — el formulario editable, ver §12)
Bloques del formulario de un departamento/semestre, en orden. Sin filas, el editor siembra una
plantilla la primera vez que se abre.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| departamento_id | int NOT NULL FK → departamento | |
| semestre_id | int NOT NULL FK → semestre | |
| tipo | enum NOT NULL | `num_cursos` \| `materias` \| `disponibilidad` \| `abierta`. `disponibilidad` y `num_cursos`: exactamente una de cada (`num_cursos` fue opcional del 2026-10-02 al 2026-10-13; se valida en el API) |
| titulo | text NOT NULL | |
| descripcion | text NULL | |
| audiencia | enum NOT NULL DEFAULT 'todos' | `todos` \| `tiempo_completo_medio` \| `asignatura` |
| minimo_verdes | int NULL | solo tipo `materias`; NULL = sin mínimo |
| cobertura_departamental | boolean NOT NULL DEFAULT false | solo tipo `materias`; se copia a `preferencia_materia.cobertura_departamental` |
| obligatoria | boolean NOT NULL DEFAULT false | solo tipo `abierta` |
| orden | int NOT NULL | |
| activa | boolean NOT NULL DEFAULT true | borrado suave: `preferencia_respuesta` la referencia |

### `materia_cuestionario` (qué materias ve el formulario y en qué sección)
| Columna | Tipo | Notas |
|---|---|---|
| materia_id | int FK → materia | |
| semestre_id | int FK → semestre | |
| seccion_id | int NULL FK → cuestionario_seccion | NULL = oculta. **Sin fila** = cae en la primera sección de materias para todos (fail-open) |
| alias_de_id | int NULL FK → materia | esta materia es el nombre viejo de otra; se muestra "(antes …)". Se cura a mano, no se deriva de `materia_co_oferta`. CHECK: distinto de `materia_id`, y si hay alias la fila va oculta |
| etiqueta | text NULL | nombre a mostrar cuando `materia.nombre` no sirve tal cual |
| orden | int NULL | |
| revisado | boolean NOT NULL DEFAULT false | false = la puso un seed automático y la jefatura no la ha confirmado |
| PK(materia_id, semestre_id) | | |

Ejemplo real del patrón de alias (2026-10-06, Matemáticas): MAT-24410 Programación Lineal y
MAT-24430 Análisis Aplicado I ahora son MAT-24433 Optimización Numérica I; MAT-24431 pasa a
MAT-24435 Optimización Numérica II; MAT-24500 pasa a MAT-24505 Investigación de Operaciones I. La
clave nueva ocupa la sección de la vieja, la vieja queda oculta con `alias_de_id` a la nueva, la
co-oferta se guarda en ambas direcciones y las respuestas ya dadas con la clave vieja se mueven a la
nueva. Es un cambio de datos, no de esquema.

### `preferencia_respuesta` (nueva 2026-09-28 — respuestas a preguntas abiertas)
| Columna | Tipo | Notas |
|---|---|---|
| preferencia_id | int FK → preferencia (ON DELETE CASCADE) | |
| seccion_id | int FK → cuestionario_seccion | una sección de tipo `abierta` |
| texto | text NOT NULL | |
| PK(preferencia_id, seccion_id) | | |

### `bloqueo_profesor_materia` (nueva 2026-09-28 — restricción DURA puesta por la jefatura)
Capa aparte a propósito: la respuesta del profesor se conserva intacta, al desbloquear vuelve a contar,
y el profesor nunca ve el bloqueo.
| Columna | Tipo | Notas |
|---|---|---|
| profesor_id | int FK → profesor | |
| materia_id | int FK → materia | |
| semestre_id | int FK → semestre | |
| bloqueado_por | int NOT NULL FK → profesor | quién de la jefatura lo bloqueó |
| bloqueado_at | datetime NOT NULL | UTC |
| PK(profesor_id, materia_id, semestre_id) | | |

### `intento_login` (infraestructura del API — solo existe en MySQL, ver §14)
Límite de intentos de login. PHP no guarda estado entre peticiones, así que el contador vive aquí.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| llave | varchar(64) NOT NULL | el `cu` en el login, el `profesor_id` en el cambio de contraseña, con prefijo para no mezclarlos |
| momento | datetime NOT NULL | UTC. Ventana de 5 min: 8 intentos para login, 5 para cambio de contraseña. Cada consulta borra lo más viejo que la ventana |

### `recuperacion_password` (nueva 2026-10-02 — "olvidé mi contraseña", ver §15)
Un token de un solo uso por solicitud. Se guarda el **SHA-256 del token, nunca el token**: quien lea
la tabla (un respaldo, phpMyAdmin) no puede usarla para entrar a ninguna cuenta.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| profesor_id | int NOT NULL FK → profesor (ON DELETE CASCADE) | |
| token_hash | char(64) NOT NULL UNIQUE | SHA-256 en hex del token que va en el enlace |
| creado_at | datetime NOT NULL | UTC |
| expira_at | datetime NOT NULL | UTC, una hora después de `creado_at` |
| usado_at | datetime NULL | se llena al restablecer; un token usado no vuelve a servir |

### `ajuste_num_cursos` (nueva 2026-10-12 — la jefatura sobreescribe el número de cursos, ver §16)
Misma idea que `bloqueo_profesor_materia`: capa aparte, `preferencia.num_cursos_max` queda intacto y
el profesor nunca la ve. No cuelga de `preferencia` porque se puede ajustar a quien aún no contesta.
| Columna | Tipo | Notas |
|---|---|---|
| profesor_id | int FK → profesor | |
| semestre_id | int FK → semestre | |
| num_cursos | int NOT NULL | 0–6 (triggers `trg_anc_cursos_*`). 0 = este semestre no se le asignan cursos |
| ajustado_por | int NOT NULL FK → profesor | quién de la jefatura lo ajustó |
| ajustado_at | datetime NOT NULL | UTC |
| PK(profesor_id, semestre_id) | | |

### `asignacion_fija` (nueva 2026-10-13 — asignaciones directas antes del motor, ver §16)
Restricción DURA: un grupo de esta materia lo da este profesor. **Una fila = un grupo.** Capa aparte
de `grupo`/`imparte` porque a esta altura no hay CRN ni salón.
| Columna | Tipo | Notas |
|---|---|---|
| id | serial PK | |
| semestre_id | int NOT NULL FK → semestre | |
| tipo | enum(materia, maestria) NOT NULL | `maestria` = materia de maestría fuera del catálogo: aparta horario, no es curso |
| departamento_id | int NOT NULL FK → departamento | el de la jefatura que la fijó (antes salía de la materia; con `maestria` no hay materia) |
| materia_id | int NULL FK → materia | NULL solo con `tipo = maestria` (lo valida el API) |
| profesor_id | int NOT NULL FK → profesor | |
| nota | varchar(500) NULL | por qué se fijó o, en maestría, qué materia es; solo la ve la jefatura |
| creado_por | int NOT NULL FK → profesor | |
| creado_at | datetime NOT NULL | UTC |

### `asignacion_fija_horario` (nueva 2026-10-13 — horario de una asignación fija)
Bloques de 30 min. Sin filas = el motor elige el horario (no se permite con `tipo = maestria`).
| Columna | Tipo | Notas |
|---|---|---|
| asignacion_fija_id | int FK → asignacion_fija (ON DELETE CASCADE) | |
| dia | enum(lunes … viernes) | |
| franja_id | int FK → franja_horaria | debe valer ese día y para ese departamento (lo valida el API) |
| PK(asignacion_fija_id, dia, franja_id) | | con `tipo = materia` suman exactamente `materia.creditos` bloques |

## 7. Resumen de relaciones

- `departamento` 1—N `profesor`, `materia`
- `plan_estudio` N—M `departamento` vía `plan_estudio_departamento` (planes conjuntos, ej. MCD/MR)
- `plan_estudio` N—M `materia` vía `plan_estudio_materia`
- ~~`profesor` N—M `materia` vía `profesor_materia_elegible`~~ (eliminada 2026-09-28) — ahora
  `profesor` N—M `materia` vía `bloqueo_profesor_materia` (por semestre, §12)
- `materia` self-N:M vía `materia_prerequisito` (seriación), `materia_co_oferta` (co-oferta),
  `materia_equivalencia` (revalidación) — **tres relaciones distintas**, no una
- `materia` 1—N `grupo`; `semestre` 1—N `grupo`; `materia`+`semestre` 1—N `estimacion_demanda`
- `grupo` self-1:N vía `continua_de_id` (materias anuales: dos grupos de semestres consecutivos, enlazados)
- `salon` N—M `departamento` (por semestre/día/franja) vía `salon_disponibilidad_departamento`
- `grupo` 1—1 `imparte`
- `imparte` N—M `profesor` vía `imparte_profesor` (co-titularidad)
- `imparte` self-N:M vía `imparte_co_oferta` (con % de responsabilidad)
- `imparte` 1—N `imparte_horario`; `imparte_horario` N—1 `salon`; `franja_horaria` 1—N `imparte_horario`
- `profesor` 1—N `preferencia`; `semestre` 1—N `preferencia`
- `preferencia` 1—N `preferencia_materia` (→ `materia`); `preferencia` 1—N `disponibilidad` (→ `franja_horaria`)
- `profesor` N—1 `departamento` (NULL si rol ∈ {admin, servicios_escolares, nomina}) — ya no hay una
  tabla `usuario` aparte, el rol vive en `profesor.rol` (ver §4.1/§4.3)
- `departamento` 1—N `departamento_semestre_config` (por semestre); `semestre` 1—N `departamento_semestre_config`
- `departamento` + `semestre` 1—N `cuestionario_seccion`; `cuestionario_seccion` 1—N
  `materia_cuestionario` y 1—N `preferencia_respuesta`; `preferencia` 1—N `preferencia_respuesta` (§12)
- `materia_cuestionario` N—1 `materia` vía `alias_de_id` (nombre viejo → nombre nuevo)
- `departamento` 1—N `franja_horaria` (opcional: solo las franjas exclusivas de un departamento, §15)
- `profesor` 1—N `recuperacion_password` (§15)

Ver también [`diagrama-er.md`](diagrama-er.md) para la versión visual (Mermaid).

## 8. Restricciones de negocio y cómo quedan cubiertas

| Regla | Mecanismo |
|---|---|
| Sin traslape de profesor | trigger sobre `imparte_horario`, vía `imparte_profesor` + `imparte`→`grupo`→`semestre_id` |
| Sin traslape de salón (RN02) | trigger sobre `imparte_horario`, mismo semestre/día/franja |
| Salón asignado solo a departamentos autorizados | validación de aplicación/trigger contra `salon_disponibilidad_departamento` (sin restricción real en V1, ver §2/§3) |
| Bloque de comida 14:00–16:00 nunca ofertado (RN05) | estructural: esas franjas no existen en `franja_horaria`, salvo la excepción 14:00–14:30 martes y jueves (`franja_horaria.dias`, §15) |
| Horario extendido 20:00–22:00 solo para Estadística | `franja_horaria.departamento_id` + filas de `salon_disponibilidad_departamento` solo para Estadística (§15); el API descarta esas celdas para otros departamentos |
| Un solo semestre activo | API (transacción en `api/semestres.php`): MariaDB 5.5 no tiene índices parciales (§13) |
| Recuperación de contraseña segura | `recuperacion_password`: token hasheado, de un solo uso, vence en una hora; `profesor.correo` UNIQUE (§15) |
| Sin medias horas sueltas (RN06) | validación de aplicación sobre la malla completa del día (no es un CHECK por fila) |
| Suma de créditos de un grupo | validación de aplicación: `COUNT(imparte_horario) * 0.5 = materia.creditos` |
| Tope de horas Asignatura ≤10 hrs/semana cruzando departamentos (RN03) | validación de aplicación: `SUM` de franjas vía `imparte_horario`+`imparte_profesor` por `profesor_id`+`semestre_id` |
| Asignación por tipo de contrato: TC por curso, Asignatura por hora (RN04) | interpretación de aplicación sobre `preferencia.num_cursos_max` según `profesor.tipo_contrato` (NULL si el formulario no tenía la pregunta) |
| Cupo de salón vs. tamaño de grupo | validación de aplicación al asignar `salon_id` en `imparte_horario`: `grupo.cupo_maximo <= salon.capacidad` |
| Salón con equipo requerido (ej. sala de cómputo) | trigger sobre `imparte_horario`: `materia.tipo_salon_requerido` debe igualar `salon.tipo` cuando no es NULL |
| No cambio de salón tras publicar (RN09) | `grupo.publicado`, validación de aplicación al editar `imparte_horario` |
| Identidad de profesor sin duplicados | `cu` UNIQUE NOT NULL en `profesor` |
| Separación dura/blanda (D09) | tablas distintas: `disponibilidad` (dura) vs. `preferencia_materia` (blanda) |
| Mínimos de verdes para envío válido (2+5 TC / 5 Asignatura) | validación de aplicación al pasar `preferencia.estado` a `enviado`, usando `preferencia_materia.cobertura_departamental` |
| Elegibilidad de materias por profesor | `bloqueo_profesor_materia` (desde 2026-09-28; antes `profesor.modo_materias_elegibles` + `profesor_materia_elegible`) |
| Creación de grupos a partir de la demanda real (RF13) | `estimacion_demanda.grupos_sugeridos` informa cuántas filas de `grupo` crear por materia/semestre |

## 9. Verificación de formas normales (1FN–4FN)

Revisión tabla por tabla contra las cuatro formas normales (2026-09-09).

**1FN (valores atómicos, sin grupos repetidos):** se cumple en todas las tablas, con **una excepción
deliberada**: `imparte.overrides` es `jsonb` — un campo semiestructurado a propósito, para
excepciones puntuales que no se sabe de antemano qué forma van a tener (análogo a
`CourseInstance.overrides` de Mat·Scheduler). No es un descuido: modelar cada posible excepción como
columna explícita obligaría a alterar el esquema cada vez que aparezca un caso especial nuevo. Aparte
de esa columna, ninguna otra tabla guarda listas ni estructuras anidadas en una sola celda.

**2FN (sin dependencias parciales sobre llaves compuestas):** todas las tablas con llave primaria
compuesta (`profesor_materia_elegible`, `plan_estudio_departamento`, `materia_prerequisito`,
`materia_co_oferta`, `materia_equivalencia`, `imparte_profesor`, `salon_disponibilidad_departamento`)
son tablas puente sin atributos adicionales, o con un atributo que depende genuinamente de la llave
completa — ej. `imparte_co_oferta.porcentaje_responsabilidad` depende del par completo
(`imparte_id`, `imparte_relacionado_id`), no de uno de los dos por separado: el mismo `imparte` podría
en teoría tener porcentajes distintos según con cuál otro `imparte` se empareje. No hay ningún caso de
un atributo que dependa de solo una parte de una llave compuesta.

**3FN (sin dependencias transitivas):** revisadas todas las tablas con atributos no-llave (`profesor`,
`materia`, `grupo`, `salon`, `preferencia`, etc.) — en cada una, los atributos describen directamente
a la entidad identificada por la llave primaria, no a otra entidad relacionada a través de una FK.
Por ejemplo, `grupo.cupo_maximo` es un dato propio de ese grupo (no se puede derivar de `materia` ni de
`semestre`); `profesor.nombre` no depende de `profesor.departamento_id`. Única salvedad:
`semestre.etiqueta` es una columna `GENERATED ALWAYS AS (...) STORED` — se recalcula sola a partir de
`tipo`+`anio`, Postgres nunca permite que se desincronice, así que no es la redundancia que 3FN busca
evitar (esa prohíbe redundancia *mantenida a mano*, no una columna calculada por el motor).

**FNBC/BCNF (todo determinante es llave candidata):** el único caso no trivial es
`franja_horaria.hora_inicio` (UNIQUE) determinando `hora_fin` — pero `hora_inicio` ya es en sí misma
una llave candidata, así que no viola FNBC. No se encontró ningún atributo no-llave que determine a
otro atributo no-llave en ninguna tabla.

**4FN (sin dependencias multivaluadas no triviales):** el caso que vale la pena documentar es
`salon_disponibilidad_departamento` (salon, departamento, semestre, día, franja) — con 5 columnas en
la llave es el candidato obvio a revisar. **No es una violación** porque, según `act salones
202601.pdf` (el reporte real revisado), la disponibilidad de día/franja de un salón **sí es distinta
por departamento** (ej. el salón 105 solo se le asigna a Actuaría martes/jueves 16:00–21:59) — no es
"este salón está libre estas horas" + independientemente "este salón lo puede usar tal departamento"
como dos hechos separables que luego se cruzan. Si fuera así (dos hechos independientes combinados en
una sola tabla), sí sería una violación de 4FN y habría que partirla en dos tablas más chicas. Como no
lo es —cada combinación se autoriza o no de forma independiente—, mantenerla como una sola relación de
5 columnas es lo correcto. (El `seed.sql` de V1 sí inserta el producto cartesiano completo porque la
*decisión de negocio* para esta primera iteración es compartir todo el pool sin restricción — eso es
una elección de qué datos cargar, no una propiedad de la estructura de la tabla.) El resto de las
tablas puente (`imparte_profesor`, `profesor_materia_elegible`, etc.) modelan un solo hecho
multivaluado cada una, así que no hay nada que descomponer.

**Conclusión:** el esquema cumple 1FN–4FN en su totalidad, con la única excepción consciente y
documentada de `imparte.overrides` (jsonb), que es una decisión de diseño (flexibilidad para
excepciones no anticipadas) y no un error de normalización.

## 10. Lo que este esquema deliberadamente NO resuelve todavía

Para no adelantar decisiones que siguen abiertas en `GUIA-DECISIONES.md`:

- **D03** (tope de hora pico por departamento) y **D05/D06** (jerarquía de prioridad de salón) — el
  esquema permite consultarlo (tiene salón, capacidad, horario), pero no fuerza ninguna política; eso
  vive en el motor de asignación, no en la base de datos.
- **D07/D08** (protección de cohortes núcleo, coordinación Mat↔Act↔Est) y **RN01** (empalme por
  secuencia) — `materia_prerequisito` guarda la seriación, pero no hay ningún mecanismo que fije
  horario compartido entre materias seriadas; explícitamente no implementado hasta tener datos reales
  de qué tan compatibles son las preferencias de horario de los profesores involucrados.
- **D12–D14/D19** (matriz de puntuación para resolver conflictos entre profesores, métrica de "match",
  uso de evaluación docente) — RF14 pide que la vista del Jefe de Departamento muestre esta métrica,
  pero la fórmula sigue sin definirse; no se agregan columnas nuevas al esquema todavía porque
  construir la tabla antes de tener la fórmula arriesga tener que rehacerla. Ver §10.1 para cómo dejar
  el terreno listo sin adelantar la decisión.
- **D15–D17** (gobernanza de excepciones, apelación, reasignación automática) — sin representación en
  el esquema; son flujo de proceso, no estructura de datos, hasta que se decidan.
- **D18** (horas mínimas en verde por semana) — validación de aplicación, no columna. Resuelta: desde
  2026-10-13 el mínimo se calcula con los cursos del profesor y `ratio_horas_verde` (D40, §17).

### 10.1 Escenarios futuros pensados desde ahora (evaluación docente, score histórico, horas)

Revisión (2026-09-09) de qué tan bien el diseño actual aguanta tres
necesidades futuras conocidas — sin construirlas todavía, porque las tres dependen de una fórmula o
política que sigue sin definirse (D12–D14/D19). El objetivo aquí es que, cuando esas decisiones se
tomen, agregarlas sea **sumar tablas nuevas que cuelgan de lo que ya existe**, no rediseñar nada.

**1. Cálculo de horas por profesor — ya soportado, sin cambios.** `SUM` de `imparte_horario` (vía
`imparte_profesor` → `imparte` → `grupo.semestre_id`) por profesor y semestre ya da el total de horas
sin ninguna columna nueva; es la misma consulta agregada que ya usa el trigger de créditos. La única
pieza que faltaría, y solo si Nómina la necesita, es una **foto fija** del reporte (para que un cambio
posterior en la malla no altere retroactivamente lo que ya se le reportó a Nómina un semestre dado):

```
reporte_horas_profesor (
    id, profesor_id FK, semestre_id FK,
    horas_totales numeric, generado_at timestamptz, generado_por FK profesor
)
```

No se crea todavía porque no hace falta hasta que exista el flujo real de generar/enviar el reporte
(RF09); la consulta en vivo cubre todo lo que se necesita mientras tanto.

**2. Métrica de "match" preferencia-vs-asignación, con histórico entre semestres (RF14, D12–D14).**
Es calculable ya mismo comparando `preferencia_materia`/`disponibilidad` de un `profesor`+`semestre`
contra lo que terminó en `imparte`/`imparte_horario` ese mismo semestre — ninguna tabla nueva hace
falta solo para *calcular* el score una vez. Lo que si conviene prever es **dónde guardarlo cuando se
quiera comparar entre semestres sin recalcular cada vez**, porque la fórmula todavía no está definida
y **va a cambiar** — si se guarda un número solo, comparar el score de otoño 2026 contra el de
primavera 2027 después de cambiar la fórmula sería comparar peras con manzanas sin darse cuenta. Boceto
para cuando D12–D14 se resuelvan:

```
historial_score_asignacion (
    id, profesor_id FK, semestre_id FK,
    score numeric, formula_version text,   -- ej. 'v1-2027', para no mezclar fórmulas distintas
    detalle jsonb,                          -- desglose por categoría si la fórmula tiene varias (D13)
    calculado_at timestamptz
)
```

**Principio a fijar desde ahora, aunque la tabla no exista todavía:** cualquier score que se guarde
debe llevar su versión de fórmula. Es lo único de este punto que sí vale la pena decidir ya, porque
cambia cómo se van a leer los datos históricos el día que se implemente.

**3. Evaluación docente por clase (D19).** Es información sensible que hoy solo tienen los Jefes de
Departamento — no se agrega al esquema hasta confirmar si entra al sistema en absoluto. Si se
confirma, el ancla natural es `imparte_id` (no `profesor_id` suelto), porque la evaluación es de
*una clase impartida en un semestre concreto*, no del profesor en abstracto — y como `imparte` nunca
se sobreescribe entre semestres (ver más abajo), la evaluación quedaría ligada permanentemente a la
instancia correcta sin trabajo adicional:

```
evaluacion_docente (
    id, imparte_id FK UNIQUE, puntaje numeric, fuente text, capturado_at timestamptz
)
```

Al ser una tabla aparte (no columnas dentro de `imparte`), se puede restringir su acceso por separado
del resto de la malla — relevante porque D19 la marca como dato delicado que no todos los roles deben
poder consultar.

**Por qué las tres ya "encajan" sin rediseño:** las tres dependen de poder mirar hacia atrás por
semestre sin ambigüedad, y eso ya está garantizado por dos propiedades que el esquema actual ya tiene:
`imparte` es una tabla histórica que solo se inserta al confirmar (nunca se reescribe un semestre
pasado para "corregirlo" — se corrige hacia adelante), y todo lo relevante (`imparte`, `preferencia`,
`grupo`) ya carga su propio `semestre_id`. La única disciplina operativa que hay que respetar para que
esto siga siendo cierto es **no borrar filas de semestres pasados** — archivar, no eliminar — algo que
vale la pena dejar como convención del equipo desde ya, aunque no se fuerce con un trigger todavía.

### 10.2 Casos adicionales revisados (2026-09-09)

Se estresó el diseño con 4 casos adicionales. Dos se implementaron de inmediato por
ser baratos y estar ya evidenciados con datos reales; dos se dejan documentados como exclusión
deliberada o pregunta abierta, no como hueco accidental.

- **Salón con equipo requerido — IMPLEMENTADO.** `materia.tipo_salon_requerido` + trigger
  `trg_tipo_salon_requerido`. Evidencia real: Cálculo Numérico/Análisis Numérico/Optimización
  Numérica/Matemática Computacional siempre en `RHCC302` (sala de cómputo).
- **Materias anuales — IMPLEMENTADO.** `grupo.continua_de_id` (self-FK, nullable). Decisión confirmada:
  son **dos grupos independientes** de semestres consecutivos, cada uno con su propio `imparte`,
  solo enlazados para reportarlos juntos — no un grupo que abarca dos semestres (eso habría requerido
  que `grupo` dejara de pertenecer a un solo `semestre_id`, un cambio mucho más profundo).
- **Reasignación/cancelación de grupo sin rastro — documentado, NO implementado.** `LE/Procedimiento.pdf`
  ya documenta que un grupo de un profesor de Asignatura puede reasignarse a uno de Tiempo Completo
  durante inscripción. Hoy, mover `imparte_profesor` de un profesor a otro borra la historia de "a
  quién le tocaba antes". Boceto para cuando haga falta (conecta con el score histórico de §10.1):
  ```
  grupo_historial_estado (
      id, grupo_id FK, estado_anterior, estado_nuevo,
      profesor_afectado_id FK NULL, motivo text, cambiado_at timestamptz, cambiado_por FK profesor
  )
  ```
  No se crea todavía porque el flujo real de quién dispara esta reasignación (¿Jefe de Departamento?
  ¿Dirección Escolar?) no está mapeado — ver pregunta abierta #5 de `REQUERIMIENTOS.md` §9.
- **Reposición de clases / oyentes / excepciones de calendario — excluido deliberadamente de V1.**
  `LE/Anexo 1-2` menciona ambos conceptos como parte del proceso real. El esquema actual solo modela un
  patrón semanal recurrente (`dia` + `franja`, sin fecha de calendario), así que una clase de reposición
  en una fecha específica fuera de lo normal no cabe hoy. Se excluye de V1 explícitamente, igual que
  Alumno/inscripción — no es un olvido, es alcance.

### 10.3 Carga del catálogo de materias/demanda (2026-09-21)

Se revisaron directamente `Info servicios escolares/Mat 202603 (1).pdf`, `Act 202603 (1).pdf` y
`Est 202603 (1).pdf` — los tres tienen **exactamente las mismas 15 columnas**: `Clave, Materia, A.T.,
N.I., %Baja, Baja, %Repr., Repr., Prerr., Suma, Cap., 2025, Sug, Cred, Hrs`. Confirmado también:
`Hrs = Sug × Cred / 2` en todas las filas revisadas de los 3 departamentos — es una columna derivada,
no se guarda (ver §9, evitar redundancia mantenida a mano). `Cap.` es constante (30) en los tres
reportes, pero se guarda por fila/semestre en `estimacion_demanda.capacidad_planeacion` por si cambia
más adelante.

**Hallazgo que hay que normalizar al importar:** Matemáticas usa clave con guion (`MAT-10101`);
Actuaría y Estadística **no** (`ACT11300`, `EST10101`) — inconsistencia real de los archivos fuente.
El parser debe normalizar siempre a `{PREFIJO}-#####` (con guion) antes de guardar en
`materia.clave`, usando `departamento.clave_prefijo` para separar prefijo de número cuando no viene
guion.

**Lógica de carga (upsert, no reemplazo ciego):**
1. Por cada fila: buscar `materia` por `clave` normalizada. Si no existe, crear (`nombre`, `creditos`
   desde `Cred`, `departamento_id` según el archivo que se está cargando). Si existe, actualizar
   `nombre`/`creditos` si cambiaron (un mismo curso puede recibir más créditos en un rediseño de plan).
2. Upsert de `estimacion_demanda` por `(materia_id, semestre_id)` con el resto de columnas
   (`alumnos_total`, `nuevo_ingreso`, `pct_baja`, `pct_reprobacion`, `con_prerrequisito`,
   `demanda_ajustada`, `capacidad_planeacion`, `grupos_periodo_anterior`, `grupos_sugeridos`).
   `grupos_sugeridos = 0` se guarda igual (fila válida, no se descarta) — la UI de admin/Jefe debe
   resaltarla, no ocultarla.
3. `mostrar_en_cuestionario` se queda en su default (`true`) al crear; no se toca en cargas
   posteriores de la misma materia/semestre, para no revertir un ocultamiento manual ya hecho por un
   Jefe de Departamento.

**Mecanismo de entrada — recomendado: pegar tabla primero, PDF como mejor esfuerzo.** Pegar (copiar
la tabla desde Excel o desde el visor de PDF y pegarla en un `textarea`, parseada como TSV/columnas
por espacios en el orden ya confirmado arriba) es mucho más confiable que extraer texto de un PDF en
el navegador — los PDFs reales mezclan una tabla de texto y su versión "imagen" en la misma página (se
ve en el PDF revisado), y el layout no está garantizado a mantenerse igual semestre a semestre.
Subir el PDF directo queda como ruta secundaria de "mejor esfuerzo" (extracción de texto + los mismos
separadores), siempre con una vista previa editable antes de confirmar — nunca se escribe a la base
de datos sin que alguien vea la tabla interpretada primero.

**Cómo entra admin/Jefe a esta pantalla — RESUELTO 2026-09-21, sin necesitar herramienta aparte.**
Se definió que Jefe de Departamento/admin deberían iniciar sesión igual que cualquier profesor
(un Jefe también da clases), verificando el rol después del login para desbloquear pestañas
adicionales — no un mecanismo de cuenta separado. Eso llevó a rediseñar `profesor` como la identidad
única para todos los roles (`profesor.rol`, ver §4.1/§4.3) y a escribir políticas RLS
(`materia_escritura_departamento`, `estimacion_demanda_departamento`, `departamento_config_escritura`
en `rls-policies.sql`) que dejan a un Jefe de Departamento autenticado editar el catálogo de **su
propio** departamento, y a admin el de cualquiera — comparando `app_rol()`/`app_profesor_id()` contra
`departamento_id`, sin ninguna herramienta ni login separado. Esto descarta el plan anterior (Edge
Function con secreto compartido simple) — ya no hace falta, el camino "correcto a largo plazo" resultó
ser tan rápido de construir como el atajo.

**CONSTRUIDO 2026-09-29** (ver §13): se sube el PDF en `CargaDemanda.jsx`, el parser corre en el
navegador y `api/demanda.php` hace el upsert. El párrafo de abajo queda como registro.

Seguía pendiente (no de alcance, sino de construcción): la pantalla/parser en sí (pegar tabla → preview
→ upsert) que llame a estas tablas con la sesión ya autenticada del Jefe de Departamento — ver
`motor-asignacion.md` en la copia pública (`malla-horarios/bd/`) para el resumen de qué tabla escribe
qué, aplicable también a esta pantalla de carga de catálogo.

## 11. Archivos de esta carpeta

- [`README.md`](README.md) — índice de la carpeta.
- **`diseno-bd.md`** (este archivo) — el diseño completo.
- [`diagrama-er.md`](diagrama-er.md) — diagrama entidad-relación en Mermaid.
- [`motor-asignacion.md`](motor-asignacion.md) — qué lee y qué escribe el motor de asignación.
- **[`mysql/`](mysql/) — el esquema que corre hoy** (MariaDB 5.5, §14):
  - [`schema-mysql.sql`](mysql/schema-mysql.sql) — DDL, ya en su estado final (incluye todo lo de §15).
  - [`checks-como-triggers.sql`](mysql/checks-como-triggers.sql) — **obligatorio**: MariaDB 5.5
    ignora los `CHECK`, estos triggers hacen su trabajo.
  - [`triggers-mysql.sql`](mysql/triggers-mysql.sql) — las restricciones duras que no caben en un
    CHECK simple (traslapes de profesor/salón, salón autorizado, tipo de salón).
  - [`seed-mysql.sql`](mysql/seed-mysql.sql) — catálogo base: departamentos, las 27 franjas,
    semestres, salones de ejemplo y su disponibilidad.
  - Las migraciones fechadas (`migracion-*.sql`) y los datos reales traducidos (`datos-*.sql`,
    `cargar-profesores.php`): ver [`mysql/README.md`](mysql/README.md) para el orden de cada uno.
- **Postgres, histórico** (el diseño original, antes de la migración):
  [`schema.sql`](schema.sql), [`triggers.sql`](triggers.sql), [`rls-policies.sql`](rls-policies.sql),
  [`seed.sql`](seed.sql). No incluyen los cambios de §15.

La copia de `malla-horarios/bd/` trae solo el esquema y el catálogo base: no lleva las migraciones
ni los datos reales.

## 12. Formulario editable por jefatura (2026-09-28)

Pedido de la jefa de división. El esquema que corre es el de MySQL
(`mysql/schema-mysql.sql`); este documento solo registra el diseño.

**Qué cambió y por qué:**

- **Sin personalización por profesor.** Se eliminan `profesor.modo_materias_elegibles` y
  `profesor_materia_elegible`. Todos los profesores de un departamento ven el mismo formulario,
  para evitar comparaciones entre colegas ("¿por qué a ti te salen otras materias?"). Lo único que
  todavía distingue a un profesor de otro es la **audiencia** de cada sección, que depende del tipo
  de contrato, no de la persona.
- **`cuestionario_seccion`** (nueva): el formulario de un depto/semestre es una lista ordenada de
  secciones de cuatro tipos: `num_cursos`, `materias` (verde/amarillo/rojo),
  `disponibilidad` y `abierta` (pregunta de texto). La jefatura edita títulos, descripciones,
  audiencia (`todos` / `tiempo_completo_medio` / `asignatura`), mínimo de verdes y si una sección
  es de cobertura departamental; agrega y quita secciones de materias y preguntas abiertas. Se
  borra en suave (`activa = 0`) porque las respuestas la referencian.
  **Regla de audiencia:** las materias de una sección que un profesor no ve se agregan a su primera
  sección de materias visible. Así se conserva lo que ya pasaba antes: asignatura veía las de
  cobertura mezcladas en el catálogo.
- **`materia_cuestionario.seccion`** (enum) → **`seccion_id`** (FK, `NULL` = oculta). Sin fila
  sigue siendo fail-open: la materia cae en la primera sección de materias para todos.
- **Publicación:** `departamento_semestre_config.publicado` (+ `publicado_at`, `publicado_por`).
  Sin publicar, el profesor no ve el formulario y el API rechaza guardar.
  `texto_introduccion` es el texto de arriba del formulario (`NULL` = el de siempre).
- **`preferencia_respuesta`** (nueva): respuestas a las preguntas abiertas. Reemplaza a
  `preferencia.horarios_otro_depto` y `observaciones_*`, que quedan obsoletas (sus datos se
  migraron a las preguntas equivalentes).
- **`bloqueo_profesor_materia`** (nueva): la jefatura bloquea pares profesor-materia **después**
  de que contestan, desde la vista de respuestas. Es una capa aparte a propósito: la respuesta del
  profesor no se toca (al desbloquear vuelve a contar tal cual), el profesor nunca la ve, y para
  el motor es **restricción dura** (`motor-asignacion.md`).

**Formas normales:** en las tres tablas nuevas cada atributo no clave depende de toda la clave
(las dos puente, de su PK compuesta; `cuestionario_seccion`, de su id); `cuestionario_seccion` guarda atributos que solo aplican a un tipo
(`minimo_verdes`, `obligatoria`) como `NULL`/0 en los demás, decisión consciente frente a
partir la tabla en cuatro — el formulario se lee siempre completo y en orden.

## 13. Ciclo de semestres y carga de la demanda (2026-09-29)

- **`semestre.estado`** (`activo` | `cerrado`): hay exactamente un semestre activo, el que se
  está planeando. Antes el "actual" era el de id más alto y nada impedía escribir en uno viejo.
  Toda escritura que cuelga de un semestre exige que sea el activo; los cerrados quedan de consulta.
  "Solo uno activo" lo garantiza el API en una transacción (MariaDB 5.5 no tiene índices parciales).
  Lo cambian admin y jefa de división: el semestre es uno solo para los 3 departamentos.
- **Abrir el siguiente semestre** copia, por departamento, el formulario del anterior
  (`cuestionario_seccion`, `materia_cuestionario`, texto e horas de
  `departamento_semestre_config`), sin publicar, y la `salon_disponibilidad_departamento`. No copia
  preferencias, bloqueos ni demanda.
- **Carga de la demanda:** construida como se diseñó en §10.3, con dos hallazgos de los PDF reales
  de 202603. `con_prerrequisito` pasa de entero a `DECIMAL(8,2)` porque Actuaría la trae con
  decimales; y Estadística trae dos materias sin nombre (EST13102, EST24129), que se aceptan
  conservando el nombre del catálogo. El código de periodo del archivo (`202603`) es año + 01
  primavera / 02 verano / 03 otoño, confirmado con el encabezado "Otoño 2026" del PDF de Actuaría.
  Subir la estimación **reemplaza** la anterior del departamento y semestre.

## 14. Migración a MySQL en el servidor del ITAM (2026-09-25)

El sistema dejó el proveedor de base de datos en la nube y GitHub Pages: ahora vive en
`horariosdace.itam.mx`, un servidor del ITAM con **MariaDB 5.5.68 + PHP 7.4**. El navegador ya no le
habla a la base directamente sino a un API propio en PHP. El diseño lógico (tablas, llaves,
relaciones, formas normales) **no cambió**; lo que cambió es cómo se escribe y dónde se protege.

**Seguridad: de RLS a autorización en el API.** MySQL no tiene Row Level Security. Las 38 políticas
de `rls-policies.sql` se volvieron chequeos explícitos en los endpoints (cada uno nombra en su
encabezado la política que reemplaza). Los roles son los mismos de `profesor.rol`, y el alcance se
pregunta por comportamiento ("¿ve todos los departamentos?"), nunca comparando contra el nombre de un
rol. `password_hash` ya no necesita privilegios por columna: solo lo seleccionan dos
endpoints (login y cambio de contraseña), y ninguna respuesta del API lo incluye.

**Lo que MariaDB 5.5 no tiene, y qué se hizo:**

| Falta en 5.5 | Qué se hizo |
|---|---|
| `CHECK` real (llegó en 10.2): se parsea y se **ignora en silencio** | Los `CHECK` se quedan escritos como documentación, pero lo que protege es `checks-como-triggers.sql` (obligatorio) más la validación en PHP |
| Columnas calculadas con la sintaxis usual | `semestre.etiqueta` deja de ser columna; se arma al leerla |
| Tipo `JSON` | `imparte.overrides` es `LONGTEXT` (vacía hoy) |
| Varios `TIMESTAMP` automáticos por tabla | `imparte.updated_at` es el automático (`ON UPDATE CURRENT_TIMESTAMP`); `created_at` lo escribe la aplicación. Todas las fechas se guardan en UTC |
| Índices parciales | "un solo semestre activo" lo garantiza el API en una transacción |

**Traducciones mecánicas:** los enums de Postgres pasan a `ENUM(...)` en cada columna (agregar un
valor obliga a un `ALTER` por tabla); `text` con `UNIQUE` pasa a `VARCHAR(191)` por el tope de índice
de InnoDB con utf8mb4; todo es `utf8mb4_unicode_ci`.

**Un bug que la traducción hizo visible:** `materia_prerequisito` y `materia_equivalencia` tenían
`plan_estudio_id` nullable ("aplica en todos los planes") **dentro de la llave primaria**. Ningún
motor admite NULL en una PK, así que esas filas nunca se pudieron guardar. En MySQL se arregló con un
`id` propio más `UNIQUE (…, plan_estudio_id)`. Salvedad: el `UNIQUE` admite varios NULL, así que no
impide dos filas "aplica a todos" idénticas. El `schema.sql` de Postgres sigue con el bug.

**Tabla nueva:** `intento_login` (§6). Antes el límite de intentos vivía en memoria de la Edge
Function; PHP no conserva estado entre peticiones.

## 15. Cambios del 2026-10-02 y 2026-10-06

Todos ya están en `mysql/schema-mysql.sql` y en `mysql/seed-mysql.sql`. En una base que ya existía
se aplicaron como migraciones aditivas, antes de desplegar el API que las lee.

**2026-10-02**

- **Correo del profesor.** `profesor.correo` (nueva). Primero opcional; el mismo día pasó a
  **UNIQUE** y obligatorio en el API (registro y "Mi perfil"), porque con él se recupera la
  contraseña. La base sigue admitiendo NULL para el roster que todavía no lo captura: a esas personas
  la app les pide el correo al entrar.
- **Recuperar la contraseña.** Tabla `recuperacion_password` (§6): el profesor pide un enlace con su
  correo, el enlace lleva un token de un solo uso que vence en una hora, y en la base solo queda el
  hash del token.
- **"Número de cursos" es opcional** (deshecho el 2026-10-13, §17). La jefatura puede quitar esa sección de su formulario, así que
  `preferencia.num_cursos_max` acepta NULL. El trigger que valida el rango 1–6 deja pasar el NULL y
  sigue rechazando 0, 7, etc.
- **Franja 14:00–14:30 solo martes y jueves.** `franja_horaria.dias` (nueva, NULL = todos los días).
  Excepción acotada a RN05, pedida para todos los departamentos. Se insertó en el lugar 15 del orden
  (las de la tarde bajaron una posición) con su disponibilidad de salones solo martes y jueves.
- **Alcance de la jefatura de división.** Temporalmente, `jefe_division` ve solo su propio
  departamento (Matemáticas) y conserva el manejo de semestres. Es una regla del API, no del esquema.

**2026-10-06**

- **Franjas 20:00–22:00 solo para Estadística.** `franja_horaria.departamento_id` (nueva, NULL = todos
  los departamentos). Cuatro franjas nuevas (orden 24 a 27) con el id de Estadística, y disponibilidad
  de salones solo para ese departamento. Matemáticas y Actuaría siguen terminando a las 20:00. Esto
  matiza el "tope a las 20:00" de §3: el tope sigue para dos departamentos, no para los tres.
- **Claves nuevas de Matemáticas** (Optimización Numérica I y II, Investigación de Operaciones I).
  Es un cambio de datos que usa el patrón de alias de `materia_cuestionario` (ver el ejemplo en §6);
  no cambia el esquema.

## 16. Cambios del 2026-10-12 y 2026-10-13: decisiones de la jefatura antes del motor

Ya están en `mysql/schema-mysql.sql`. En la base que corre se aplicaron
el 2026-10-12/13 como migraciones aditivas, antes de desplegar el API que las lee (`migracion-2026-10-12-ajuste-num-cursos.sql`,
`migracion-2026-10-13-asignaciones-fijas.sql` y `migracion-2026-10-13b-asignacion-maestria.sql`). Las
tres siguen el patrón de `bloqueo_profesor_materia` (§12): **lo que decide la jefatura va en una
tabla propia**, encima de lo que contestó el profesor, sin tocarlo y sin que él lo vea. Decisiones
D33–D35 de `GUIA-DECISIONES.md`.

- **Ajuste del número de cursos** (`ajuste_num_cursos`, D33). Desde Respuestas y bloqueos. Para el
  motor manda el ajuste: `COALESCE(ajuste_num_cursos.num_cursos, preferencia.num_cursos_max)`.
  Admite 0, que el profesor no puede pedir. Rango validado con triggers (MariaDB 5.5 ignora el
  `CHECK`) y en el API. *Nota: el editor SQL de phpMyAdmin marca como error un `CONSTRAINT … CHECK`
  dentro de un `CREATE TABLE`, así que la migración lo omite; el `schema-mysql.sql` lo conserva
  como los demás.*
- **Asignaciones directas** (`asignacion_fija` + `asignacion_fija_horario`, D34). Restricción dura
  que el motor coloca primero y que **manda sobre la disponibilidad**. Las reglas que cruzan filas o
  tablas no las fuerza la base sino `api/asignaciones.php`: el horario suma `materia.creditos`, la
  franja vale para ese día y departamento, no hay choque con otra fija del mismo profesor (en
  cualquier departamento), y no se fija un par bloqueado.
- **Materia de Maestría** (`asignacion_fija.tipo = 'maestria'`, D35). Las materias de maestría (MCD,
  MR) no están en el catálogo del departamento. Se modelan como un tipo de asignación fija **sin
  `materia_id`**, no como una fila "dummy" en `materia`: una materia sin fila en
  `materia_cuestionario` aparece por omisión en el formulario de todos los profesores (fail-open,
  §12), y además saldría en el catálogo, la demanda y los reportes. Su horario es obligatorio y no se
  ata a créditos; para el motor son horas ocupadas del profesor (como rojo) y **no cuentan como
  curso**. Por la falta de `materia_id`, el departamento de una asignación fija pasó a ser columna
  propia (`departamento_id`).

## 17. Cambio del 2026-10-13 (c): el mínimo de horas en verde sale de los cursos

Ya está en `mysql/schema-mysql.sql`; en la base que corre se aplica con
`migracion-2026-10-13c-horas-minimas-por-cursos.sql`, antes de desplegar el API que lo lee.
Decisiones D40–D42 de `GUIA-DECISIONES.md`.

- **Mínimo calculado, no fijo** (D40). `departamento_semestre_config.horas_minimas_verde` (10 h para
  todos) queda obsoleta. El mínimo para enviar se calcula con lo que contesta el profesor: 3 h por
  curso que pidió (`num_cursos_max`, no el ajuste de la jefatura), más lo que su materia **verde**
  más larga pase de 3 h (una de 8 créditos son 4 h: +1, una sola vez), por el ratio de su contrato y
  hacia arriba a la media hora. Las amarillas no cuentan. No es columna: se calcula al validar
  (`horas_minimas_verde()` en `api/lib/catalogo.php`), y por eso el cuestionario manda los créditos
  de cada materia.
- **`ratio_horas_verde`** (nueva en `departamento_semestre_config`, `DECIMAL(4,2)`, 1.00 por
  omisión). Lo pone la jefatura en el editor y aplica a tiempo completo y medio tiempo; asignatura
  siempre va con 1. El rango 1–5 lo cuida el API (no hay trigger: entra por la pantalla de la
  jefatura, como antes las horas). Se copia al abrir semestre.
- **"Número de cursos" vuelve a ser fija** (D41), porque de ella sale el mínimo: exactamente una
  sección `num_cursos` por formulario, que la migración agrega a los del semestre activo que no la
  tienen y el API agrega a uno que le falte. `preferencia.num_cursos_max` sigue admitiendo NULL
  por las preferencias guardadas cuando era opcional.
- **Sin cambio de datos en la rejilla** (D42): la celda sin marcar ya contaba como rojo (D37); ahora
  además se ve en rojo claro en el formulario.

## 18. Cambio del 2026-10-19: profesores sin cuenta y la programación de Actuaría

Ya está en `mysql/schema-mysql.sql`; en la base que corre se aplica con
`migracion-2026-10-19-profesor-sin-cuenta.sql` y, encima, `datos-actuaria-primavera-2027-mysql.sql`.
Decisión D45 de `GUIA-DECISIONES.md`.

- **El problema.** Actuaría no usa el sistema: sus profesores no contestan el formulario y su
  jefatura entrega la programación ya hecha (para Primavera 2027, `DACE/Actuaria/
  PROGRAMACIÓNPRIM2027.pdf`). Esa programación es fija y tiene que salir en la malla, y el motor
  tiene que respetarla: un grupo de Actuaría puede ser espejo de una clave de Matemáticas
  (ACT-11310 / MAT-22600) o darlo un profesor de Estadística (ACT-25354 001, Rojas Nandayapa).
- **Se registra como grupos publicados**, en las tablas de siempre (`grupo`, `imparte`,
  `imparte_profesor`, `imparte_co_oferta`, `imparte_horario`), no en una tabla aparte: así la malla
  lee de un solo lugar, el motor la recibe en `grupos_fijos` (o como `ocupado` del profesor si la
  descarga no incluye Actuaría) y ninguna subida la reemplaza. Sin CRN y sin salón (el PDF no los
  trae), por eso en `'en_asignacion'`, como lo que escribe el motor en modo sin salones (D44).
- **Profesor sin cuenta.** `imparte_profesor` pide un `profesor_id`, así que los profesores de
  Actuaría necesitan una fila en `profesor` aunque nunca entren: `cu` y `password_hash` NULL (no
  puede entrar: el login busca por `cu`), `activo = 0` y `tipo_contrato` NULL. Con eso quedan fuera
  de todo lo demás sin tocar el API: paneles, reportes, respuestas, asignaciones directas y el
  paquete del motor filtran `activo = 1 AND tipo_contrato IS NOT NULL`. `cu` sigue `UNIQUE` (varios
  NULL caben). Si uno de ellos se registra después con su CU, queda una fila nueva: hay que mover sus
  `imparte_profesor` a esa fila y borrar la sin cuenta. Un profesor de Actuaría que ya tenga cuenta
  en otro departamento (Rojas Nandayapa) usa su fila de siempre.
- **El motor** (`api/lib/motor.php`): en `grupos_fijos` solo van los profesores que vienen en
  `profesores[]` (convención §3.7), y la regla "la franja vale para ese día y departamento" ya no se
  aplica a los grupos publicados, solo a lo que propone el motor: ACT-22306/22320 002 va LU-MI de
  20:30 a 22:00, franjas que la rejilla tiene solo para Estadística (D32 es una restricción del
  formulario, no del departamento). Además, un grupo publicado sin ninguna clave del departamento
  del profesor no cuenta para su número de cursos: solo le aparta las horas (Rojas Nandayapa pidió
  1 curso en Estadística y lo sigue teniendo pendiente aunque dé ACT-25354).

## 19. Cambio del 2026-10-21: el semestre de cada materia (planes de estudio)

Ya está en `mysql/schema-mysql.sql`; en la base que corre se aplica con
`migracion-2026-10-21-plan-estudio-clave.sql` y, encima, `datos-planes-estudio-mysql.sql`.

- **La fuente.** `DACC/MATERIAS/WEB/planesOracle.csv`, el export de Oracle de los planes de
  licenciatura que usa el proyecto de DACC: una fila por carrera + versión de plan + materia, con
  su semestre (1-12). Un plan es carrera + versión, y eso es `plan_estudio.clave` (`'ACT-H'`).
- **Los PDFs nuevos** de `DACE/Planes de estudio/` (Actuaría y Matemáticas Aplicadas, marzo 2025)
  son ACT-H y M.A-F del export: coinciden materia por materia y semestre por semestre. Sus
  tarjetas "Optativa" no tienen clave y no se cargan.
- **Todas las carreras y todas las versiones** (decisión de la usuaria). Las materias de DACE
  están en 231 planes de 89 carreras, no solo en los de Actuaría y Matemáticas Aplicadas (Cálculo
  Univariado va en 1o en las ingenierías y en 2o en Actuaría). Entre versiones, en las carreras de
  DACE el plan nuevo cambia sobre todo *qué* materias se llevan (Actuaría G→H: 11 claves MAT/EST/ACT
  comunes, 16 nuevas, 22 que salen), y las que salen siguen en la base y se siguen dando a los
  alumnos de plan viejo (MAT-14100, MAT-22600, EST-14101, ACT-15352). Con solo la versión más nueva,
  8 claves se quedaban sin semestre. `activo` marca la más nueva.
- **No da de alta materias.** La carga cruza por clave con `materia`; lo que no está, se
  descarta, y no se crea un plan sin ninguna materia en la base.
- **Generado por script** (`generar-planes-estudio.py`): es el único archivo de datos que no se
  escribe a mano, por tamaño (≈2,700 filas). Idempotente: repetirlo corrige semestres y vigencia.
- **Todavía no lo usa nadie.** El motor recibe `planes` en el paquete (`api/lib/motor.php`), con
  todas las versiones, pero no evita empalmes por semestre (RN01, §10). Cuando se implemente,
  hay que decidir si va solo con los planes `activo` o con todos.
