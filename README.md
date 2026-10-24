# malla-horarios-web

Sistema de asignación de materias, horarios y profesores para tres departamentos de la División de
Ciencias Exactas del ITAM: Matemáticas, Actuaría y Estadística.

## Problema que resuelve

Hoy el proceso de armar la malla semestral es manual y está disperso en varias herramientas
desconectadas: las preferencias de los profesores se recolectan por correo o formularios sueltos, la
malla se arma a mano, las cartas de asignación se redactan una por una, y la inscripción final ocurre en
varios sistemas institucionales que no se hablan entre sí. Esto genera trabajo repetido, errores de
captura y poca trazabilidad de por qué se tomó cada decisión.

`malla-horarios-web` busca reemplazar ese proceso con un sistema real: backend con modelo de datos propio,
un formulario de preferencias conectado directamente al motor de asignación, generación automática de
cartas, y reglas de negocio (restricciones duras y blandas, protección de secuencias entre materias,
prioridad de asignación de salones) codificadas de forma explícita y auditable en vez de vivir en la
cabeza de quien arma la malla.

## Fundamentos de diseño

El diseño se basa en dos fuentes:

1. **El proceso institucional real** que sigue el ITAM hoy (recolección de preferencias, construcción
   de la malla, notificación por cartas, periodo de inscripción, cierre de semestre).
2. **Literatura académica sobre asignación de horarios universitarios** (university course timetabling),
   para no reinventar restricciones ni heurísticas ya estudiadas.

Este repo no es un rediseño cosmético de una herramienta anterior: parte de estas dos fuentes para
proponer un sistema con arquitectura propia.

## Alcance (V1)

La primera versión cubre **tres departamentos de la División de Ciencias Exactas**: Matemáticas,
Actuaría y Estadística. Extender el sistema a otros departamentos o divisiones del ITAM es una ambición
de largo plazo, mas queda explícitamente fuera del alcance de esta primera versión.

## Estructura del repositorio

```
malla-horarios-web/
├── README.md                            — este archivo
├── docs/                                — contexto y documentación de diseño
│   ├── PROCESO-ACTUAL.md                — estado actual del proceso de asignación (as-is)
│   ├── investigacion_asignacion_horarios.md — estado del arte académico (UCTP)
│   ├── esquema de pizarron.jpeg         — boceto original del modelo de datos y del flujo de asignación
│   └── mockup/                          — mockups / prototipos navegables (aquí son lo mismo): HTML/JS
│       │                                   puro, sin backend ni base de datos, para validar contenido y
│       │                                   flujo con los Jefes de Departamento antes de construirlo
│       ├── cuestionario-profesores.md   — especificación del cuestionario de preferencias de profesores
│       │                                   (materias y horarios, Tiempo Completo vs. Asignatura, y el
│       │                                   contrato de datos propuesto hacia el backend)
│       ├── mockup-cuestionario.html     — mockup del cuestionario (login simulado, borrador en el
│       │                                   navegador) — ya reemplazado por `frontend/`; se conserva
│       │                                   como referencia de contenido
│       └── mockup-vista-malla.html      — mockup de la vista de la malla para la jefatura (Otoño 2026):
│                                           grupos por día y franja, choques, avisos y grupos por asignar
├── frontend/                            — app real (React), servida desde horariosdace.itam.mx
├── api/                                 — API en PHP 7.4: login, formulario, respuestas, demanda,
│                                           semestres, reportes y asignaciones directas; la
│                                           autorización vive aquí (ver su README)
├── backend/                             — backend ANTERIOR (funciones de Supabase), ya reemplazado
│                                           por api/; se conserva como referencia
└── bd/                                  — diseño de base de datos: esquema, diagrama, decisiones de
                                            negocio, y una guía específica para quien construya el
                                            motor de asignación (qué leer/escribir en qué tablas)
```

El resto de la estructura (integraciones, motor de asignación en sí) se irá agregando conforme se
tomen esas decisiones.

### Documentación

- [`docs/PROCESO-ACTUAL.md`](docs/PROCESO-ACTUAL.md) — cómo funciona hoy el proceso de asignación de
  materias, horarios y profesores (las 5 fases, de principio a fin), y las brechas/preguntas abiertas.
- [`docs/investigacion_asignacion_horarios.md`](docs/investigacion_asignacion_horarios.md) — estado del
  arte académico sobre asignación de horarios universitarios (UCTP), enfoques de solución y sistemas de
  referencia como UniTime.
- [`docs/mockup/`](docs/mockup/) — mockups navegables: el del cuestionario de preferencias (con su
  especificación) y el de la vista de la malla para la jefatura.

## Esquema original

Boceto de pizarrón del que parte el diseño de este sistema (flujo de asignación + primer modelo de
datos):

![Esquema de pizarrón: boceto del flujo de asignación y modelo de datos](docs/esquema%20de%20pizarron.jpeg)

## Estado actual

La app corre en **https://horariosdace.itam.mx/**: frontend en React (`frontend/`), API propio en
PHP (`api/`) y MySQL del ITAM (`bd/mysql/`). Están cargados los catálogos de Matemáticas y
Estadística (materias y co-oferta); cada profesor crea su propia cuenta. Lo que ya funciona:

- Alta de cuenta con clave única y correo, login, perfil, cambio de contraseña y "¿Olvidaste tu
  contraseña?" por correo.
- **Ciclo de semestres**: un semestre activo; abrir el siguiente copia el formulario anterior.
- **Formulario editable por jefatura**, "como un Google Forms" (secciones de materias, preguntas
  abiertas, textos, mínimos), que se publica cuando está listo. Todos los profesores de un
  departamento ven el mismo formulario. El mínimo de horas en verde de la rejilla sale de los
  cursos que pide cada profesor (3 h por curso, +1 h si tiene en verde una de 8 créditos), y a
  tiempo completo y medio tiempo la jefatura le aplica un ratio. La rejilla arranca en rojo claro:
  el profesor solo pinta lo que sí puede.
- **Respuestas y bloqueos**: matriz profesores × materias; la jefatura bloquea pares antes de
  correr el algoritmo, sin que el profesor lo vea. Ahí mismo puede **ajustar el número de cursos**
  de un profesor (queda marcado y el profesor no lo ve).
- **Carga de la estimación de demanda** subiendo el PDF de Servicios Escolares.
- **Asignaciones directas**: la jefatura fija qué profesor da qué materia (y si quiere, a qué hora)
  antes de correr el algoritmo, que lo respetará tal cual. Incluye la "Materia de Maestría", que
  aparta el horario del profesor sin contar como curso.
- **Reportes para la jefatura**: por profesor (contrato, cursos solicitados, materias y horas en
  verde/amarillo/rojo, con descarga en CSV) y un mapa de calor de las horas que pidieron.
- **Perfil de administrador**: ve y edita los 3 departamentos, uno a la vez, con un selector de
  departamento en cada vista de jefatura. Puede **probar el formulario** de cualquier departamento
  y contrato: se contesta y se valida como el real, pero no se guarda nada.
- **Datos para el motor** (solo admin, 2026-10-13): descargar el paquete del semestre para el
  motor de asignación (un departamento o los tres, con o sin salones) y subir su resultado, que se
  revisa contra las reglas y, si no tiene errores, crea los grupos sin publicar. Desde el 2026-10-21
  el paquete trae el semestre de cada materia en cada plan de estudios (`planes`, con `clave` y
  `vigente`), y el resumen de la descarga dice cuántas materias lo tienen. El contrato (JSON de
  ida y vuelta) está en `docs/convencion-datos-motor.md` del repo del servicio social
  (`malla-horarios`), donde también viven el motor (`optV1/`; `optV0/` es el original) y el diagrama
  del flujo completo (`docs/flujo-del-sistema.md`).
- **Malla horaria** (solo admin por ahora, 2026-10-21, solo lectura): los grupos que dejó el motor y los
  publicados, por profesor, por salón o por semana, con los choques y avisos recalculados contra los
  datos de hoy (las mismas reglas con que se valida la subida), lo que falta por asignar, quién más
  puede dar cada grupo a esa hora, y la semana de cada plan y semestre. El admin elige uno o los tres
  departamentos; cuando se abra a jefatura, cada jefe verá el suyo. Es el mockup que ya vieron los jefes, conectado a la base
  (`api/malla.php`, `frontend/src/lib/mallaVista.js`). Desde la tarjeta de un grupo se le cambia el
  profesor (2026-10-23), con la revisión de choques antes de guardar.

Pendiente: mover horario y salón y publicar desde la vista de malla, cargar los salones del semestre, y probar optV1 de punta a punta con una descarga real. También las cartas de asignación, y
cargar Actuaría. `backend/` es el backend anterior (Supabase), ya reemplazado por `api/`.

## Cómo contribuir

Por definir junto con el equipo conforme arranque el trabajo.
