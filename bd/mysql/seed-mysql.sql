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
--
-- 2026-10-02: excepcion a RN05 — martes y jueves se admite hasta las 14:30.
-- Es la de orden 15 (23 franjas en total), con dias = 'martes,jueves'; las demas (dias NULL) valen
-- todos los dias. Ver migracion-2026-10-02-franja-1400-mar-jue.sql.
-- -----------------------------------------------------------------------------

INSERT INTO franja_horaria (hora_inicio, hora_fin, orden, dias) VALUES
    ('07:00','07:30', 1, NULL), ('07:30','08:00', 2, NULL), ('08:00','08:30', 3, NULL), ('08:30','09:00', 4, NULL),
    ('09:00','09:30', 5, NULL), ('09:30','10:00', 6, NULL), ('10:00','10:30', 7, NULL), ('10:30','11:00', 8, NULL),
    ('11:00','11:30', 9, NULL), ('11:30','12:00',10, NULL), ('12:00','12:30',11, NULL), ('12:30','13:00',12, NULL),
    ('13:00','13:30',13, NULL), ('13:30','14:00',14, NULL),
    ('14:00','14:30',15, 'martes,jueves'),
    ('16:00','16:30',16, NULL), ('16:30','17:00',17, NULL), ('17:00','17:30',18, NULL), ('17:30','18:00',19, NULL),
    ('18:00','18:30',20, NULL), ('18:30','19:00',21, NULL), ('19:00','19:30',22, NULL), ('19:30','20:00',23, NULL);

-- 2026-10-06: de 20:00 a 22:00 solo para Estadística. Ver
-- migracion-2026-10-06-franjas-2000-2200-estadistica.sql.
INSERT INTO franja_horaria (hora_inicio, hora_fin, orden, dias, departamento_id)
SELECT h.ini, h.fin, h.orden, NULL, d.id
  FROM departamento d
 CROSS JOIN (SELECT '20:00' AS ini, '20:30' AS fin, 24 AS orden UNION ALL
             SELECT '20:30', '21:00', 25 UNION ALL SELECT '21:00', '21:30', 26 UNION ALL
             SELECT '21:30', '22:00', 27) h
 WHERE d.clave_prefijo = 'EST';

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
-- Salones: NINGUNO (desde 2026-10-13).
--
-- Hasta esa fecha aqui se sembraban 7 salones de ejemplo (RH107, RH109, RH301,
-- PF105, RHB-1, RHB-2, RHCC302) con disponibilidad permisiva para los 3
-- departamentos, solo para probar el esquema. Se quitaron porque la descarga
-- para el motor los tomaria como reales (ver
-- limpieza-2026-10-13-salones-ejemplo.sql, que los borra de una base que ya
-- los tenia). Los salones reales y su disponibilidad por departamento los
-- asigna Servicios Escolares cada semestre y se cargaran aparte; mientras
-- tanto el motor corre en modo sin salones (D44).
-- -----------------------------------------------------------------------------
