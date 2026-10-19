# Guía para el motor de asignación (profesores–horarios–salones)

> Para quien construya el algoritmo que decide profesor+horario+salón por grupo. Ver
> [`diseno-bd.md`](diseno-bd.md) para el detalle completo de cada tabla y [`diagrama-er.md`](diagrama-er.md)
> para el diagrama. Este documento responde una sola pregunta: **qué leer (input) y qué escribir
> (output), en qué tablas, y qué reglas hay que respetar al escribir.**
>
> La base que corre es **MySQL (MariaDB 5.5)** en el servidor del ITAM desde 2026-09-25: el DDL está en
> [`mysql/schema-mysql.sql`](mysql/schema-mysql.sql) y los triggers en
> [`mysql/triggers-mysql.sql`](mysql/triggers-mysql.sql) y
> [`mysql/checks-como-triggers.sql`](mysql/checks-como-triggers.sql).

## 1. Qué lee el motor (input)

| Tabla | Para qué |
|---|---|
| `estimacion_demanda` | `grupos_sugeridos` dice cuántos `grupo` debe haber por materia/semestre — es el punto de partida. Desde 2026-09-29 la cargan los jefes desde la app (PDF de Servicios Escolares → `api/demanda.php`). |
| `semestre` | `estado = 'activo'` es el semestre que se está planeando (hay exactamente uno): el motor trabaja sobre ese. |
| `materia`, `plan_estudio_materia`, `materia_prerequisito`, `materia_co_oferta`, `materia_equivalencia` | Catálogo académico: créditos (cuántos bloques de 30 min necesita cada grupo), seriación, qué materias son la misma clase con otra clave (co-oferta), tipo de salón que exige (`materia.tipo_salon_requerido`). |
| `profesor` | Roster: `departamento_id`, `tipo_contrato` (tiempo_completo asigna por curso, asignatura por hora — RN04). Desde 2026-09-28 ya no hay lista personalizada de materias por profesor (`modo_materias_elegibles` se eliminó): todos los de un departamento contestan el mismo formulario. |
| `preferencia`, `preferencia_materia`, `disponibilidad` | Lo que declaró cada profesor para el semestre. **`disponibilidad` es restricción DURA** (el profesor dijo que no puede en rojo — no asignar ahí). **`preferencia_materia` es BLANDA** (ranking de materias deseadas — el motor debe intentar maximizarla, no es obligatoria de cumplir al 100%). |
| `bloqueo_profesor_materia` | **Restricción DURA** (2026-09-28): la jefatura decidió que ese profesor NO da esa materia ese semestre. Nunca asignarlo, sin importar lo que haya contestado en `preferencia_materia` (esa respuesta se conserva intacta debajo del bloqueo). |
| `ajuste_num_cursos` | (2026-10-12) La jefatura sobreescribió el número de cursos que pidió el profesor (desde Respuestas y bloqueos). **Si hay fila, ese número manda** sobre `preferencia.num_cursos_max`: `COALESCE(ajuste_num_cursos.num_cursos, preferencia.num_cursos_max)`. Puede ser **0** = este semestre no se le asignan cursos. |
| `asignacion_fija`, `asignacion_fija_horario` | **Restricción DURA** (2026-10-13): asignaciones directas que la jefatura fijó antes de correr el motor. Cada fila de `asignacion_fija` es **un grupo**: tiene que existir un grupo de esa `materia_id` con ese `profesor_id`. Si la fila tiene horario en `asignacion_fija_horario`, ese grupo va **exactamente** en esos bloques (ya suman `materia.creditos` y no chocan entre sí para el mismo profesor; lo valida `api/asignaciones.php`). Sin horario, el motor elige cuándo. El salón siempre lo elige el motor. **`tipo = 'maestria'`** (sin `materia_id`): materia de maestría que no está en el catálogo; **no es un grupo que crear**, solo aparta esas horas del profesor. Ver §3. |
| `preferencia_respuesta` | Respuestas a las preguntas abiertas del formulario (una fila por sección `abierta`). Texto libre para que lo lea la jefatura; el motor no lo interpreta. Reemplaza a `preferencia.horarios_otro_depto` / `observaciones_*`, que quedaron obsoletas. |
| `departamento_semestre_config` | `ratio_horas_verde` (2026-10-13): con él se calcula el mínimo de horas en verde que el profesor tuvo que marcar para enviar (3 h por curso pedido, +1 h si tiene en verde una de 8 créditos, × ratio para tiempo completo y medio tiempo). Es una regla de envío, no del motor: el motor no tiene que volver a validarla. `horas_minimas_verde` quedó obsoleta. `publicado` dice si el formulario ya estaba abierto. (`mostrar_seleccion_materias` quedó obsoleta: un departamento que no captura materias simplemente no tiene secciones de materias en `cuestionario_seccion`, y el motor solo tiene `disponibilidad` como input de ese departamento.) |
| `cuestionario_seccion`, `materia_cuestionario` | Qué materias vio cada departamento en su formulario y en qué sección. `cuestionario_seccion.cobertura_departamental` marca las secciones de cursos departamentales; ya viene copiado a `preferencia_materia.cobertura_departamental`. |
| `franja_horaria` | Catálogo fijo de bloques de 30 min (07:00–14:00 y 16:00–20:00, Lun–Vie) — el universo de horarios posibles. **Dos excepciones** (2026-10-02 y 2026-10-06): `dias` limita una franja a ciertos días (14:00–14:30 solo martes y jueves) y `departamento_id` la limita a un departamento (20:00–22:00 solo Estadística). NULL en cualquiera de las dos = sin límite. Un grupo solo puede caer en una franja que valga para ese día y para el departamento de su materia. |
| `salon`, `salon_disponibilidad_departamento` | Salones y qué departamento puede usar cuál, qué día/franja, cada semestre. |
| `grupo` | Estado actual (`demanda`/`en_asignacion`/`asignado`/`cancelado`), `cupo_maximo`. |
| `imparte`, `imparte_profesor`, `imparte_horario`, `imparte_co_oferta` | Lo ya asignado — tanto de semestres anteriores (para balancear carga histórica, ver `diseno-bd.md` §10.1) como lo que el propio motor ya escribió en la corrida actual. |

## 2. Qué escribe el motor (output)

En este orden, por cada `grupo`:

1. **`grupo.estado`** — mover de `demanda` a `en_asignacion` cuando el motor empieza a trabajarlo, a
   `asignado` cuando ya tiene profesor+horario+salón completos y válidos.
2. **`imparte`** — crear UNA fila (`grupo_id` único, 1:1). Usar `overrides` (JSON guardado como texto) solo para
   excepciones puntuales, no para datos que ya tienen su propia columna en otra tabla.
3. **`imparte_profesor`** — una fila por profesor asignado a ese `imparte` (casi siempre uno; puede
   ser más de uno si hay co-titularidad, confirmado con datos reales).
4. **`imparte_horario`** — una fila por cada bloque de 30 min que el grupo ocupa (día + franja +
   salón). **El número de filas debe igualar `materia.creditos`**: 1 crédito = media hora = 1 bloque (un grupo de 6 créditos ocupa 6 bloques, 3 h por semana; confirmado 2026-10-09 con la columna Hrs del PDF de demanda) (ver `fn_validar_creditos_imparte`
   en `mysql/triggers-mysql.sql` — es una función de validación, no un trigger automático; hay que llamarla antes
   de marcar el grupo como `asignado`, porque a medio construir el horario la suma todavía no cierra).
5. **`imparte_co_oferta`** — solo si el grupo es co-oferta de otro (`materia_co_oferta` lo indica en
   el catálogo): una fila con el `%` de responsabilidad real.
6. **`grupo.publicado`** — lo pone en `true` quien confirme la malla para publicarla (probablemente el
   Jefe de Departamento desde su vista, no el motor automáticamente) — antes de eso, RN09 dice que el
   salón todavía se puede reajustar sin restricción.

## 3. Reglas que el motor debe respetar

### Ya se validan solas (la base de datos las rechaza con un error si se violan)

No hace falta volver a chequearlas en el algoritmo, pero **sí conviene evitar generarlas** para no
gastar intentos en combinaciones que la base va a rechazar (ver `mysql/triggers-mysql.sql`):

- Un profesor no puede tener dos `imparte_horario` al mismo día/franja en el mismo semestre.
- Un salón no puede tener dos `imparte_horario` al mismo día/franja en el mismo semestre (RN02).
- El salón asignado debe estar autorizado para el departamento del grupo ese día/franja/semestre
  (`salon_disponibilidad_departamento`). **Hoy no hay salones** (2026-10-13): los 7 de ejemplo del
  seed, que tenían acceso compartido de los 3 departamentos, se borraron
  (`mysql/limpieza-2026-10-13-salones-ejemplo.sql`). Hasta que se carguen los reales, el motor
  corre en modo sin salones (D44): `imparte_horario.salon_id` NULL y estos chequeos se saltan.
- Si `materia.tipo_salon_requerido` no es NULL, el salón debe ser de ese `tipo` exacto.
- La rejilla `franja_horaria` ya hace estructuralmente imposible asignar 14:00–16:00 (comida, RN05,
  salvo 14:00–14:30 martes y jueves) o después de las 20:00 (salvo Estadística, hasta las 22:00).

### El motor tiene que validarlas él mismo (la base de datos no las fuerza)

- **Suma de créditos** (`fn_validar_creditos_imparte`) — llamarla antes de dar por armado un grupo.
- **Tope de horas de Asignatura**: ≤10 hrs/semana por profesor, sumado **entre departamentos** (RN03)
  — hay que sumar `imparte_horario` de TODOS los departamentos donde ese profesor tenga clase ese
  semestre, no solo el propio.
- **Asignación por tipo de contrato** (RN04): Tiempo Completo se piensa por número de cursos
  (`preferencia.num_cursos_max`, o `ajuste_num_cursos.num_cursos` si la jefatura lo ajustó), Asignatura por horas. **`num_cursos_max` puede ser NULL** en
  preferencias guardadas del 2026-10-02 al 2026-10-13, cuando la jefatura podía quitar esa pregunta de su
  formulario. NULL = "no lo dijo", no "cero". Desde el 2026-10-13 la pregunta es fija y el API exige 1–6.
- **Sin medias horas sueltas** (RN06) — no dejar huecos de 30 min aislados en el día de un profesor o
  un salón.
- **Cupo de salón vs. tamaño de grupo**: `grupo.cupo_maximo <= salon.capacidad`.
- **Bloqueos de jefatura**: nunca asignar un par profesor-materia que esté en
  `bloqueo_profesor_materia` para ese semestre.
- **Asignaciones fijas de jefatura** (`asignacion_fija`): se colocan **primero** y no se mueven. Por
  cada fila, un grupo de esa materia con ese profesor (y en esos bloques, si trae
  `asignacion_fija_horario`); cuentan para sus cursos, sus horas y los `grupos_sugeridos` de la materia.
  Mandan sobre la disponibilidad: la jefatura puede fijar a alguien en una hora que marcó en rojo (la
  vista se lo advierte, pero la decisión es suya), así que el motor **no** debe descartar una fija por
  eso. Lo que sí es imposible ya lo rechaza el API: una fija sobre un par bloqueado, horarios que no
  sumen los créditos o que choquen entre fijas del mismo profesor. Si hay más fijas que
  `grupos_sugeridos`, se respetan todas (la jefatura abrió un grupo más).
- **Materia de Maestría** (`asignacion_fija.tipo = 'maestria'`, 2026-10-13): **no** se crea grupo ni
  `imparte`. Sus bloques de `asignacion_fija_horario` son horas **ocupadas** del profesor: tratarlas
  como `rojo` (no asignarle nada ahí). **No cuenta como curso**: si pidió 1 curso y tiene una de
  maestría, todavía hay que asignarle 1. Tampoco cuenta para `grupos_sugeridos` ni para el tope de
  horas de asignatura del departamento. Siempre trae horario; no está atado a créditos.
- **Disponibilidad dura**: nunca asignar un bloque marcado `rojo` en `disponibilidad` para ese
  profesor. Una celda **sin fila** en `disponibilidad` es "sin respuesta" (el profesor no la marcó; por
  ejemplo, contestó antes de que existieran las franjas de 20:00–22:00). No es verde. **Cuenta como rojo**
  (decidido 2026-10-09): no asignar ahí. `amarillo` es "posible pero complicado" — evitarlo si hay alternativa en `verde`, no es un
  bloqueo absoluto.

### Objetivo a maximizar, no restricción a cumplir siempre

- **`preferencia_materia`** (verde/amarillo/rojo por materia) — el motor debe preferir asignar
  profesores a materias donde marcaron verde, pero no es un error si no se puede siempre.
- **Balance de carga histórica** — `diseno-bd.md` §10.1 deja pensado (no construido todavía) un
  `historial_score_asignacion` para esto; mientras no exista, se puede aproximar consultando
  `imparte`/`imparte_horario` de semestres anteriores directamente.

## 4. Con qué credenciales corre el motor

El motor **no** corre en el navegador del profesor ni del Jefe de Departamento — es un proceso propio
(script, job, backend). Desde la migración a MySQL ya no hay RLS: la autorización vive en el API en
PHP. **Decidido (D39, D43): el motor no toca la base ni tiene credenciales.** Se corre aparte sobre
el JSON que baja `api/motor-entrada.php`, y su resultado lo sube `api/motor-salida.php`, que lo
valida (§5 de la convención) y lo escribe en `grupo`/`imparte`/`imparte_profesor`/
`imparte_horario`/`imparte_co_oferta` sin publicar. Los dos endpoints son **solo de admin** por
ahora (pestaña "Datos para el motor"); abrirlos a la jefatura de su departamento es cambiar
`exigir_rol` y mostrar la tarjeta.

Cómo escribe la subida (2026-10-13, `api/lib/motor.php`):

- `grupo.crn` queda **NULL**: el CRN lo da Servicios Escolares después.
- **Grupo espejo**: un `grupo` + `imparte` por clave, ligados en `imparte_co_oferta` (los dos
  sentidos), con el mismo profesor y horario. El vínculo se inserta **antes** que el horario: el
  procedimiento de `imparte_horario` lo usa para no tomar la otra clave como traslape.
- **Modo sin salones** (D44): `imparte_horario.salon_id` puede ser NULL y el grupo queda
  `en_asignacion`. Con profesor + horario + salón queda `asignado`.
- **Al volver a subir** se borran los grupos sin publicar del alcance (y sus espejos de otros
  departamentos); los publicados nunca se tocan y van al motor como `grupos_fijos`.

## 5. Qué NO existe todavía (para no asumir que sí)

- El motor se conecta por archivos (§4), no corre dentro del sistema. Existe un **motor v0** (`optV0/` en el repo del servicio
  social `malla-horarios`, 2026-10-11) que no lee la base: trabaja sobre los archivos JSON de
  `docs/convencion-datos-motor.md` de ese mismo repo (versión 1 del 2026-10-09; versión 2 del
  2026-10-13, con la Materia de Maestría como horas en rojo, el ajuste de cursos ya resuelto en
  `num_cursos_max` y el campo nuevo `asignaciones_fijas`, ver su §3.9). Este documento dice de qué
  tablas sale cada dato y a cuáles se escribe; la convención, el formato de los archivos.
- optV0 todavía lee y escribe la **versión 1**; el sistema ya solo habla la 2. Hasta que se
  actualice (lista en `optV0/README.md`), su salida se rechaza al subirla.
- No hay vista de malla: lo subido queda en la base sin publicar. Tampoco hay vista para cargar
  salones; mientras tanto se corre en modo sin salones (D44).
- No existe la protección de secuencias entre materias seriadas (RN01, "cálculos seriados a la misma
  hora") — es una idea a futuro, no una regla que el motor deba imponer todavía.
- El scoring/balance histórico (§3, último punto) no tiene tabla propia todavía, solo el boceto de
  `diseno-bd.md` §10.1.
