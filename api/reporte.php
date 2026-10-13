<?php
// =============================================================================
// Reporte de preferencias por profesor (vista de jefatura).
//
//   GET ?semestre_id=N[&departamento_id=D]                -> { profesores[] }
//   GET ?recurso=horas&semestre_id=N[&departamento_id=D]  -> { profesores[], celdas[] }
//
// (El segundo alimenta el mapa de calor de "Reporte de horas"; ver abajo.)
//
// Una fila por profesor del departamento con lo que pidió, ya contado:
// cuántos cursos quiere dar (num_cursos_max), cuántas materias marcó en
// verde/amarillo/rojo (y cuáles, en lista_materias) y cuántas horas de la
// rejilla marcó en cada color.
//
// Para la tabla por profesor las horas se suman en SQL: ahí solo hace falta el
// total por color, no las rejillas. El mapa de calor sí manda las celdas,
// porque enseña quién pidió cada una.
//
// Las horas salen de la duración de cada franja (hora_fin - hora_inicio) y no
// de "celdas × 0.5": hoy todas duran 30 min, pero el catálogo ya tuvo
// excepciones (14:00-14:30 mar/jue, 20:00-22:00 de Estadística) y una franja
// de otra duración no debe descuadrar el reporte.
//
// Los niveles son los que dio el profesor, sin aplicar bloqueos de jefatura:
// el reporte dice qué pidió cada quien, no qué le queda para el motor. Las
// celdas de la rejilla que dejó sin marcar no cuentan en ningún color.
//
// Autorización (la misma de respuestas.php):
//   exigir_rol(ROLES_GESTION) + departamento_objetivo(): jefe_departamento solo
//   el suyo, admin cualquiera.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

exigir_metodo('GET');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$deptoId    = departamento_objetivo();   // ya corrió exigir_jefe_de()
$semestreId = param_id('semestre_id');

$NIVELES = ['verde', 'amarillo', 'rojo'];
$enCero  = array_fill_keys($NIVELES, 0);

// Mismo criterio que panel.php y respuestas.php: quien no da clases, las
// cuentas de prueba y quien ya se jubiló no cuentan.
$st = $pdo->prepare(
    'SELECT p.id, p.nombre, p.tipo_contrato, p.estado_especial,
            pref.estado, pref.num_cursos_max,
            anc.num_cursos AS ajuste_num_cursos, anc.ajustado_at, quien.nombre AS ajustado_por
       FROM profesor p
       LEFT JOIN preferencia pref ON pref.profesor_id = p.id AND pref.semestre_id = ?
       LEFT JOIN ajuste_num_cursos anc ON anc.profesor_id = p.id AND anc.semestre_id = ?
       LEFT JOIN profesor quien ON quien.id = anc.ajustado_por
      WHERE p.departamento_id = ? AND p.tipo_contrato IS NOT NULL AND p.activo = 1
      ORDER BY p.nombre'
);
$st->execute([$semestreId, $semestreId, $deptoId]);
$profesores = [];
foreach ($st->fetchAll() as $p) {
    $profesores[(int) $p['id']] = [
        'id'              => (int) $p['id'],
        'nombre'          => $p['nombre'],
        'tipo_contrato'   => $p['tipo_contrato'],
        'estado_especial' => $p['estado_especial'],
        'estado'          => $p['estado'] === null ? 'no_iniciado' : $p['estado'],
        'num_cursos_max'  => $p['num_cursos_max'] === null ? null : (int) $p['num_cursos_max'],
        // El de la jefatura (respuestas.php?recurso=num_cursos), si lo hay.
        'ajuste_cursos'   => $p['ajuste_num_cursos'] === null ? null : [
            'num_cursos' => (int) $p['ajuste_num_cursos'],
            'por'        => $p['ajustado_por'],
            'at'         => $p['ajustado_at'],
        ],
        'materias'        => $enCero,
        'lista_materias'  => array_fill_keys($NIVELES, []),
        'horas'           => $enCero,
    ];
}

// -----------------------------------------------------------------------------
// ?recurso=horas — el mapa de calor
// -----------------------------------------------------------------------------
// Las celdas marcadas de cada profesor, sin sumar: la vista filtra por estado,
// contrato y nivel en el navegador y al hacer clic enseña quiénes pidieron
// esa celda, así que necesita saber de quién es cada una. ~45 rejillas de a lo
// más ~135 celdas son unas 6,000 filas de 4 números.

if (filter_input(INPUT_GET, 'recurso') === 'horas') {
    $st = $pdo->prepare(
        'SELECT pref.profesor_id, d.dia, d.franja_id, d.nivel
           FROM preferencia pref
           JOIN profesor p ON p.id = pref.profesor_id
           JOIN disponibilidad d ON d.preferencia_id = pref.id
          WHERE pref.semestre_id = ? AND p.departamento_id = ?'
    );
    $st->execute([$semestreId, $deptoId]);
    $celdas = [];
    foreach ($st->fetchAll() as $f) {
        if (isset($profesores[(int) $f['profesor_id']])) {
            $celdas[] = [(int) $f['profesor_id'], $f['dia'], (int) $f['franja_id'], $f['nivel']];
        }
    }

    responder([
        'profesores' => array_map(static function ($p) {
            return [
                'id'            => $p['id'],
                'nombre'        => $p['nombre'],
                'tipo_contrato' => $p['tipo_contrato'],
                'estado'        => $p['estado'],
            ];
        }, array_values($profesores)),
        'celdas' => $celdas,
    ]);
}

// Fila por materia y no COUNT(*): la vista enseña cuáles son al hacer clic en
// un conteo. El nombre es el mismo que vio el profesor en el formulario
// (etiqueta del cuestionario si la hay, si no materia.nombre; ver
// lib/catalogo.php). Con ~45 profesores × ~50 materias son ~2,000 filas.
$st = $pdo->prepare(
    'SELECT pref.profesor_id, pm.nivel, m.clave,
            COALESCE(mc.etiqueta, m.nombre) AS nombre_mostrado
       FROM preferencia pref
       JOIN profesor p ON p.id = pref.profesor_id
       JOIN preferencia_materia pm ON pm.preferencia_id = pref.id
       JOIN materia m ON m.id = pm.materia_id
       LEFT JOIN materia_cuestionario mc
              ON mc.materia_id = pm.materia_id AND mc.semestre_id = pref.semestre_id
      WHERE pref.semestre_id = ? AND p.departamento_id = ?
      ORDER BY nombre_mostrado'
);
$st->execute([$semestreId, $deptoId]);
foreach ($st->fetchAll() as $f) {
    $id = (int) $f['profesor_id'];
    if (isset($profesores[$id])) {
        $profesores[$id]['materias'][$f['nivel']]++;
        $profesores[$id]['lista_materias'][$f['nivel']][] = [
            'clave'  => $f['clave'],
            'nombre' => $f['nombre_mostrado'],
        ];
    }
}

// TIME_TO_SEC en vez de TIMESTAMPDIFF: las columnas son TIME, no DATETIME.
$st = $pdo->prepare(
    'SELECT pref.profesor_id, d.nivel,
            SUM(TIME_TO_SEC(f.hora_fin) - TIME_TO_SEC(f.hora_inicio)) AS segundos
       FROM preferencia pref
       JOIN profesor p ON p.id = pref.profesor_id
       JOIN disponibilidad d ON d.preferencia_id = pref.id
       JOIN franja_horaria f ON f.id = d.franja_id
      WHERE pref.semestre_id = ? AND p.departamento_id = ?
      GROUP BY pref.profesor_id, d.nivel'
);
$st->execute([$semestreId, $deptoId]);
foreach ($st->fetchAll() as $f) {
    $id = (int) $f['profesor_id'];
    if (isset($profesores[$id])) {
        $profesores[$id]['horas'][$f['nivel']] = round((int) $f['segundos'] / 3600, 2);
    }
}

responder(['profesores' => array_values($profesores)]);
