"""Genera datos-planes-estudio-mysql.sql desde los planes de estudio de Oracle.

Uso (desde cualquier carpeta):

    py -I generar-planes-estudio.py <planesOracle.csv> <carreras.csv>

Las dos fuentes viven fuera de este repo, en el proyecto de DACC:

    DACC/MATERIAS/WEB/planesOracle.csv               (UTF-8)
    DACC/MATERIAS/herramientas/datos/carreras.csv    (latin-1)

Escribe datos-planes-estudio-mysql.sql junto a este script. El archivo generado
no se edita a mano: si cambian los planes, se vuelve a correr esto.

Solo toma las filas de materias MAT, EST y ACT (las únicas que pueden estar en
la tabla materia) y el SQL solo las cruza con las materias que YA existen en la
base: no da de alta ninguna materia.
"""

import csv
import os
import sys
from collections import defaultdict

PREFIJOS = ('MAT', 'EST', 'ACT')
FILAS_POR_INSERT = 500

# carreras.csv solo trae nombre para 13 carreras. Estas se completan a mano.
NOMBRES_EXTRA = {
    'M.A': 'LICENCIATURA EN MATEMÁTICAS APLICADAS',
    'ECO': 'LICENCIATURA EN ECONOMÍA',
}

SALIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'datos-planes-estudio-mysql.sql')


def sql_texto(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "''") + "'"


def leer_nombres(ruta):
    nombres = {}
    with open(ruta, encoding='latin-1', newline='') as f:
        for r in csv.DictReader(f):
            if r['NOMBRE'].strip():
                nombres[r['CARRERA'].strip()] = r['NOMBRE'].strip()
    nombres.update(NOMBRES_EXTRA)
    return nombres


def leer_planes(ruta):
    """Devuelve (filas DACE {(plan, clave): semestre}, versión vigente por carrera)."""
    filas = {}
    vigente = {}
    with open(ruta, encoding='utf-8-sig', newline='') as f:
        for r in csv.DictReader(f):
            carrera = r['SWVPLAN_CARRERA'].strip()
            version = r['SWVPLAN_TIPO_PLAN'].strip()
            # La vigente se decide con TODAS las filas, no solo las de DACE.
            if version > vigente.get(carrera, ''):
                vigente[carrera] = version
            if r['SWVPLAN_SUBJ'].strip() not in PREFIJOS:
                continue
            plan = carrera + '-' + version
            clave = r['SUBJ_CON_CRSE'].strip()
            semestre = int(r['SWVPLAN_SEMESTRE'])
            if not 1 <= semestre <= 12:
                sys.exit(f'Semestre fuera de rango: {plan} {clave} {semestre}')
            if (plan, clave) in filas and filas[(plan, clave)] != semestre:
                sys.exit(f'Clave repetida con dos semestres: {plan} {clave}')
            filas[(plan, clave)] = semestre
    return filas, vigente


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    filas, vigente = leer_planes(sys.argv[1])
    nombres = leer_nombres(sys.argv[2])

    por_plan = defaultdict(int)
    for plan, _ in filas:
        por_plan[plan] += 1
    planes = []
    for plan in sorted(por_plan):
        carrera, version = plan.rsplit('-', 1)
        nombre = f'{nombres.get(carrera, carrera)} (plan {version})'
        planes.append((plan, nombre, 1 if vigente[carrera] == version else 0))

    claves = {c for _, c in filas}
    lineas = [ENCABEZADO.format(
        planes=len(planes),
        vigentes=sum(a for _, _, a in planes),
        filas=len(filas),
        claves=len(claves),
    )]

    lineas.append('INSERT INTO tmp_plan (clave, nombre, activo) VALUES')
    lineas.append(',\n'.join(
        f'  ({sql_texto(p)}, {sql_texto(n)}, {a})' for p, n, a in planes) + ';')
    lineas.append('')

    lineas.append(TABLA_PEM)
    orden = sorted(filas.items(), key=lambda x: (x[0][0], x[1], x[0][1]))
    for i in range(0, len(orden), FILAS_POR_INSERT):
        bloque = orden[i:i + FILAS_POR_INSERT]
        lineas.append('INSERT INTO tmp_pem (plan, clave, semestre) VALUES')
        lineas.append(',\n'.join(
            f'  ({sql_texto(p)}, {sql_texto(c)}, {s})' for (p, c), s in bloque) + ';')
        lineas.append('')

    lineas.append(CIERRE)

    with open(SALIDA, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lineas))

    print(f'{len(planes)} planes ({sum(a for _, _, a in planes)} vigentes), '
          f'{len(filas)} filas, {len(claves)} claves -> {SALIDA}')


ENCABEZADO = """\
-- =============================================================================
-- Autoplanear — semestre de cada materia en cada plan de estudios
--
-- GENERADO por generar-planes-estudio.py: no se edita a mano. Si cambian los
-- planes, se vuelve a correr el script (ver bd/mysql/README.md).
--
-- Agregado 2026-10-21. Se pega en phpMyAdmin (base horariosdace, pestaña SQL)
-- DESPUÉS de migracion-2026-10-21-plan-estudio-clave.sql y de los datos-*
-- de materias.
--
-- Fuente: DACC/MATERIAS/WEB/planesOracle.csv, el export de Oracle de los
-- planes de licenciatura (una fila por carrera + versión + materia), con los
-- nombres de carrera de DACC/MATERIAS/herramientas/datos/carreras.csv.
--   * Un plan es carrera + versión: plan_estudio.clave = 'ACT-H', 'M.A-F'.
--   * Se cargan TODAS las versiones, porque los alumnos de semestres altos
--     siguen en planes viejos y esos planes usan claves que se siguen dando
--     (MAT-14100, MAT-22600, EST-14101, ACT-15352...). activo = 1 solo en la
--     versión más nueva de cada carrera (la letra más alta).
--   * ACT-H y M.A-F coinciden materia por materia y semestre por semestre con
--     los PDFs nuevos de "DACE/Planes de estudio/". Las tarjetas "Optativa" de
--     esos PDFs no tienen clave y no se cargan.
--
-- En el CSV: {planes} planes ({vigentes} vigentes) con materias MAT, EST o ACT,
-- {filas} filas, {claves} claves distintas.
--
-- NO da de alta materias: cada fila se cruza con materia por clave, y la que
-- no está en la base se descarta. Tampoco crea un plan sin ninguna materia en
-- la base.
--
-- Idempotente: ON DUPLICATE KEY UPDATE por plan_estudio.clave y por
-- (plan_estudio_id, materia_id). Correrlo otra vez corrige semestres, nombres
-- y vigencia sin duplicar. Una fila que ya no esté en el CSV NO se borra.
--
-- tmp_plan y tmp_pem son tablas temporales: viven solo mientras dura esta
-- ejecución. Cada consulta usa cada una a lo más una vez (MySQL no deja
-- reabrir una tabla temporal dentro de la misma consulta).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

CREATE TEMPORARY TABLE tmp_plan (
    clave  VARCHAR(10)  NOT NULL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    activo TINYINT(1)   NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

TABLA_PEM = """\
CREATE TEMPORARY TABLE tmp_pem (
    plan     VARCHAR(10) NOT NULL,
    clave    VARCHAR(20) NOT NULL,
    semestre INT         NOT NULL,
    PRIMARY KEY (plan, clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""

CIERRE = """\
-- Solo los planes con al menos una materia que ya existe en la base.
INSERT INTO plan_estudio (clave, nombre, activo)
SELECT p.clave, p.nombre, p.activo
  FROM tmp_plan p
 WHERE EXISTS (SELECT 1
                 FROM tmp_pem t
                 JOIN materia m ON m.clave = t.clave COLLATE utf8mb4_unicode_ci
                WHERE t.plan = p.clave)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), activo = VALUES(activo);

-- Solo las materias que ya existen en la base.
INSERT INTO plan_estudio_materia (plan_estudio_id, materia_id, semestre_plan)
SELECT pe.id, m.id, t.semestre
  FROM tmp_pem t
  JOIN plan_estudio pe ON pe.clave = t.plan  COLLATE utf8mb4_unicode_ci
  JOIN materia m       ON m.clave  = t.clave COLLATE utf8mb4_unicode_ci
ON DUPLICATE KEY UPDATE semestre_plan = VALUES(semestre_plan);

COMMIT;

DROP TEMPORARY TABLE tmp_plan;
DROP TEMPORARY TABLE tmp_pem;

-- -----------------------------------------------------------------------------
-- Después: cuántos planes y filas quedaron
-- -----------------------------------------------------------------------------
SELECT (SELECT COUNT(*) FROM plan_estudio)                        AS planes,
       (SELECT SUM(activo) FROM plan_estudio)                     AS vigentes,
       (SELECT COUNT(*) FROM plan_estudio_materia)                AS filas,
       (SELECT COUNT(DISTINCT materia_id) FROM plan_estudio_materia) AS materias_con_semestre,
       (SELECT COUNT(*) FROM materia)                             AS materias_en_la_base;

-- -----------------------------------------------------------------------------
-- Otras consultas útiles (comentadas)
-- -----------------------------------------------------------------------------
-- Materias de la base que no quedaron en ningún plan (no están en el export
-- de Oracle, ej. EST-24108 Regresión Avanzada):
--
--   SELECT m.clave, m.nombre, m.activa
--     FROM materia m
--     LEFT JOIN plan_estudio_materia pem ON pem.materia_id = m.id
--    WHERE pem.id IS NULL
--    ORDER BY m.clave;
--
-- Semestre de cada materia en los planes vigentes de Actuaría y Matemáticas
-- Aplicadas (debe coincidir con los PDFs; ej. MAT-12200 Cálculo Univariado en
-- 2o de ACT-H y en 1o de M.A-F):
--
--   SELECT pe.clave AS plan, pem.semestre_plan, m.clave, m.nombre
--     FROM plan_estudio_materia pem
--     JOIN plan_estudio pe ON pe.id = pem.plan_estudio_id
--     JOIN materia m       ON m.id  = pem.materia_id
--    WHERE pe.clave IN ('ACT-H', 'M.A-F')
--    ORDER BY pe.clave, pem.semestre_plan, m.clave;
--
-- En qué semestre va una materia, en todos los planes vigentes:
--
--   SELECT m.clave, pe.clave AS plan, pem.semestre_plan
--     FROM plan_estudio_materia pem
--     JOIN plan_estudio pe ON pe.id = pem.plan_estudio_id AND pe.activo = 1
--     JOIN materia m       ON m.id  = pem.materia_id
--    WHERE m.clave = 'MAT-12200'
--    ORDER BY pem.semestre_plan, pe.clave;
--
-- Los acentos: si ves "ACTUARÃA", el pegado no fue en utf8mb4 (ver
-- migracion-pasos.md, "Los acentos").
"""

if __name__ == '__main__':
    main()
