# El proceso de asignación materias–horarios–profesores en ITAM — estado actual

> Documento de contexto para el proyecto de malla horaria (Mat·Scheduler / `V1-Cheque`). Es una síntesis
> **as-is**: qué existe hoy, cómo funciona realmente, y qué queda sin resolver.

## 1. Fuentes

| Fuente | Qué aporta |
|---|---|
| `V1-Cheque/` | Mat·Scheduler: la implementación actual (código JS sin backend, datos reales de Otoño 2026, `README.md` con el análisis técnico). |
| `V1-Cheque/prompt.md` | El prompt original que se le dio a Claude para generar `V1-Cheque/mat-scheduler/CLAUDE.md` — confirma la convención de objetos (Teacher/Course/CourseInstance) desde la fuente primaria. Ver §5.1. |
| `docs/investigacion_asignacion_horarios.md` | Estado del arte académico: University Course Timetabling Problem (UCTP), variantes, enfoques de solución, sistemas de referencia. |
| [Divisiones, departamentos y programas académicos — itam.mx](https://www.itam.mx/es/divisiones-departamentos-y-programas-academicos) | Estructura organizacional oficial de ITAM (ver §2). |

**Nota:** parte de la información de este documento viene de juntas y notas de trabajo con el
departamento que no forman parte de este repositorio. El contenido relevante de esas juntas ya está
incorporado en el cuerpo del documento.

## 2. Alcance y contexto organizacional

### 2.1 Estructura organizacional de ITAM

Confirmada en itam.mx:

| División | Departamentos | Programas |
|---|---|---|
| **Ciencias Exactas** | Actuaría y Seguros · Estadística · Matemáticas | Lic. Actuaría · Lic. Matemáticas Aplicadas · Maestría en Ciencia de Datos (**MCD**) · Maestría en Ciencia de Riesgo (**MR**) |
| Ciencias de la Computación | Computación | Ing. y Ciencias de la Computación · Lic. Ciencia de Datos · Maestría en Ciencias de Computación |
| Ciencias Sociales | Ciencia Política · Derecho · Economía | Lic. Ciencia Política · Lic. Derecho · Lic. Economía · varios posgrados |
| Estudios Generales e Internacionales | Estudios Generales · Estudios Internacionales · Lenguas | Lic. Relaciones Internacionales |
| Ingeniería | Ing. Eléctrica y Electrónica · Ing. Industrial y Operaciones | Ing. Industrial y en Sistemas Inteligentes · Ing. Mecatrónica · Ing. en Negocios |
| Negocios | Administración · Contabilidad | Lic. Administración · Lic. Contaduría · Lic. Dirección Financiera · Ing. en Negocios · Maestría en Finanzas · MBA |

Puntos clave para el proyecto:
- **Ciencias Exactas es una sola división, pero cada departamento (Actuaría y Seguros, Estadística,
  Matemáticas) tiene sus propias restricciones**, dependiendo de lo que determine el jefe de cada
  departamento — no se puede asumir un proceso homogéneo "de división" sin revisar cada departamento.
- Los planes de estudio tienen materias de todos los departamentos.

### 2.2 Alcance de la primera iteración

El proyecto está enfocado en la **División de Ciencias Exactas**. Decisión de alcance:

- **V1 resuelve el problema para tres departamentos de Ciencias Exactas** (Matemáticas, Actuaría,
  Estadística) — no para las otras 5 divisiones.

## 3. El proceso completo hoy

El ciclo tiene 5 fases. Aquí se documenta el detalle operativo real de cada una.

### Fase 1 — Recolección de preferencias

- Dirección Escolar manda la estimación de demanda (`Mat 202603.pdf`-tipo: grupos sugeridos por materia,
  sin considerar salones todavía). Llega **a mediados de septiembre**, y cada departamento tiene sus
  propias fechas internas para cargar esa demanda contra su oferta.
- **Hoy esa demanda se transcribe a mano** a una lista de cursos a abrir (con créditos y grupos
  sugeridos) — es un paso manual y una fuente de error, no automatizado en ningún lado.
- El departamento manda dos formularios a los profesores, alrededor de la **2ª semana de marzo / 3ª de
  septiembre**. Los campos reales:

  | Form | Campos |
  |---|---|
  | **Tiempo completo** | correo, nombre y apellido, número de cursos deseados, selección de materias (con preferencias ordenadas), grid de preferencia por horario, horarios disponibles, otra preferencia. |
  | **Asignatura** (tiempo parcial) | correo, clave única, nombre, cursos deseados, selección/sugerencia de materias, grid de preferencia, horarios (tope 10 hrs/semana → 20 módulos), otra preferencia. |

- Se propone (todavía no implementado) encuestar antes a los **alumnos** sobre demanda, en vez de que el
  primer estimado de cursos sea un "primer cálculo aleatorio".
- Encuesta ideal a profesores: 2-3 cursos que quieren dar, 4-6 preferencias/restricciones de horario,
  ponderadas con datos históricos.

### Fase 2 — Construcción de la malla (Mat·Scheduler)

Documentado a detalle en `V1-Cheque/README.md` — resumen: Excel de consolidación → `generate_data.py` →
JSON como estado vivo → app carga el JSON a `localStorage` → el departamento arma la malla a mano con
drag & drop y exporta reporte/JSON. Las brechas de esa fase están en `V1-Cheque/README.md` §9 y se
retoman en la sección 6 de este documento.

**Detalle adicional de la operación real, no capturado en el código:**

- **Empalmes se manejan hoy por departamento** — Matemáticas, Actuaría y Estadística arman su malla cada
  uno por separado.
- También hay que cuidar que las **optativas de Administración, Computación y Economía** (otras
  divisiones) no se empalmen con la oferta de Ciencias Exactas.
- **Los alumnos llevan materias de distintos departamentos que además están seriadas** (encadenadas por
  prerrequisito) — de ahí una idea todavía sin implementar y **no prioritaria por ahora**: fijar un
  horario consistente para toda una secuencia (ej. "todos los cálculos seriados se dan a las 11") para
  que un alumno siguiendo la secuencia natural nunca se empalme.
- Regla horaria separada: **de 2pm a 4pm es el horario de comida — no se dan ni se toman clases en ese
  bloque.** (Distinta de la regla de no dejar medias horas sueltas, ver abajo.)
- Regla operativa: **no dejar medias horas sueltas** en la malla.
- Trade-off explícito, sin resolver: **grupos grandes vs. muchos grupos chicos** por materia — afecta
  cómo se calculan cupos y equivalencias.
- Full-time se asigna **por curso**; asignatura (tiempo parcial) se asigna **por hora** — y hay que
  reportarle a Escolar el número de horas por profesor.
- Se busca **homogeneizar la carga hora/crédito entre departamentos**.
- Idea de rediseño (sin implementar): evitar empalmes **desde el diseño curricular**, no parcharlos
  después.

### Fase 3 — Notificación de la asignación

Una vez armada la malla, cada profesor debe consultar qué grupo(s), horario y salón le fueron asignados
para el semestre. Los detalles del proceso administrativo de notificación quedan fuera del alcance de
este documento.

### Fase 4 — Periodo de inscripción institucional

Periodo de inscripción a nivel ITAM: prerrequisitos, optativas, empalmes, listas de espera — gestionado
a través de los sistemas institucionales (`actas.itam.mx`, `merlin.itam.mx`, `serviciosweb.itam.mx`).

### Fase 5 — Cierre de semestre

Bajas, exámenes finales, entrega de actas en 48 horas.

## 4. Marco académico aplicable

Resumen de [`investigacion_asignacion_horarios.md`](investigacion_asignacion_horarios.md):

- El problema se conoce en la literatura como **University Course Timetabling Problem (UCTP)**,
  NP-difícil. Dos variantes: **PE-CTP** (post-inscripción, con datos reales de alumnos ya inscritos) vs.
  **CB-CTP** (basado en la malla curricular, sin depender de inscripción individual) — el caso de este
  departamento, con grupos que siguen una malla fija por semestre, se parece más a CB-CTP.
- Agregar **quién da cada curso** extiende el problema a *teacher/professor assignment* dentro del UCTP.
- Cuatro enfoques de solución documentados (programación entera exacta, metaheurísticas, constraint
  programming, híbridos) — tabla completa en el documento original. El caso más cercano ya publicado es
  **Arratia-Martínez et al. (2021)**, modelo de programación entera para una institución mexicana con la
  misma estructura tiempo completo/asignatura.
- **UniTime** aparece como sistema de referencia open-source, con datasets públicos (fuente de la ITC
  2019) — opción real a evaluar antes de construir un solver propio.

Este mismo marco, y el concepto de búsqueda de vecinos en metaheurísticas (solución actual → generar
vecinos → evaluar → aceptar, incluso soluciones peores, para escapar óptimos locales), ya habían
aparecido en notas de trabajo previas a la versión en limpio de `investigacion_asignacion_horarios.md`.

## 5. Boceto de modelo de datos (sin pulir)

De las notas de trabajo iniciales, tal cual, como insumo de discusión — **no** es un modelo de datos
definitivo:

- **Profesor**
- **Asignatura** (con tiempo/estado usado para cálculo de demanda)
- **Grupos**
- **Tiempo completo** (¿entidad separada de Profesor, o un atributo/tipo? — ⚠ confirmar)
- **Plan de estudio** → Materias
- **Materia** → Dependencia (prerrequisitos)
- **Departamento**

Duda explícita en la nota: si un **profesor se modela individual o como objeto** (⚠ confirmar qué
distinción se quiso capturar aquí — posiblemente instancia única vs. tipo/rol reutilizable).

También aparece, sin resolver: información sobre planes de estudio (materias, cantidad, cuántos
"sistemas" — ⚠ confirmar) y la pregunta de si todos los alumnos deben poder ver los distintos planes.

### 5.1 Segundo precedente real: la convención de objetos de Mat·Scheduler (`V1-Cheque/prompt.md`)

A diferencia del boceto manuscrito anterior (sin pulir), `V1-Cheque/prompt.md` es el encargo formal y ya
implementado que se le dio a Claude para construir Mat·Scheduler — un segundo modelo de datos real, en
producción, del mismo lado de la oferta. Cruce con el modelo del pizarrón de un proyecto relacionado:

| Mat·Scheduler (`prompt.md`/`CLAUDE.md`) | Pizarrón / proyecto relacionado (`REQUERIMIENTOS.md` §3) | Nota |
|---|---|---|
| `Teacher` | `Profesor` | Coincide: código, nombre, tipo de contrato, preferencias por horario. |
| `Course` | `Materia` | Coincide en créditos y clave. |
| `Course.programs` ("BsCProgram + Semester") | `Plan_Materia` (puente Plan de Estudio↔Materia) | **Confirmación textual, no inferencia**: el propio encargo describe `programs` como "pares de programa y semestre de carrera" — es el precedente directo del campo hoy vacío en el 100% de los cursos (`V1-Cheque/README.md` §5). |
| `Course.otherCodes` ("cursos anidados, cada uno debe existir independientemente") | `Materia.equivale` (reflexiva, revalidación entre planes) | **No está claro que sean la misma relación** — ver §6. |
| `CourseInstance` | `Imparte` | Mismo concepto (grupo/asignación concreta de un semestre). |
| `CourseInstance.overrides` ("flexible para situaciones especiales") | *(sin equivalente documentado)* | `Imparte` no tiene hoy un mecanismo de excepción por instancia — ver §6. |
| `Classroom` | `Salón` | Presente en el código de Mat·Scheduler pero **ausente tanto de `prompt.md` como de `CLAUDE.md`** — confirma que fue una adición posterior a la especificación original (`V1-Cheque/README.md` §5.1). |

## 6. Brechas y preguntas abiertas

1. `Course.programs` (programa + semestre de carrera) existe en el modelo pero está vacío en el 100% de
   los cursos.
2. Los dos Google Forms no alimentan el sistema directamente — traducción manual.
3. Riesgo de profesores duplicados por fuzzy-matching en `generate_data.py`.
4. Vista "Salones" sin reglas de negocio documentadas (límite por capacidad vs. tamaño de grupo).
5. No hay definición de cómo manejar preferencias de profesor rechazadas u horarios "sobrantes" tras el
   cruce automático.
6. **¿Cómo se traduce la idea de "horario fijo por secuencia" (ej. cálculos seriados a las 11) en una
   restricción del sistema?** — es una idea de diseño, no una regla institucional confirmada todavía, y
   no es prioritaria para una primera versión.
7. **¿`otherCodes` (cursos co-ofrecidos bajo códigos distintos en el mismo semestre, Mat·Scheduler) y
   `equivale` (equivalencia de revalidación entre planes) son la misma relación o dos relaciones
   distintas?** Hoy `REQUERIMIENTOS.md` solo modela la segunda; si son casos de uso distintos, se
   necesitarían dos relaciones separadas sobre Materia, no una.
8. **¿`Imparte` necesita un mecanismo de override por instancia**, análogo a `CourseInstance.overrides`
   de Mat·Scheduler ("flexible para situaciones especiales")? Hoy el modelo de `Imparte` no contempla
   excepciones puntuales de campo por grupo.

## 7. Para más detalle

- Análisis técnico completo de Mat·Scheduler: [`V1-Cheque/README.md`](../V1-Cheque/README.md)
- Estado del arte de asignación de horarios y profesores: [`investigacion_asignacion_horarios.md`](investigacion_asignacion_horarios.md)
