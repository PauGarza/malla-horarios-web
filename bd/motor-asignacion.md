# Guía para el motor de asignación (profesores–horarios–salones)

> Para quien construya el algoritmo que decide profesor+horario+salón por grupo. Ver
> [`diseno-bd.md`](diseno-bd.md) para el detalle completo de cada tabla y [`diagrama-er.md`](diagrama-er.md)
> para el diagrama. Este documento responde una sola pregunta: **qué leer (input) y qué escribir
> (output), en qué tablas, y qué reglas hay que respetar al escribir.**

## 1. Qué lee el motor (input)

| Tabla | Para qué |
|---|---|
| `estimacion_demanda` | `grupos_sugeridos` dice cuántos `grupo` debe haber por materia/semestre — es el punto de partida. |
| `materia`, `plan_estudio_materia`, `materia_prerequisito`, `materia_co_oferta`, `materia_equivalencia` | Catálogo académico: créditos (cuántos bloques de 30 min necesita cada grupo), seriación, qué materias son la misma clase con otra clave (co-oferta), tipo de salón que exige (`materia.tipo_salon_requerido`). |
| `profesor` | Roster: `departamento_id`, `tipo_contrato` (tiempo_completo asigna por curso, asignatura por hora — RN04), `modo_materias_elegibles`. |
| `preferencia`, `preferencia_materia`, `disponibilidad` | Lo que declaró cada profesor para el semestre. **`disponibilidad` es restricción DURA** (el profesor dijo que no puede en rojo — no asignar ahí). **`preferencia_materia` es BLANDA** (ranking de materias deseadas — el motor debe intentar maximizarla, no es obligatoria de cumplir al 100%). |
| `departamento_semestre_config` | `horas_minimas_verde` (umbral de validez de una preferencia — ver checklist de envío) y `mostrar_seleccion_materias` (si un departamento no captura preferencia de materias, el motor solo tiene `disponibilidad` de ese departamento como input, no ranking de materias). |
| `franja_horaria` | Catálogo fijo de bloques de 30 min (07:00–14:00 y 16:00–20:00, Lun–Vie) — el universo de horarios posibles. |
| `salon`, `salon_disponibilidad_departamento` | Salones y qué departamento puede usar cuál, qué día/franja, cada semestre. |
| `grupo` | Estado actual (`demanda`/`en_asignacion`/`asignado`/`cancelado`), `cupo_maximo`. |
| `imparte`, `imparte_profesor`, `imparte_horario`, `imparte_co_oferta` | Lo ya asignado — tanto de semestres anteriores (para balancear carga histórica, ver `diseno-bd.md` §10.1) como lo que el propio motor ya escribió en la corrida actual. |

## 2. Qué escribe el motor (output)

En este orden, por cada `grupo`:

1. **`grupo.estado`** — mover de `demanda` a `en_asignacion` cuando el motor empieza a trabajarlo, a
   `asignado` cuando ya tiene profesor+horario+salón completos y válidos.
2. **`imparte`** — crear UNA fila (`grupo_id` único, 1:1). Usar `overrides` (jsonb) solo para
   excepciones puntuales, no para datos que ya tienen su propia columna en otra tabla.
3. **`imparte_profesor`** — una fila por profesor asignado a ese `imparte` (casi siempre uno; puede
   ser más de uno si hay co-titularidad, confirmado con datos reales).
4. **`imparte_horario`** — una fila por cada bloque de 30 min que el grupo ocupa (día + franja +
   salón). **La suma de filas × 0.5 debe igualar `materia.creditos`** (ver `fn_validar_creditos_imparte`
   en `triggers.sql` — es una función de validación, no un trigger automático; hay que llamarla antes
   de marcar el grupo como `asignado`, porque a medio construir el horario la suma todavía no cierra).
5. **`imparte_co_oferta`** — solo si el grupo es co-oferta de otro (`materia_co_oferta` lo indica en
   el catálogo): una fila con el `%` de responsabilidad real.
6. **`grupo.publicado`** — lo pone en `true` quien confirme la malla para publicarla (probablemente el
   Jefe de Departamento desde su vista, no el motor automáticamente) — antes de eso, RN09 dice que el
   salón todavía se puede reajustar sin restricción.

## 3. Reglas que el motor debe respetar

### Ya se validan solas (la base de datos las rechaza con un error si se violan)

No hace falta volver a chequearlas en el algoritmo, pero **sí conviene evitar generarlas** para no
gastar intentos en combinaciones que la base va a rechazar (ver `triggers.sql`):

- Un profesor no puede tener dos `imparte_horario` al mismo día/franja en el mismo semestre.
- Un salón no puede tener dos `imparte_horario` al mismo día/franja en el mismo semestre (RN02).
- El salón asignado debe estar autorizado para el departamento del grupo ese día/franja/semestre
  (`salon_disponibilidad_departamento`) — en V1 esto no filtra nada porque el `seed.sql` da acceso
  compartido a los 3 departamentos, pero puede volverse restrictivo más adelante.
- Si `materia.tipo_salon_requerido` no es NULL, el salón debe ser de ese `tipo` exacto.
- La rejilla `franja_horaria` ya hace estructuralmente imposible asignar 14:00–16:00 (comida, RN05) o
  después de las 20:00.

### El motor tiene que validarlas él mismo (la base de datos no las fuerza)

- **Suma de créditos** (`fn_validar_creditos_imparte`) — llamarla antes de dar por armado un grupo.
- **Tope de horas de Asignatura**: ≤10 hrs/semana por profesor, sumado **entre departamentos** (RN03)
  — hay que sumar `imparte_horario` de TODOS los departamentos donde ese profesor tenga clase ese
  semestre, no solo el propio.
- **Asignación por tipo de contrato** (RN04): Tiempo Completo se piensa por número de cursos
  (`preferencia.num_cursos_max`), Asignatura por horas.
- **Sin medias horas sueltas** (RN06) — no dejar huecos de 30 min aislados en el día de un profesor o
  un salón.
- **Cupo de salón vs. tamaño de grupo**: `grupo.cupo_maximo <= salon.capacidad`.
- **Disponibilidad dura**: nunca asignar un bloque marcado `rojo` en `disponibilidad` para ese
  profesor. `amarillo` es "posible pero complicado" — evitarlo si hay alternativa en `verde`, no es un
  bloqueo absoluto.

### Objetivo a maximizar, no restricción a cumplir siempre

- **`preferencia_materia`** (verde/amarillo/rojo por materia) — el motor debe preferir asignar
  profesores a materias donde marcaron verde, pero no es un error si no se puede siempre.
- **Balance de carga histórica** — `diseno-bd.md` §10.1 deja pensado (no construido todavía) un
  `historial_score_asignacion` para esto; mientras no exista, se puede aproximar consultando
  `imparte`/`imparte_horario` de semestres anteriores directamente.

## 4. Con qué credenciales corre el motor

El motor **no** corre en el navegador del profesor ni del Jefe de Departamento — es un proceso propio
(script, job, backend). `grupo`/`imparte`/`imparte_profesor`/`imparte_horario`/`imparte_co_oferta`
tienen RLS activado sin política de escritura para una sesión normal autenticada (ver
`rls-policies.sql`, sección final) — el motor necesita correr con la clave de administrador de la base
de datos (equivalente a `service_role`), no con el JWT de un profesor. Esa clave nunca debe vivir en
código que termine en el frontend público.

## 5. Qué NO existe todavía (para no asumir que sí)

- No hay motor de asignación implementado — este documento es la especificación de la interfaz de
  datos que va a usar, no el algoritmo en sí.
- No hay política de escritura para Jefe de Departamento sobre `grupo`/`imparte`/`imparte_horario`
  (sí para el catálogo — `materia`/`estimacion_demanda`/`departamento_semestre_config`, ver
  `rls-policies.sql`). Cuando el motor exista y alguien deba correrlo desde una vista con sesión de
  Jefe de Departamento en vez de un script aparte, faltará esa política.
- No existe la protección de secuencias entre materias seriadas (RN01, "cálculos seriados a la misma
  hora") — es una idea a futuro, no una regla que el motor deba imponer todavía.
- El scoring/balance histórico (§3, último punto) no tiene tabla propia todavía, solo el boceto de
  `diseno-bd.md` §10.1.
