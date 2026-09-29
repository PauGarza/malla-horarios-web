# Diagrama entidad-relación — Autoplanear

> Ver [`diseno-bd.md`](diseno-bd.md) para el detalle de columnas/constraints de cada tabla. Este
> diagrama es la versión visual, agrupada por dominio. Sustituye como diseño confirmado al borrador
> `../diagrama-modelo-datos-2026-08-21.drawio` (explícitamente marcado como borrador de trabajo, no
> definitivo, en `../BITACORA.md`). Para quien construya el motor de asignación: la copia pública de
> esta carpeta en `../malla-horarios/bd/` incluye `motor-asignacion.md`, un resumen de qué leer/
> escribir en cada tabla.

## Vista completa

```mermaid
erDiagram
    DEPARTAMENTO ||--o{ PROFESOR : "tiene (incluye Jefe de Depto/admin/etc. vía profesor.rol)"
    DEPARTAMENTO ||--o{ MATERIA : "dueño de"
    DEPARTAMENTO ||--o{ PLAN_ESTUDIO_DEPARTAMENTO : ""
    DEPARTAMENTO ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""
    DEPARTAMENTO ||--o{ DEPARTAMENTO_SEMESTRE_CONFIG : ""

    PLAN_ESTUDIO ||--o{ PLAN_ESTUDIO_DEPARTAMENTO : ""
    PLAN_ESTUDIO ||--o{ PLAN_ESTUDIO_MATERIA : ""
    PLAN_ESTUDIO ||--o{ MATERIA_PREREQUISITO : "(opcional, por plan)"
    PLAN_ESTUDIO ||--o{ MATERIA_EQUIVALENCIA : "(opcional, por plan)"

    MATERIA ||--o{ PLAN_ESTUDIO_MATERIA : ""
    MATERIA ||--o{ MATERIA_PREREQUISITO : "requiere"
    MATERIA ||--o{ MATERIA_CO_OFERTA : "co-ofertada con"
    MATERIA ||--o{ MATERIA_EQUIVALENCIA : "equivale a"
    MATERIA ||--o{ GRUPO : "genera"
    MATERIA ||--o{ ESTIMACION_DEMANDA : ""
    MATERIA ||--o{ BLOQUEO_PROFESOR_MATERIA : ""
    MATERIA ||--o{ MATERIA_CUESTIONARIO : ""

    PROFESOR ||--o{ BLOQUEO_PROFESOR_MATERIA : ""
    PROFESOR ||--o{ IMPARTE_PROFESOR : ""
    PROFESOR ||--o{ PREFERENCIA : "declara"

    SEMESTRE ||--o{ GRUPO : ""
    SEMESTRE ||--o{ ESTIMACION_DEMANDA : ""
    SEMESTRE ||--o{ PREFERENCIA : ""
    SEMESTRE ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""

    FRANJA_HORARIA ||--o{ IMPARTE_HORARIO : ""
    FRANJA_HORARIA ||--o{ DISPONIBILIDAD : ""
    FRANJA_HORARIA ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""

    SALON ||--o{ IMPARTE_HORARIO : "sede de"
    SALON ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""

    GRUPO ||--|| IMPARTE : "se confirma como"

    IMPARTE ||--o{ IMPARTE_PROFESOR : ""
    IMPARTE ||--o{ IMPARTE_HORARIO : ""
    IMPARTE ||--o{ IMPARTE_CO_OFERTA : "co-ofertado con"

    PREFERENCIA ||--o{ PREFERENCIA_MATERIA : ""
    PREFERENCIA ||--o{ DISPONIBILIDAD : ""
    PREFERENCIA ||--o{ PREFERENCIA_RESPUESTA : ""
    DEPARTAMENTO ||--o{ CUESTIONARIO_SECCION : ""
    CUESTIONARIO_SECCION ||--o{ MATERIA_CUESTIONARIO : ""
    CUESTIONARIO_SECCION ||--o{ PREFERENCIA_RESPUESTA : ""
```

## Dominio: catálogo académico

```mermaid
erDiagram
    DEPARTAMENTO {
        int id PK
        text nombre UK
        varchar clave_prefijo UK
    }
    PLAN_ESTUDIO {
        int id PK
        text nombre
        boolean activo
    }
    PLAN_ESTUDIO_DEPARTAMENTO {
        int plan_estudio_id FK
        int departamento_id FK
    }
    MATERIA {
        int id PK
        varchar clave UK
        text nombre
        int creditos
        int departamento_id FK
        boolean anual
        text tipo_salon_requerido "nullable"
        boolean activa
    }
    PLAN_ESTUDIO_MATERIA {
        int id PK
        int plan_estudio_id FK
        int materia_id FK
        int semestre_plan
    }
    MATERIA_PREREQUISITO {
        int materia_id FK
        int prerequisito_id FK
        int plan_estudio_id FK "nullable"
    }
    MATERIA_CO_OFERTA {
        int materia_id FK
        int co_ofertada_id FK
    }
    MATERIA_EQUIVALENCIA {
        int materia_origen_id FK
        int materia_destino_id FK
        int plan_estudio_id FK "nullable"
    }

    DEPARTAMENTO ||--o{ MATERIA : "dueño de"
    PLAN_ESTUDIO ||--o{ PLAN_ESTUDIO_DEPARTAMENTO : ""
    DEPARTAMENTO ||--o{ PLAN_ESTUDIO_DEPARTAMENTO : ""
    PLAN_ESTUDIO ||--o{ PLAN_ESTUDIO_MATERIA : ""
    MATERIA ||--o{ PLAN_ESTUDIO_MATERIA : ""
    MATERIA ||--o{ MATERIA_PREREQUISITO : "requiere"
    MATERIA ||--o{ MATERIA_CO_OFERTA : "co-oferta"
    MATERIA ||--o{ MATERIA_EQUIVALENCIA : "equivale"
```

## Dominio: malla y asignación (Grupo → Imparte)

```mermaid
erDiagram
    MATERIA {
        int id PK
        varchar clave
        int creditos
    }
    SEMESTRE {
        int id PK
        text tipo
        int anio
    }
    ESTIMACION_DEMANDA {
        int id PK
        int materia_id FK
        int semestre_id FK
        int alumnos_total
        numeric demanda_ajustada "columna Suma del reporte real"
        int capacidad_planeacion "columna Cap."
        int grupos_periodo_anterior
        int grupos_sugeridos "0 es válido, se conserva"
        boolean mostrar_en_cuestionario
    }
    GRUPO {
        int id PK
        int crn
        int materia_id FK
        int semestre_id FK
        varchar numero
        int cupo_maximo
        text estado
        boolean publicado
        int continua_de_id FK "nullable, self-FK"
    }
    IMPARTE {
        int id PK
        int grupo_id FK, UK
        jsonb overrides
    }
    IMPARTE_PROFESOR {
        int imparte_id FK
        int profesor_id FK
    }
    IMPARTE_CO_OFERTA {
        int imparte_id FK
        int imparte_relacionado_id FK
        numeric porcentaje_responsabilidad
    }
    IMPARTE_HORARIO {
        int id PK
        int imparte_id FK
        text dia
        int franja_id FK
        int salon_id FK
    }
    PROFESOR {
        int id PK
        varchar cu
    }
    SALON {
        int id PK
        text nombre
        int capacidad
    }
    FRANJA_HORARIA {
        int id PK
        time hora_inicio
        time hora_fin
    }

    MATERIA ||--o{ ESTIMACION_DEMANDA : ""
    SEMESTRE ||--o{ ESTIMACION_DEMANDA : ""
    MATERIA ||--o{ GRUPO : "genera"
    SEMESTRE ||--o{ GRUPO : ""
    GRUPO ||--o{ GRUPO : "continua de (materias anuales)"
    GRUPO ||--|| IMPARTE : "se confirma como"
    IMPARTE ||--o{ IMPARTE_PROFESOR : ""
    PROFESOR ||--o{ IMPARTE_PROFESOR : ""
    IMPARTE ||--o{ IMPARTE_CO_OFERTA : ""
    IMPARTE ||--o{ IMPARTE_HORARIO : ""
    FRANJA_HORARIA ||--o{ IMPARTE_HORARIO : ""
    SALON ||--o{ IMPARTE_HORARIO : ""
```

## Dominio: formulario y preferencias de profesores

Desde 2026-09-28 el formulario de cada departamento/semestre es una lista ordenada de secciones que
edita la jefatura (`CUESTIONARIO_SECCION`), y ya no hay lista personalizada por profesor: se
eliminaron `PROFESOR_MATERIA_ELEGIBLE` y `profesor.modo_materias_elegibles`. Lo que se decide por
persona va después, como `BLOQUEO_PROFESOR_MATERIA`. Ver `diseno-bd.md` §12.

```mermaid
erDiagram
    PROFESOR {
        int id PK
        varchar cu UK
        text tipo_contrato
    }
    MATERIA {
        int id PK
        varchar clave
    }
    SEMESTRE {
        int id PK
    }
    DEPARTAMENTO {
        int id PK
    }
    CUESTIONARIO_SECCION {
        int id PK
        int departamento_id FK
        int semestre_id FK
        text tipo "num_cursos | materias | disponibilidad | abierta"
        text titulo
        text audiencia
        int minimo_verdes
        boolean cobertura_departamental
        boolean obligatoria
        int orden
        boolean activa
    }
    MATERIA_CUESTIONARIO {
        int materia_id FK
        int semestre_id FK
        int seccion_id FK "NULL = oculta"
        int alias_de_id FK
        text etiqueta
    }
    PREFERENCIA {
        int id PK
        int profesor_id FK
        int semestre_id FK
        int num_cursos_max
        text estado
    }
    PREFERENCIA_MATERIA {
        int id PK
        int preferencia_id FK
        int materia_id FK
        text nivel
        boolean cobertura_departamental
    }
    PREFERENCIA_RESPUESTA {
        int preferencia_id FK
        int seccion_id FK
        text texto
    }
    DISPONIBILIDAD {
        int id PK
        int preferencia_id FK
        text dia
        int franja_id FK
        text nivel
    }
    BLOQUEO_PROFESOR_MATERIA {
        int profesor_id FK
        int materia_id FK
        int semestre_id FK
        int bloqueado_por FK
    }
    FRANJA_HORARIA {
        int id PK
    }

    DEPARTAMENTO ||--o{ CUESTIONARIO_SECCION : "su formulario"
    SEMESTRE ||--o{ CUESTIONARIO_SECCION : ""
    CUESTIONARIO_SECCION ||--o{ MATERIA_CUESTIONARIO : "agrupa"
    MATERIA ||--o{ MATERIA_CUESTIONARIO : ""
    PROFESOR ||--o{ PREFERENCIA : "declara"
    SEMESTRE ||--o{ PREFERENCIA : ""
    PREFERENCIA ||--o{ PREFERENCIA_MATERIA : "(soft)"
    MATERIA ||--o{ PREFERENCIA_MATERIA : ""
    PREFERENCIA ||--o{ PREFERENCIA_RESPUESTA : ""
    CUESTIONARIO_SECCION ||--o{ PREFERENCIA_RESPUESTA : "pregunta abierta"
    PREFERENCIA ||--o{ DISPONIBILIDAD : "(hard)"
    FRANJA_HORARIA ||--o{ DISPONIBILIDAD : ""
    PROFESOR ||--o{ BLOQUEO_PROFESOR_MATERIA : "(hard, jefatura)"
    MATERIA ||--o{ BLOQUEO_PROFESOR_MATERIA : ""
```

## Dominio: salones, roles y configuración por departamento

Login unificado (2026-09-21): no existe una tabla `USUARIO` separada — `PROFESOR.rol` es la identidad
de cualquier rol (profesor, Jefe de Departamento, Servicios Escolares, Nómina, admin). Ver
`diseno-bd.md` §4.1/§4.3.

```mermaid
erDiagram
    SALON {
        int id PK
        text nombre
        text edificio
        int capacidad
        text tipo
    }
    DEPARTAMENTO {
        int id PK
        text nombre
    }
    SEMESTRE {
        int id PK
    }
    FRANJA_HORARIA {
        int id PK
    }
    SALON_DISPONIBILIDAD_DEPARTAMENTO {
        int salon_id FK
        int departamento_id FK
        int semestre_id FK
        text dia
        int franja_id FK
    }
    DEPARTAMENTO_SEMESTRE_CONFIG {
        int departamento_id FK
        int semestre_id FK
        numeric horas_minimas_verde
        text texto_introduccion
        boolean publicado
    }
    PROFESOR {
        int id PK
        varchar cu UK
        text rol
        int departamento_id FK "nullable si admin/servicios_escolares/nomina"
    }

    SALON ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""
    DEPARTAMENTO ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""
    SEMESTRE ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""
    FRANJA_HORARIA ||--o{ SALON_DISPONIBILIDAD_DEPARTAMENTO : ""
    DEPARTAMENTO ||--o{ DEPARTAMENTO_SEMESTRE_CONFIG : ""
    SEMESTRE ||--o{ DEPARTAMENTO_SEMESTRE_CONFIG : ""
    DEPARTAMENTO ||--o{ PROFESOR : "pertenece a (o dirige, si jefe_departamento)"
```
