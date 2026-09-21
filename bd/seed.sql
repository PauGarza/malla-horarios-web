-- =============================================================================
-- Autoplanear — datos semilla
-- Requiere haber corrido schema.sql y triggers.sql primero.
--
-- Corrido contra el proyecto real de base de datos 2026-09-21.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Departamentos (los 3 de Ciencias Exactas en alcance de V1)
-- -----------------------------------------------------------------------------

INSERT INTO departamento (nombre, clave_prefijo) VALUES
    ('Matemáticas', 'MAT'),
    ('Actuaría',    'ACT'),
    ('Estadística', 'EST');

-- -----------------------------------------------------------------------------
-- Franja horaria: Lunes-Viernes 07:00-14:00 y 16:00-20:00, bloques de 30 min.
-- 22 franjas totales — igual que malla-horarios/interfaz/mockup-cuestionario.html.
-- Nunca se inserta una franja entre 14:00-16:00 (RN05) ni después de las 20:00
-- (decisión confirmada 2026-09-09: aunque los reportes reales llegan a las
-- 22:00, es una restricción de política del departamento que no se quiere
-- seguir permitiendo).
-- -----------------------------------------------------------------------------

INSERT INTO franja_horaria (hora_inicio, hora_fin, orden)
SELECT
    bloque_inicio,
    bloque_inicio + interval '30 minutes',
    row_number() OVER (ORDER BY bloque_inicio)
FROM (
    -- generate_series no tiene variante (time, time, interval) — se pasa por
    -- timestamp (fecha arbitraria, se descarta) y se vuelve a castear a time.
    SELECT generate_series('2000-01-01 07:00'::timestamp, '2000-01-01 13:30'::timestamp, interval '30 minutes')::time AS bloque_inicio
    UNION ALL
    SELECT generate_series('2000-01-01 16:00'::timestamp, '2000-01-01 19:30'::timestamp, interval '30 minutes')::time
) AS bloques;

-- -----------------------------------------------------------------------------
-- Semestre de ejemplo (el que aparece en los reportes reales revisados)
-- -----------------------------------------------------------------------------

INSERT INTO semestre (tipo, anio) VALUES ('otono', 2026);

-- -----------------------------------------------------------------------------
-- Salones de ejemplo (nombres reales vistos en los reportes de Servicios
-- Escolares — no es el catálogo completo, solo una muestra representativa para
-- poder probar el esquema; el catálogo completo real vive en
-- "Info servicios escolares/salones_Otoño 2026.xlsm").
-- -----------------------------------------------------------------------------

INSERT INTO salon (nombre, edificio, capacidad, tipo) VALUES
    ('RH107',   'EDIFICIO 3 EN RIO HONDO', 53, 'Butacas'),
    ('RH109',   'EDIFICIO 3 EN RIO HONDO', 53, 'Butacas'),
    ('RH301',   'EDIFICIO 3 EN RIO HONDO', 30, 'Butacas'),
    ('PF105',   'EDIFICIO PF',             30, 'Butacas'),
    ('RHB-1',   'EDIFICIO 3 EN RIO HONDO', 40, 'Butacas'),
    ('RHB-2',   'EDIFICIO 3 EN RIO HONDO', 37, 'Butacas'),
    ('RHCC302', 'EDIFICIO 3 EN RIO HONDO', 30, 'Sala de cómputo');

-- -----------------------------------------------------------------------------
-- Disponibilidad de salones por departamento: decisión de alcance V1 (ver
-- diseno-bd.md §2/§3) — los 3 departamentos comparten el mismo pool completo de
-- salones/horarios sin restricción entre sí, para tener menos fricción en esta
-- primera iteración. La restricción real de Servicios Escolares (salón X solo
-- para departamento Y en tal horario) se puede cargar después sin cambiar el
-- esquema, reemplazando este INSERT permisivo por datos reales de
-- "act salones *.pdf".
-- -----------------------------------------------------------------------------

INSERT INTO salon_disponibilidad_departamento (salon_id, departamento_id, semestre_id, dia, franja_id)
SELECT s.id, d.id, sem.id, dia.valor::dia_semana_enum, f.id
FROM salon s
CROSS JOIN departamento d
CROSS JOIN semestre sem
CROSS JOIN (VALUES ('lunes'), ('martes'), ('miercoles'), ('jueves'), ('viernes')) AS dia(valor)
CROSS JOIN franja_horaria f;
