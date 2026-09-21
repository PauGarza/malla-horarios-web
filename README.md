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
│   └── mockup/                          — validación de contenido/flujo con los Jefes de Departamento
│       ├── cuestionario-profesores.md   — especificación del cuestionario de preferencias de profesores
│       │                                   (materias y horarios, Tiempo Completo vs. Asignatura, y el
│       │                                   contrato de datos propuesto hacia el backend)
│       └── mockup-cuestionario.html     — mockup navegable de ese cuestionario (HTML/JS puro, sin
│                                           backend ni base de datos, con login simulado y borrador
│                                           guardado en el navegador) — ya reemplazado por `frontend/`
│                                           como la app real; se conserva como referencia de contenido
├── frontend/                            — app real (React), la que se publica en el sitio del proyecto
├── backend/                             — funciones del lado del servidor (autenticación, etc.);
│                                           ver el README de esa carpeta para el detalle del proveedor
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
- [`docs/mockup/`](docs/mockup/) — especificación y mockup navegable del cuestionario de preferencias,
  usados para validar contenido/flujo antes de construir `frontend/`.

## Esquema original

Boceto de pizarrón del que parte el diseño de este sistema (flujo de asignación + primer modelo de
datos):

![Esquema de pizarrón: boceto del flujo de asignación y modelo de datos](docs/esquema%20de%20pizarron.jpeg)

## Estado actual

Ya existe un mockup del cuestionario de profesores (`docs/mockup/mockup-cuestionario.html`) usado
para validar contenido/flujo con los Jefes de Departamento, y ya arrancó la app real en `frontend/`
(scaffold pendiente) conectada a una base de datos administrada, con autenticación propia vía
`backend/` (ver los README de cada carpeta). Pendiente: cargar el catálogo real de materias y el
roster de profesores por departamento.

## Cómo contribuir

Por definir junto con el equipo conforme arranque el trabajo.
