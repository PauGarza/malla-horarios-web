<?php
// =============================================================================
// Respuestas del cuestionario y bloqueos de jefatura (vista de jefatura).
//
//   GET  ?semestre_id=N[&departamento_id=D]
//        -> { secciones[], profesores[], niveles{}, bloqueos[] }
//
//   POST ?recurso=bloqueo&semestre_id=N[&departamento_id=D]
//        { profesor_id, materia_id, bloqueado: bool }  -> { ok, bloqueado }
//
// Es la matriz profesores × materias: lo que contestó cada quien, y encima la
// capa de bloqueos. Un bloqueo dice "este profesor NO da esta materia" y el
// motor lo toma como restricción dura. Va en una tabla aparte a propósito
// (bloqueo_profesor_materia): la respuesta del profesor no se toca, al
// desbloquear vuelve a contar tal como la dio, y el profesor nunca lo ve —
// ni cuestionario.php ni preferencia.php leen esa tabla.
//
// Reemplaza a la lista personalizada por profesor (2026-09-28): en vez de
// esconderle materias a alguien antes de que conteste (y que se pregunte por
// qué a su colega le salen otras), todos ven lo mismo y la jefatura decide
// después.
//
// Autorización (equivalente de departamento_preferencia_select y parientes):
//   exigir_rol(ROLES_GESTION) + departamento_objetivo(): jefe_departamento solo
//   el suyo, jefe_division y admin cualquiera. El profesor y la materia de un
//   bloqueo tienen que ser de ese departamento.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET', 'POST');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$deptoId    = departamento_objetivo();   // ya corrió exigir_jefe_de()
$semestreId = param_id('semestre_id');

// -----------------------------------------------------------------------------
// POST ?recurso=bloqueo
// -----------------------------------------------------------------------------

if (metodo_http() === 'POST') {
    exigir_semestre_activo($pdo, $semestreId);
    if (filter_input(INPUT_GET, 'recurso') !== 'bloqueo') {
        error_json('Recurso no soportado', 400);
    }
    $body       = cuerpo_json();
    $profesorId = filter_var(isset($body['profesor_id']) ? $body['profesor_id'] : null, FILTER_VALIDATE_INT);
    $materiaId  = filter_var(isset($body['materia_id']) ? $body['materia_id'] : null, FILTER_VALIDATE_INT);
    if ($profesorId === false || $profesorId === null || $materiaId === false || $materiaId === null) {
        error_json('Faltan profesor_id y materia_id', 400);
    }
    $bloquear = !empty($body['bloqueado']);

    $st = $pdo->prepare('SELECT departamento_id FROM profesor WHERE id = ?');
    $st->execute([(int) $profesorId]);
    $deptoProfesor = $st->fetchColumn();
    if ($deptoProfesor === false) {
        error_json('No existe ese profesor', 404);
    }
    // Las dos guardias: que sea del departamento sobre el que se trabaja, y
    // (redundante hoy, pero barato) que quien llama tenga alcance sobre él.
    if ($deptoProfesor === null || (int) $deptoProfesor !== $deptoId) {
        error_json('Ese profesor no es de este departamento', 403);
    }
    exigir_jefe_de((int) $deptoProfesor);
    if (departamento_de_materia((int) $materiaId) !== $deptoId) {
        error_json('Esa materia no es de este departamento', 403);
    }

    try {
        if ($bloquear) {
            $pdo->prepare(
                'INSERT IGNORE INTO bloqueo_profesor_materia
                        (profesor_id, materia_id, semestre_id, bloqueado_por, bloqueado_at)
                 VALUES (?,?,?,?,?)'
            )->execute([(int) $profesorId, (int) $materiaId, $semestreId, mi_id(), ahora_utc()]);
        } else {
            $pdo->prepare(
                'DELETE FROM bloqueo_profesor_materia
                  WHERE profesor_id = ? AND materia_id = ? AND semestre_id = ?'
            )->execute([(int) $profesorId, (int) $materiaId, $semestreId]);
        }
    } catch (Throwable $e) {
        fallo_interno('respuestas.php bloqueo', $e, 'No se pudo guardar el bloqueo');
    }

    responder(['ok' => true, 'bloqueado' => $bloquear]);
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

$completo = formulario_completo($pdo, $deptoId, $semestreId);

// Las columnas: solo secciones de materias, con lo que la tabla necesita.
$secciones = [];
foreach ($completo['secciones'] as $s) {
    if ($s['tipo'] !== 'materias' || $s['materias'] === []) {
        continue;
    }
    $secciones[] = [
        'id'        => $s['id'],
        'titulo'    => $s['titulo'],
        'audiencia' => $s['audiencia'],
        'materias'  => array_map(static function ($m) {
            return ['id' => $m['id'], 'clave' => $m['clave'], 'nombreMostrado' => $m['nombreMostrado']];
        }, $s['materias']),
    ];
}

// Mismo criterio que panel.php: quien no da clases, las cuentas de prueba y
// quien ya se jubiló no cuentan.
$st = $pdo->prepare(
    'SELECT p.id, p.nombre, p.tipo_contrato, p.estado_especial,
            pref.estado, pref.num_cursos_max
       FROM profesor p
       LEFT JOIN preferencia pref ON pref.profesor_id = p.id AND pref.semestre_id = ?
      WHERE p.departamento_id = ? AND p.tipo_contrato IS NOT NULL AND p.activo = 1
      ORDER BY p.nombre'
);
$st->execute([$semestreId, $deptoId]);
$profesores = [];
foreach ($st->fetchAll() as $p) {
    $profesores[] = [
        'id'              => (int) $p['id'],
        'nombre'          => $p['nombre'],
        'tipo_contrato'   => $p['tipo_contrato'],
        'estado_especial' => $p['estado_especial'],
        'estado'          => $p['estado'] === null ? 'no_iniciado' : $p['estado'],
        'num_cursos_max'  => $p['num_cursos_max'] === null ? null : (int) $p['num_cursos_max'],
    ];
}

$st = $pdo->prepare(
    'SELECT pref.profesor_id, pm.materia_id, pm.nivel
       FROM preferencia pref
       JOIN profesor p ON p.id = pref.profesor_id
       JOIN preferencia_materia pm ON pm.preferencia_id = pref.id
      WHERE pref.semestre_id = ? AND p.departamento_id = ?'
);
$st->execute([$semestreId, $deptoId]);
$niveles = [];
foreach ($st->fetchAll() as $n) {
    $niveles[(string) (int) $n['profesor_id']][(string) (int) $n['materia_id']] = $n['nivel'];
}

$st = $pdo->prepare(
    'SELECT b.profesor_id, b.materia_id
       FROM bloqueo_profesor_materia b
       JOIN materia m ON m.id = b.materia_id
      WHERE b.semestre_id = ? AND m.departamento_id = ?'
);
$st->execute([$semestreId, $deptoId]);
$bloqueos = [];
foreach ($st->fetchAll() as $b) {
    $bloqueos[] = [(int) $b['profesor_id'], (int) $b['materia_id']];
}

responder([
    'publicado'  => $completo['publicado'],
    'secciones'  => $secciones,
    'profesores' => $profesores,
    'niveles'    => (object) $niveles,
    'bloqueos'   => $bloqueos,
]);
