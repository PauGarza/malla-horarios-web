<?php
// =============================================================================
// Respuestas del cuestionario y bloqueos de jefatura (vista de jefatura).
//
//   GET  ?semestre_id=N[&departamento_id=D]
//        -> { secciones[], profesores[], niveles{}, bloqueos[], verdes[] }
//
//   POST ?recurso=bloqueo&semestre_id=N[&departamento_id=D]
//        { profesor_id, materia_id, bloqueado: bool }  -> { ok, bloqueado, verde }
//
//   POST ?recurso=verde&semestre_id=N[&departamento_id=D]
//        { profesor_id, materia_id, verde: bool }      -> { ok, bloqueado, verde }
//        (2026-10-21) El inverso del bloqueo: "para el motor, este profesor
//        tiene esta materia en verde", contestara lo que contestara. Va en
//        verde_profesor_materia, con las mismas reglas que el bloqueo. Un par
//        no puede estar bloqueado y en verde: poner uno quita el otro en la
//        misma transacción, y la respuesta trae cómo quedaron los dos.
//
//   POST ?recurso=num_cursos&semestre_id=N[&departamento_id=D]
//        { profesor_id, num_cursos: 0-6 | null }  -> { ok, ajuste }
//        Sobreescribe el número de cursos que pidió el profesor; null quita
//        el ajuste y vuelve a valer el suyo. Misma idea que el bloqueo: va en
//        ajuste_num_cursos, preferencia.num_cursos_max no se toca y el
//        profesor nunca lo ve (cuestionario.php y preferencia.php no leen esa
//        tabla).
//
// Es la matriz profesores × materias: lo que contestó cada quien, y encima la
// capa de bloqueos (y, desde 2026-10-21, la de verdes de jefatura). Un bloqueo dice "este profesor NO da esta materia" y el
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
// POST ?recurso=num_cursos
// -----------------------------------------------------------------------------

if (metodo_http() === 'POST' && filter_input(INPUT_GET, 'recurso') === 'num_cursos') {
    exigir_semestre_activo($pdo, $semestreId);
    $body       = cuerpo_json();
    $profesorId = filter_var(isset($body['profesor_id']) ? $body['profesor_id'] : null, FILTER_VALIDATE_INT);
    if ($profesorId === false || $profesorId === null) {
        error_json('Falta profesor_id', 400);
    }
    // null (o ausente) quita el ajuste; si viene, entero de 0 a 6. 0 es "no
    // se le asignan cursos", que el profesor no puede pedir pero la jefatura
    // sí decide.
    $quitar = !array_key_exists('num_cursos', $body) || $body['num_cursos'] === null;
    $num    = $quitar ? null : filter_var($body['num_cursos'], FILTER_VALIDATE_INT, [
        'options' => ['min_range' => 0, 'max_range' => 6],
    ]);
    if (!$quitar && ($num === false || $num === null)) {
        error_json('El número de cursos debe ser un entero de 0 a 6', 400);
    }

    $st = $pdo->prepare('SELECT departamento_id FROM profesor WHERE id = ?');
    $st->execute([(int) $profesorId]);
    $deptoProfesor = $st->fetchColumn();
    if ($deptoProfesor === false) {
        error_json('No existe ese profesor', 404);
    }
    if ($deptoProfesor === null || (int) $deptoProfesor !== $deptoId) {
        error_json('Ese profesor no es de este departamento', 403);
    }
    exigir_jefe_de((int) $deptoProfesor);

    try {
        if ($quitar) {
            $pdo->prepare('DELETE FROM ajuste_num_cursos WHERE profesor_id = ? AND semestre_id = ?')
                ->execute([(int) $profesorId, $semestreId]);
            responder(['ok' => true, 'ajuste' => null]);
        }
        $ahora = ahora_utc();
        $pdo->prepare(
            'INSERT INTO ajuste_num_cursos (profesor_id, semestre_id, num_cursos, ajustado_por, ajustado_at)
                  VALUES (?,?,?,?,?)
             ON DUPLICATE KEY UPDATE num_cursos = VALUES(num_cursos),
                                     ajustado_por = VALUES(ajustado_por),
                                     ajustado_at = VALUES(ajustado_at)'
        )->execute([(int) $profesorId, $semestreId, $num, mi_id(), $ahora]);
    } catch (Throwable $e) {
        fallo_interno('respuestas.php num_cursos', $e, 'No se pudo guardar el número de cursos');
    }

    $yo = mi_perfil();
    responder(['ok' => true, 'ajuste' => [
        'num_cursos' => $num,
        'por'        => $yo['nombre'],
        'at'         => $ahora,
    ]]);
}

// -----------------------------------------------------------------------------
// POST ?recurso=bloqueo | ?recurso=verde
// -----------------------------------------------------------------------------

if (metodo_http() === 'POST') {
    exigir_semestre_activo($pdo, $semestreId);
    $recurso = filter_input(INPUT_GET, 'recurso');
    if ($recurso !== 'bloqueo' && $recurso !== 'verde') {
        error_json('Recurso no soportado', 400);
    }
    $body       = cuerpo_json();
    $profesorId = filter_var(isset($body['profesor_id']) ? $body['profesor_id'] : null, FILTER_VALIDATE_INT);
    $materiaId  = filter_var(isset($body['materia_id']) ? $body['materia_id'] : null, FILTER_VALIDATE_INT);
    if ($profesorId === false || $profesorId === null || $materiaId === false || $materiaId === null) {
        error_json('Faltan profesor_id y materia_id', 400);
    }
    $esBloqueo = $recurso === 'bloqueo';
    $activar   = !empty($body[$esBloqueo ? 'bloqueado' : 'verde']);

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

    // Nombres fijos, nunca del cliente: solo eligen entre las dos tablas.
    $tabla = $esBloqueo ? 'bloqueo_profesor_materia' : 'verde_profesor_materia';
    $otra  = $esBloqueo ? 'verde_profesor_materia' : 'bloqueo_profesor_materia';
    $quien = $esBloqueo ? 'bloqueado_por, bloqueado_at' : 'marcado_por, marcado_at';
    $par   = [(int) $profesorId, (int) $materiaId, $semestreId];

    $pdo->beginTransaction();
    try {
        if ($activar) {
            $pdo->prepare(
                "INSERT IGNORE INTO $tabla (profesor_id, materia_id, semestre_id, $quien) VALUES (?,?,?,?,?)"
            )->execute(array_merge($par, [mi_id(), ahora_utc()]));
            $pdo->prepare("DELETE FROM $otra WHERE profesor_id = ? AND materia_id = ? AND semestre_id = ?")
                ->execute($par);
        } else {
            $pdo->prepare("DELETE FROM $tabla WHERE profesor_id = ? AND materia_id = ? AND semestre_id = ?")
                ->execute($par);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fallo_interno("respuestas.php $recurso", $e, $esBloqueo ? 'No se pudo guardar el bloqueo' : 'No se pudo guardar el verde');
    }

    $hay = static function (string $t) use ($pdo, $par): bool {
        $st = $pdo->prepare("SELECT 1 FROM $t WHERE profesor_id = ? AND materia_id = ? AND semestre_id = ?");
        $st->execute($par);
        return (bool) $st->fetchColumn();
    };
    responder([
        'ok'        => true,
        'bloqueado' => $hay('bloqueo_profesor_materia'),
        'verde'     => $hay('verde_profesor_materia'),
    ]);
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
    $profesores[] = [
        'id'              => (int) $p['id'],
        'nombre'          => $p['nombre'],
        'tipo_contrato'   => $p['tipo_contrato'],
        'estado_especial' => $p['estado_especial'],
        'estado'          => $p['estado'] === null ? 'no_iniciado' : $p['estado'],
        'num_cursos_max'  => $p['num_cursos_max'] === null ? null : (int) $p['num_cursos_max'],
        // Lo que puso la jefatura encima; null = vale el del profesor.
        'ajuste_cursos'   => $p['ajuste_num_cursos'] === null ? null : [
            'num_cursos' => (int) $p['ajuste_num_cursos'],
            'por'        => $p['ajustado_por'],
            'at'         => $p['ajustado_at'],
        ],
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

$st = $pdo->prepare(
    'SELECT v.profesor_id, v.materia_id
       FROM verde_profesor_materia v
       JOIN materia m ON m.id = v.materia_id
      WHERE v.semestre_id = ? AND m.departamento_id = ?'
);
$st->execute([$semestreId, $deptoId]);
$verdes = [];
foreach ($st->fetchAll() as $v) {
    $verdes[] = [(int) $v['profesor_id'], (int) $v['materia_id']];
}

responder([
    'publicado'  => $completo['publicado'],
    'secciones'  => $secciones,
    'profesores' => $profesores,
    'niveles'    => (object) $niveles,
    'bloqueos'   => $bloqueos,
    'verdes'     => $verdes,
]);
