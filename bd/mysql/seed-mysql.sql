-- =============================================================================
-- Autoplanear — datos semilla (MySQL)
-- Traduccion de ../seed.sql. Requiere schema-mysql.sql y triggers-mysql.sql.
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Departamentos (los 3 de Ciencias Exactas en alcance de V1)
-- -----------------------------------------------------------------------------

INSERT INTO departamento (nombre, clave_prefijo) VALUES
    ('Matemáticas', 'MAT'),
    ('Actuaría',    'ACT'),
    ('Estadística', 'EST');

-- -----------------------------------------------------------------------------
-- Franja horaria: Lunes-Viernes 07:00-14:00 y 16:00-20:00, bloques de 30 min.
-- 22 franjas — igual que malla-horarios/interfaz/mockup-cuestionario.html.
-- Nunca una franja entre 14:00-16:00 (RN05, comida) ni despues de las 20:00
-- (decision del 2026-09-09: los reportes reales llegan a las 22:00, pero es una
-- restriccion de politica del departamento que no se quiere seguir permitiendo).
--
-- El original usaba generate_series, que no existe en MySQL. Son un catalogo
-- fijo de 22 filas: literales es mas largo pero mas claro que cualquier truco
-- con una tabla de numeros, y este archivo se lee mas veces de las que se corre.
-- -----------------------------------------------------------------------------

INSERT INTO franja_horaria (hora_inicio, hora_fin, orden) VALUES
    ('07:00','07:30', 1), ('07:30','08:00', 2), ('08:00','08:30', 3), ('08:30','09:00', 4),
    ('09:00','09:30', 5), ('09:30','10:00', 6), ('10:00','10:30', 7), ('10:30','11:00', 8),
    ('11:00','11:30', 9), ('11:30','12:00',10), ('12:00','12:30',11), ('12:30','13:00',12),
    ('13:00','13:30',13), ('13:30','14:00',14),
    ('16:00','16:30',15), ('16:30','17:00',16), ('17:00','17:30',17), ('17:30','18:00',18),
    ('18:00','18:30',19), ('18:30','19:00',20), ('19:00','19:30',21), ('19:30','20:00',22);

-- -----------------------------------------------------------------------------
-- Semestres.
--
-- otono 2026 es el que aparece en los reportes de estimacion de demanda ya
-- revisados. primavera 2027 es el del cuestionario real: es el semestre al que
-- cuelga datos-matematicas-cuestionario-mysql.sql, y SIN EL ese archivo
-- insertaria cero filas sin dar ningun error, porque su CROSS JOIN no
-- encontraria nada. No lo quites.
--
-- etiqueta no existe como columna (MariaDB 5.5 no la soporta como calculada):
-- se arma al leer, en api/catalogos.php.
-- -----------------------------------------------------------------------------

-- primavera 2027 es el ACTIVO: el semestre en el que se trabaja (desde
-- 2026-09-29 hay exactamente uno; se cambia desde la vista de Semestres).
INSERT INTO semestre (tipo, anio, estado) VALUES
    ('otono', 2026, 'cerrado'),
    ('primavera', 2027, 'activo');

-- -----------------------------------------------------------------------------
-- Salones de ejemplo (nombres reales de los reportes de Servicios Escolares —
-- no es el catalogo completo, solo una muestra para poder probar el esquema; el
-- completo vive en "Info servicios escolares/salones_Otoño 2026.xlsm").
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
-- Disponibilidad de salones por departamento: decision de alcance V1 (ver
-- ../diseno-bd.md) — los 3 departamentos comparten el mismo pool completo, sin
-- restriccion entre si, para tener menos friccion en esta primera iteracion. La
-- restriccion real de Servicios Escolares (salon X solo para el depto Y en tal
-- horario) se carga despues sin cambiar el esquema, reemplazando este INSERT
-- permisivo por datos de "act salones *.pdf".
--
-- 7 salones x 3 deptos x 2 semestres x 5 dias x 22 franjas = 4 620 filas.
-- Se usa un derivado con UNION ALL y no VALUES ROW(), que es 8.0.19+.
-- -----------------------------------------------------------------------------

INSERT INTO salon_disponibilidad_departamento (salon_id, departamento_id, semestre_id, dia, franja_id)
SELECT s.id, d.id, sem.id, dias.valor, f.id
  FROM salon s
 CROSS JOIN departamento d
 CROSS JOIN semestre sem
 CROSS JOIN (SELECT 'lunes' AS valor UNION ALL SELECT 'martes' UNION ALL
             SELECT 'miercoles' UNION ALL SELECT 'jueves' UNION ALL SELECT 'viernes') dias
 CROSS JOIN franja_horaria f;
