<?php
// =============================================================================
// Asignaciones directas de la jefatura (antes de correr el motor).
//
//   GET    ?semestre_id=N[&departamento_id=D]
//          -> { materias[], profesores[], niveles{}, bloqueos[], asignaciones[] }
//   GET    ?recurso=disponibilidad&profesor_id=P&semestre_id=N[&departamento_id=D]
//          -> { celdas: [[dia, franja_id, nivel]] }
//   POST   ?semestre_id=N[&departamento_id=D]
//          { tipo, materia_id, profesor_id, horario: [[dia, franja_id]], nota }  -> { asignacion }
//   PUT    ?id=A&semestre_id=N[&departamento_id=D]   mismo cuerpo        -> { asignacion }
//   DELETE ?id=A&semestre_id=N[&departamento_id=D]                       -> { ok }
//
// Una asignación fija dice "un grupo de esta materia lo da este profesor" y,
// si trae horario, "en estos bloques". El motor la toma como restricción dura
// (ver bd/motor-asignacion.md). Una fila = un grupo: dos grupos de la misma
// materia con el mismo profesor son dos asignaciones.
//
// tipo = 'maestria' (2026-10-13): una materia de maestría que no está en el
// catálogo del departamento. No lleva materia_id; sirve para APARTAR horas del
// profesor (el motor no le pone nada ahí, como si fueran rojo) y no cuenta como
// curso ni como grupo. Por eso su horario es obligatorio y no se ata a
// créditos, y no le aplican los bloqueos. Qué materia es va, si acaso, en nota.
//
// Se rechaza (400/409) lo que el motor no podría cumplir nunca:
//   - materia o profesor de otro departamento, o profesor inactivo/sin contrato;
//   - un par profesor-materia bloqueado por la jefatura (hay que desbloquearlo
//     primero en Respuestas y bloqueos: las dos decisiones se contradicen);
//   - un horario que no sume materia.creditos bloques, con una franja que no
//     existe ese día o para ese departamento, o que choque con otra asignación
//     fija del mismo profesor.
// Lo que es una mala idea pero se puede (fijar en una hora que el profesor
// marcó en rojo, pasarse de sus cursos o de los grupos sugeridos) NO se
// rechaza: la vista lo avisa y la jefatura decide. Por eso cada bloque del
// horario viaja con el nivel que le dio el profesor.
//
// Autorización (la de respuestas.php): exigir_rol(ROLES_GESTION) +
// departamento_objetivo(). La asignación se guarda con ese departamento
// (asignacion_fija.departamento_id); la materia, si la hay, y el profesor
// tienen que ser de él.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET', 'POST', 'PUT', 'DELETE');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$deptoId    = departamento_objetivo();   // ya corrió exigir_jefe_de()
$semestreId = param_id('semestre_id');

const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

/**
 * Las asignaciones fijas del departamento en el semestre (o solo la $id), con
 * su horario y, por cada bloque, el nivel que el profesor le dio en su
 * disponibilidad (null = no lo marcó).
 */
function cargar_asignaciones(PDO $pdo, int $semestreId, int $deptoId, ?int $id = null): array
{
    $sql =
        'SELECT af.id, af.tipo, af.materia_id, af.profesor_id, af.nota, af.creado_at,
                quien.nombre AS creado_por
           FROM asignacion_fija af
           LEFT JOIN profesor quien ON quien.id = af.creado_por
          WHERE af.semestre_id = ? AND af.departamento_id = ?';
    $args = [$semestreId, $deptoId];
    if ($id !== null) {
        $sql   .= ' AND af.id = ?';
        $args[] = $id;
    }
    $st = $pdo->prepare($sql . ' ORDER BY af.id');
    $st->execute($args);

    $asignaciones = [];
    foreach ($st->fetchAll() as $f) {
        $asignaciones[(int) $f['id']] = [
            'id'          => (int) $f['id'],
            'tipo'        => $f['tipo'],
            'materia_id'  => $f['materia_id'] === null ? null : (int) $f['materia_id'],
            'profesor_id' => (int) $f['profesor_id'],
            'nota'        => $f['nota'],
            'creado_por'  => $f['creado_por'],
            'creado_at'   => $f['creado_at'],
            'horario'     => [],
        ];
    }
    if ($asignaciones === []) {
        return [];
    }

    // El horario, con el nivel de disponibilidad del profesor en cada bloque.
    $marcas = implode(',', array_fill(0, count($asignaciones), '?'));
    $st = $pdo->prepare(
        "SELECT afh.asignacion_fija_id, afh.dia, afh.franja_id, d.nivel
           FROM asignacion_fija_horario afh
           JOIN asignacion_fija af ON af.id = afh.asignacion_fija_id
           JOIN franja_horaria f ON f.id = afh.franja_id
           LEFT JOIN preferencia pref
                  ON pref.profesor_id = af.profesor_id AND pref.semestre_id = af.semestre_id
           LEFT JOIN disponibilidad d
                  ON d.preferencia_id = pref.id AND d.dia = afh.dia AND d.franja_id = afh.franja_id
          WHERE afh.asignacion_fija_id IN ($marcas)
          ORDER BY FIELD(afh.dia, 'lunes','martes','miercoles','jueves','viernes'), f.orden"
    );
    $st->execute(array_keys($asignaciones));
    foreach ($st->fetchAll() as $b) {
        $asignaciones[(int) $b['asignacion_fija_id']]['horario'][] =
            [$b['dia'], (int) $b['franja_id'], $b['nivel']];
    }

    return array_values($asignaciones);
}

/**
 * Valida el cuerpo de un POST/PUT y devuelve lo que se va a guardar. Corta con
 * 400/403/404/409 si algo no se puede.
 */
function validar_asignacion(PDO $pdo, int $semestreId, int $deptoId, array $body, ?int $excluirId): array
{
    $tipo = isset($body['tipo']) ? $body['tipo'] : 'materia';
    if (!in_array($tipo, ['materia', 'maestria'], true)) {
        error_json('tipo debe ser materia o maestria', 400);
    }
    $esMaestria = $tipo === 'maestria';

    $profesorId = filter_var(isset($body['profesor_id']) ? $body['profesor_id'] : null, FILTER_VALIDATE_INT);
    if ($profesorId === false || $profesorId === null) {
        error_json('Falta profesor_id', 400);
    }

    $materiaId = null;
    $materia   = ['nombre' => 'Materia de Maestría', 'creditos' => null];
    if (!$esMaestria) {
        $materiaId = filter_var(isset($body['materia_id']) ? $body['materia_id'] : null, FILTER_VALIDATE_INT);
        if ($materiaId === false || $materiaId === null) {
            error_json('Falta materia_id', 400);
        }
        $st = $pdo->prepare('SELECT nombre, creditos, departamento_id FROM materia WHERE id = ?');
        $st->execute([(int) $materiaId]);
        $materia = $st->fetch();
        if (!$materia) {
            error_json('No existe esa materia', 404);
        }
        if ((int) $materia['departamento_id'] !== $deptoId) {
            error_json('Esa materia no es de este departamento', 403);
        }
    }

    $st = $pdo->prepare('SELECT nombre, departamento_id, tipo_contrato, activo FROM profesor WHERE id = ?');
    $st->execute([(int) $profesorId]);
    $profesor = $st->fetch();
    if (!$profesor) {
        error_json('No existe ese profesor', 404);
    }
    if ($profesor['departamento_id'] === null || (int) $profesor['departamento_id'] !== $deptoId) {
        error_json('Ese profesor no es de este departamento', 403);
    }
    if ($profesor['tipo_contrato'] === null || (int) $profesor['activo'] !== 1) {
        error_json('Ese profesor no está activo o no tiene tipo de contrato', 400);
    }

    // Los bloqueos son por materia del catálogo: a maestría no le aplican.
    $st = $pdo->prepare(
        'SELECT 1 FROM bloqueo_profesor_materia WHERE profesor_id = ? AND materia_id = ? AND semestre_id = ?'
    );
    if (!$esMaestria && $st->execute([(int) $profesorId, (int) $materiaId, $semestreId]) && $st->fetchColumn()) {
        error_json(
            "{$materia['nombre']} está bloqueada para {$profesor['nombre']}. Desbloquéala primero en Respuestas y bloqueos.",
            409,
            'materia_bloqueada'
        );
    }

    $nota = texto_opcional($body, 'nota');
    if ($nota !== null && mb_strlen($nota) > 500) {
        error_json('La nota no puede pasar de 500 caracteres', 400);
    }

    // --- Horario (opcional; obligatorio en maestría, que solo sirve para eso) ---
    $horarioCrudo = isset($body['horario']) ? $body['horario'] : [];
    if (!is_array($horarioCrudo)) {
        error_json('El horario debe ser una lista de bloques', 400);
    }
    if ($esMaestria && $horarioCrudo === []) {
        error_json('Una materia de maestría necesita su horario: es lo que se le aparta al profesor', 400);
    }
    $horario = [];
    if ($horarioCrudo !== []) {
        $franjas = [];
        foreach ($pdo->query('SELECT id, dias, departamento_id, hora_inicio FROM franja_horaria')->fetchAll() as $f) {
            $franjas[(int) $f['id']] = $f;
        }
        foreach ($horarioCrudo as $bloque) {
            $dia     = is_array($bloque) && isset($bloque[0]) ? $bloque[0] : null;
            $franjaId = is_array($bloque) && isset($bloque[1]) ? filter_var($bloque[1], FILTER_VALIDATE_INT) : false;
            if (!in_array($dia, DIAS_VALIDOS, true) || $franjaId === false || !isset($franjas[$franjaId])) {
                error_json('Hay un bloque del horario con datos inválidos', 400);
            }
            $f = $franjas[$franjaId];
            $hora = substr($f['hora_inicio'], 0, 5);
            if ($f['dias'] !== null && $f['dias'] !== '' && !in_array($dia, explode(',', $f['dias']), true)) {
                error_json("La franja de las $hora no existe los $dia", 400);
            }
            if ($f['departamento_id'] !== null && (int) $f['departamento_id'] !== $deptoId) {
                error_json("La franja de las $hora no existe para este departamento", 400);
            }
            $horario["$dia|$franjaId"] = [$dia, $franjaId];
        }
        $horario  = array_values($horario);
        $creditos = $esMaestria ? null : (int) $materia['creditos'];
        if ($creditos !== null && count($horario) !== $creditos) {
            error_json(
                "{$materia['nombre']} lleva $creditos bloques de 30 min (" . ($creditos / 2) . ' h a la semana) y el horario tiene ' . count($horario),
                400
            );
        }

        // Choques con otras asignaciones fijas del mismo profesor, en
        // cualquier departamento (un profesor no se parte en dos).
        $st = $pdo->prepare(
            'SELECT afh.dia, afh.franja_id, COALESCE(m.nombre, \'una materia de maestría\') AS nombre
               FROM asignacion_fija af
               JOIN asignacion_fija_horario afh ON afh.asignacion_fija_id = af.id
               LEFT JOIN materia m ON m.id = af.materia_id
              WHERE af.profesor_id = ? AND af.semestre_id = ? AND af.id <> ?'
        );
        $st->execute([(int) $profesorId, $semestreId, $excluirId === null ? 0 : $excluirId]);
        $ocupado = [];
        foreach ($st->fetchAll() as $o) {
            $ocupado[$o['dia'] . '|' . (int) $o['franja_id']] = $o['nombre'];
        }
        foreach ($horario as [$dia, $franjaId]) {
            $clave = "$dia|$franjaId";
            if (isset($ocupado[$clave])) {
                $hora = substr($franjas[$franjaId]['hora_inicio'], 0, 5);
                $otra = $ocupado[$clave];
                error_json(
                    "{$profesor['nombre']} ya tiene fijada $otra el $dia a las $hora",
                    409,
                    'choque_horario'
                );
            }
        }
    }

    return [
        'tipo'        => $tipo,
        'materia_id'  => $materiaId === null ? null : (int) $materiaId,
        'profesor_id' => (int) $profesorId,
        'nota'        => $nota,
        'horario'     => $horario,
    ];
}

/** Corta con 404 si la asignación no existe en este semestre y departamento. */
function exigir_asignacion_del_depto(PDO $pdo, int $id, int $semestreId, int $deptoId): void
{
    $st = $pdo->prepare(
        'SELECT 1 FROM asignacion_fija af
          WHERE af.id = ? AND af.semestre_id = ? AND af.departamento_id = ?'
    );
    $st->execute([$id, $semestreId, $deptoId]);
    if (!$st->fetchColumn()) {
        error_json('No existe esa asignación en este departamento', 404);
    }
}

function guardar_horario(PDO $pdo, int $id, array $horario): void
{
    $pdo->prepare('DELETE FROM asignacion_fija_horario WHERE asignacion_fija_id = ?')->execute([$id]);
    $ins = $pdo->prepare('INSERT INTO asignacion_fija_horario (asignacion_fija_id, dia, franja_id) VALUES (?,?,?)');
    foreach ($horario as [$dia, $franjaId]) {
        $ins->execute([$id, $dia, $franjaId]);
    }
}

$metodo = metodo_http();

// -----------------------------------------------------------------------------
// Escrituras
// -----------------------------------------------------------------------------

if ($metodo === 'POST' || $metodo === 'PUT') {
    exigir_semestre_activo($pdo, $semestreId);
    $id = null;
    if ($metodo === 'PUT') {
        $id = param_id('id');
        exigir_asignacion_del_depto($pdo, $id, $semestreId, $deptoId);
    }
    $datos = validar_asignacion($pdo, $semestreId, $deptoId, cuerpo_json(), $id);

    $pdo->beginTransaction();
    try {
        if ($id === null) {
            $pdo->prepare(
                'INSERT INTO asignacion_fija
                        (semestre_id, tipo, departamento_id, materia_id, profesor_id, nota, creado_por, creado_at)
                 VALUES (?,?,?,?,?,?,?,?)'
            )->execute([
                $semestreId, $datos['tipo'], $deptoId, $datos['materia_id'], $datos['profesor_id'],
                $datos['nota'], mi_id(), ahora_utc(),
            ]);
            $id = (int) $pdo->lastInsertId();
        } else {
            $pdo->prepare(
                'UPDATE asignacion_fija SET tipo = ?, materia_id = ?, profesor_id = ?, nota = ? WHERE id = ?'
            )->execute([$datos['tipo'], $datos['materia_id'], $datos['profesor_id'], $datos['nota'], $id]);
        }
        guardar_horario($pdo, $id, $datos['horario']);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fallo_interno("asignaciones.php $metodo", $e, 'No se pudo guardar la asignación');
    }

    $guardada = cargar_asignaciones($pdo, $semestreId, $deptoId, $id);
    responder(['asignacion' => $guardada[0]], $metodo === 'POST' ? 201 : 200);
}

if ($metodo === 'DELETE') {
    exigir_semestre_activo($pdo, $semestreId);
    $id = param_id('id');
    exigir_asignacion_del_depto($pdo, $id, $semestreId, $deptoId);
    try {
        // asignacion_fija_horario se va por el ON DELETE CASCADE.
        $pdo->prepare('DELETE FROM asignacion_fija WHERE id = ?')->execute([$id]);
    } catch (Throwable $e) {
        fallo_interno('asignaciones.php DELETE', $e, 'No se pudo quitar la asignación');
    }
    responder(['ok' => true]);
}

// -----------------------------------------------------------------------------
// GET ?recurso=disponibilidad — la rejilla de un profesor, para fijar horario
// -----------------------------------------------------------------------------

if (filter_input(INPUT_GET, 'recurso') === 'disponibilidad') {
    $profesorId = param_id('profesor_id');
    $st = $pdo->prepare('SELECT departamento_id FROM profesor WHERE id = ?');
    $st->execute([$profesorId]);
    $deptoProfesor = $st->fetchColumn();
    if ($deptoProfesor === false) {
        error_json('No existe ese profesor', 404);
    }
    if ($deptoProfesor === null || (int) $deptoProfesor !== $deptoId) {
        error_json('Ese profesor no es de este departamento', 403);
    }
    $st = $pdo->prepare(
        'SELECT d.dia, d.franja_id, d.nivel
           FROM preferencia pref JOIN disponibilidad d ON d.preferencia_id = pref.id
          WHERE pref.profesor_id = ? AND pref.semestre_id = ?'
    );
    $st->execute([$profesorId, $semestreId]);
    $celdas = [];
    foreach ($st->fetchAll() as $c) {
        $celdas[] = [$c['dia'], (int) $c['franja_id'], $c['nivel']];
    }
    responder(['celdas' => $celdas]);
}

// -----------------------------------------------------------------------------
// GET — todo lo que la vista necesita
// -----------------------------------------------------------------------------

// Materias activas del departamento, más las inactivas que ya tengan una
// asignación (para no dejar una fila huérfana en la lista). El nombre es el
// del formulario si la jefatura le puso etiqueta.
$st = $pdo->prepare(
    'SELECT m.id, m.clave, COALESCE(mc.etiqueta, m.nombre) AS nombre_mostrado, m.creditos,
            ed.grupos_sugeridos
       FROM materia m
       LEFT JOIN materia_cuestionario mc ON mc.materia_id = m.id AND mc.semestre_id = ?
       LEFT JOIN estimacion_demanda ed  ON ed.materia_id = m.id AND ed.semestre_id = ?
      WHERE m.departamento_id = ?
        AND (m.activa = 1 OR EXISTS (SELECT 1 FROM asignacion_fija af
                                      WHERE af.materia_id = m.id AND af.semestre_id = ?))
      ORDER BY nombre_mostrado'
);
$st->execute([$semestreId, $semestreId, $deptoId, $semestreId]);
$materias = [];
foreach ($st->fetchAll() as $m) {
    $materias[] = [
        'id'               => (int) $m['id'],
        'clave'            => $m['clave'],
        'nombre'           => $m['nombre_mostrado'],
        'creditos'         => (int) $m['creditos'],
        'grupos_sugeridos' => $m['grupos_sugeridos'] === null ? null : (int) $m['grupos_sugeridos'],
    ];
}

// Mismo roster que panel.php y respuestas.php, con el número de cursos que
// cuenta (el ajuste de jefatura encima del suyo).
$st = $pdo->prepare(
    'SELECT p.id, p.nombre, p.tipo_contrato, pref.estado, pref.num_cursos_max,
            anc.num_cursos AS ajuste_num_cursos
       FROM profesor p
       LEFT JOIN preferencia pref ON pref.profesor_id = p.id AND pref.semestre_id = ?
       LEFT JOIN ajuste_num_cursos anc ON anc.profesor_id = p.id AND anc.semestre_id = ?
      WHERE p.departamento_id = ? AND p.tipo_contrato IS NOT NULL AND p.activo = 1
      ORDER BY p.nombre'
);
$st->execute([$semestreId, $semestreId, $deptoId]);
$profesores = [];
foreach ($st->fetchAll() as $p) {
    $profesores[] = [
        'id'            => (int) $p['id'],
        'nombre'        => $p['nombre'],
        'tipo_contrato' => $p['tipo_contrato'],
        'estado'        => $p['estado'] === null ? 'no_iniciado' : $p['estado'],
        'num_cursos'    => $p['ajuste_num_cursos'] !== null
            ? (int) $p['ajuste_num_cursos']
            : ($p['num_cursos_max'] === null ? null : (int) $p['num_cursos_max']),
        'cursos_ajustados' => $p['ajuste_num_cursos'] !== null,
    ];
}

// Lo que contestó cada quien por materia, para ordenar a los candidatos.
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
    'materias'     => $materias,
    'profesores'   => $profesores,
    'niveles'      => (object) $niveles,
    'bloqueos'     => $bloqueos,
    'asignaciones' => cargar_asignaciones($pdo, $semestreId, $deptoId),
]);
