# Cuestionario de profesores — especificación de interfaz

Este documento describe la primera vista a construir en `interfaz/`: la captura de preferencias de
profesores (materias y horarios) para armar la malla de un semestre. Reemplaza los formularios de Google
Forms que se usan hoy (`Tiempo completo_*.pdf` / `Asignatura_*.pdf`), manteniendo el mismo contenido que
ya se le pide al profesor, pero cambiando cómo se captura y a dónde va la información.

## 1. Punto de partida: cuentas y catálogo precargado

A diferencia del Google Form actual (abierto, sin autenticación, donde el profesor escribe su nombre y
clave a mano), el sistema nuevo parte de dos cosas ya cargadas antes de que el profesor entre:

- **Roster de profesores por departamento**, con nombre, clave, departamento al que pertenece y tipo de
  contrato (Tiempo Completo / Asignatura).
- **Una cuenta por persona** — cada profesor y cada Jefe de Departamento tiene su propio login. El
  cuestionario vive detrás de ese login, nunca abierto por link público.

Esto tiene una consecuencia directa en el diseño: **los campos de identidad (nombre, apellidos, clave,
departamento, tipo de contrato) ya no se le preguntan al profesor** — se muestran de solo lectura, tomados
de la cuenta con la que inició sesión. Si algo está mal (nombre, departamento), se corrige en el roster,
no en el formulario.

## 2. Vistas involucradas

| Vista | Quién la usa | Qué hace aquí |
|---|---|---|
| **Cuestionario de preferencias** | Profesor (TC y Asignatura) | Captura materias y horarios preferidos para el semestre — el foco de este documento. |
| **Consulta de mi asignación** | Profesor | Una vez confirmada la malla, ver qué le tocó (fuera de alcance de este documento). |
| **Panel de preferencias recibidas** | Jefe de Departamento | Ve el estado de las preferencias de su departamento (quién respondió, quién falta) antes de correr la asignación (fuera de alcance de este documento). |

## 3. Estructura del cuestionario

El cuestionario original de Google Forms tiene tres bloques (identidad → cursos → horarios). El nuevo
mantiene los mismos tres bloques de contenido, quitando el de identidad (ya resuelto por la cuenta) y
cambiando cursos/horarios de selección binaria a una **escala de tres niveles: verde / amarillo / rojo**,
igual en ambos bloques.

- 🟢 **Verde** — sí, con gusto / seguro disponible.
- 🟡 **Amarillo** — podría, pero no es lo ideal / posible pero complicado.
- 🔴 **Rojo** — no puedo o no quiero.

### 3.1 Encabezado (solo lectura)

Nombre, departamento, tipo de contrato, semestre. Tomado de la cuenta — no editable aquí.

### 3.2 Carga máxima del semestre

Un campo numérico: **¿cuántos cursos puede impartir este semestre?** (el Google Form actual lo pide como
opción 1/2/3 para ambos tipos de contrato). Se mantiene igual, con el mismo propósito: acotar cuántas
materias en verde tienen sentido y ayudar a la validación de carga (ver RN03/RN04 más abajo).

### 3.3 Preferencia de materias

Catálogo de materias mostrado **filtrado al departamento del profesor por default**, con opción de
agregar materias de otros departamentos (un profesor puede impartir fuera de su departamento, aunque
pertenezca a uno solo). Cada materia se marca verde/amarillo/rojo en vez de un checkbox simple.

**Diferencia por tipo de contrato (tomada tal cual de los formularios actuales):**

- **Tiempo Completo:** primero aparece un bloque destacado de "cursos de cálculo que requieren cobertura
  departamental" (los cursos nuevos de cálculo que, por ser departamentales, necesitan que varios
  profesores de tiempo completo/medio tiempo los den) — **mínimo 2 en verde** dentro de ese bloque. Debajo,
  el resto del catálogo — **mínimo 5 en verde** en total.
- **Asignatura:** un solo catálogo completo (incluye los cursos de cálculo mezclados con el resto, sin
  bloque separado) — **mínimo 5 en verde**.

Estos mínimos son la traducción directa de los "5 opciones mínimo" / "2 cursos" que ya exigen los
formularios actuales — solo que ahora se cumplen marcando verde en vez de tildar checkboxes.

### 3.4 Disponibilidad de horarios

Rejilla tipo *when2meet*, un bloque por día (lunes a viernes), en franjas de 30 minutos de 7:00 a 14:00 y
de 16:00 a 20:00 (14:00–16:00 es horario de comida institucional, no se ofrece). Cada franja se marca
verde/amarillo/rojo, igual que las materias.

- **Mínimo de horas en verde por semana:** todavía no está definido — depende del tipo de contrato y de
  cómo lo quiera manejar cada Jefe de Departamento. Mientras no se resuelva, el formulario no debe
  bloquear el envío por no alcanzar un mínimo; solo mostrar cuántas horas en verde lleva marcadas.
- **Solo para Asignatura:** campo opcional "¿Ya solicitó cursos en otro departamento? ¿En qué horarios?" —
  existe en el formulario actual porque un profesor de asignatura no puede exceder 10 hrs/semana sumando
  entre departamentos; con esa info el sistema puede advertir de un posible empalme o exceso antes de
  confirmar. No aplica a Tiempo Completo (se asigna por curso, no por hora).

### 3.5 Observaciones

Dos campos de texto libre, igual que hoy: una para observaciones sobre la asignación de cursos
(restricciones, optativas, coordinación) y otra sobre disponibilidad de horarios.

### 3.6 Guardado y envío

A diferencia del Google Form (una sola pasada, sin volver a editar salvo borrar todo), el cuestionario
debe:
- Guardarse como borrador automáticamente mientras el profesor lo llena (autosave), para que no se pierda
  el avance si cierra la pestaña.
- Permitir volver a entrar y editar mientras la fecha límite del semestre no haya pasado.
- Al enviar, mostrar un resumen (cuántas materias en verde/amarillo/rojo, cuántas horas en verde por día)
  antes de confirmar.

## 4. Comparación con los formularios actuales

| Aspecto | Formulario actual (Google Forms) | Cuestionario nuevo |
|---|---|---|
| Identidad | El profesor escribe nombre, apellidos, clave | Precargada de la cuenta, solo lectura |
| Acceso | Link abierto, sin cuenta | Login por profesor/Jefe de Departamento |
| Materias | Checkbox, mínimo fijo de opciones | Escala verde/amarillo/rojo, mismo mínimo pero expresado en verdes |
| Horarios | Checkbox por franja de 30 min | Misma franja, escala verde/amarillo/rojo (when2meet) |
| Edición | Una sola pasada por sesión de navegador | Editable hasta la fecha límite, con autosave |
| Envío | Un solo "Enviar" final, con reCAPTCHA | Borrador + confirmación, sin reCAPTCHA (ya autenticado) |

## 5. Envío de datos al backend

El frontend se maneja en JS (consistente con el resto de la interfaz). Cada cambio en el cuestionario se
guarda como una `Preferencia` ligada al profesor (identificado por la sesión, no por un campo del
formulario) y al semestre. Estructura sugerida del payload:

```json
{
  "semestre": "2026-otono",
  "num_cursos_max": 3,
  "materias": [
    { "materia_id": "CALC-APLICADO", "nivel": "verde", "cobertura_departamental": true },
    { "materia_id": "ALGEBRA-LINEAL-I", "nivel": "amarillo" },
    { "materia_id": "CALCULO-III", "nivel": "rojo" }
  ],
  "disponibilidad": [
    { "dia": "lunes", "bloque": "07:00-07:30", "nivel": "verde" },
    { "dia": "lunes", "bloque": "07:30-08:00", "nivel": "verde" },
    { "dia": "lunes", "bloque": "08:00-08:30", "nivel": "rojo" }
  ],
  "horarios_solicitados_otro_depto": "Martes 10:00-11:30 en Actuaría",
  "observaciones_cursos": "",
  "observaciones_horarios": "",
  "estado": "borrador"
}
```

Endpoints sugeridos (backend Node/Express, `profesor_id` y `departamento` se resuelven del token de
sesión, no viajan en el body):

- `GET /api/preferencias?semestre=2026-otono` — trae el borrador existente del profesor autenticado, para
  precargar el formulario si ya había avanzado.
- `PUT /api/preferencias?semestre=2026-otono` — guarda/actualiza el borrador (autosave, `estado: "borrador"`).
- `POST /api/preferencias/enviar?semestre=2026-otono` — marca `estado: "enviado"` y bloquea edición salvo
  que el profesor la reabra explícitamente antes de la fecha límite.

El catálogo de materias filtrado por departamento y la rejilla de días/franjas se piden con `GET` aparte
(no van en el payload de preferencias) para no duplicar datos que el backend ya tiene.

## 6. Reglas de negocio que debe respetar el cuestionario

- Máximo 10 hrs/semana para un profesor de Asignatura, sumando entre departamentos.
- Tiempo Completo se asigna por curso; Asignatura por hora — afecta cómo se interpreta "num_cursos_max".
- No se ofrecen franjas de 14:00 a 16:00 (comida).
- Un profesor pertenece a un solo departamento, pero puede marcar materias de otros departamentos como
  preferencia.

## 7. Pendiente antes de implementar

- **Mínimo de horas en verde por semana** — depende del tipo de contrato y de cada Jefe de Departamento;
  llevarlo a la junta de Jefes de Departamento antes de poner un número fijo en el validador.
- **Mecanismo de cuentas** — con qué credenciales inicia sesión un profesor/Jefe (¿usuario ITAM existente,
  o cuentas nuevas creadas al cargar el roster?) — todavía no definido.
- **Catálogo de materias por departamento** — de dónde se carga (¿captura manual, o se reutiliza un
  catálogo ya existente?) antes de poder filtrar el cuestionario por departamento.
