<?php
// =============================================================================
// GET ?semestre_id=N  -> { preferencia, materias[], disponibilidad[], respuestas[] }
// PUT ?semestre_id=N  -> { id, estado }
//
// La propia preferencia del profesor que llama. Es el endpoint que guarda lo
// que capturan los profesores y el que arregla un problema real del diseño
// anterior: el frontend hacía DELETE de preferencia_materia y luego INSERT
// masivo en DOS peticiones HTTP separadas (más otras dos para disponibilidad).
// Si la segunda fallaba, el profesor se quedaba con sus respuestas borradas.
// Aquí es una transacción.
//
// Desde 2026-09-28:
//   - Solo se guarda si la jefatura ya publicó el formulario (409 no_publicado).
//   - Todo se valida contra el formulario que ve ESTE profesor
//     (cuestionario_de): materias o preguntas que no están en su formulario se
//     descartan en silencio — puede pasar si la jefatura editó el formulario
//     mientras alguien lo llenaba, y no debe costarle su borrador.
//   - Los mínimos para enviar se revisan también aquí, no solo en la pantalla.
//   - Las preguntas abiertas van en preferencia_respuesta; las columnas
//     horarios_otro_depto / observaciones_* quedaron obsoletas y no se tocan.
//
// Políticas que reemplaza:
//   propia_preferencia_select      -> WHERE profesor_id = mi_id()
//   propia_preferencia_insert      -> profesor_id se escribe con mi_id(),
//                                     nunca con lo que venga en el cuerpo
//   propia_preferencia_update      -> exige estado = 'borrador'
//   propia_preferencia_materia     -> preferencia_id derivado de mi_id()
//   propia_disponibilidad          -> igual
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET', 'PUT');

$pdo        = db();
$yo         = mi_id();
$semestreId = param_id('semestre_id');

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

if (metodo_http() === 'GET') {
    responder(preferencia_de($pdo, $yo, $semestreId));
}

// -----------------------------------------------------------------------------
// PUT: guardar borrador o enviar
// -----------------------------------------------------------------------------

exigir_semestre_activo($pdo, $semestreId);
$cuestionario = cuestionario_de($pdo, mi_perfil(), $semestreId);
if (!$cuestionario['publicado']) {
    error_json(
        'El formulario de este semestre todavía no está abierto.',
        409,
        'no_publicado'
    );
}

$body   = cuerpo_json();
$estado = isset($body['estado']) ? (string) $body['estado'] : 'borrador';
if (!in_array($estado, ['borrador', 'enviado'], true)) {
    error_json('Estado inválido', 400);
}

// La pregunta de número de cursos es opcional desde 2026-10-02: la jefatura la
// puede quitar del formulario. Si este profesor no la tiene, se guarda NULL y
// se ignora lo que mande; si la tiene, es obligatoria.
$pideNumCursos = false;
foreach ($cuestionario['secciones'] as $s) {
    if ($s['tipo'] === 'num_cursos') {
        $pideNumCursos = true;
    }
}
$numCursos = null;
if ($pideNumCursos) {
    $numCursos = filter_var(isset($body['num_cursos_max']) ? $body['num_cursos_max'] : null, FILTER_VALIDATE_INT);
    // Se valida aquí y no solo con el CHECK porque en MySQL < 8.0.16 los CHECK se
    // ignoran en silencio (ver bd/mysql/README.md) y este es el único camino por el
    // que ese valor entra a la base.
    if ($numCursos === false || $numCursos === null || $numCursos < 1 || $numCursos > 6) {
        error_json('El número de cursos debe estar entre 1 y 6', 400, 'cursos_invalidos');
    }
}

$nivelesValidos = ['verde', 'amarillo', 'rojo'];
$dias           = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

// Lo que este profesor puede contestar, según su formulario.
$coberturaPorMateria = [];
$abiertas            = [];
foreach ($cuestionario['secciones'] as $s) {
    if ($s['tipo'] === 'materias') {
        foreach ($s['materias'] as $m) {
            $coberturaPorMateria[$m['id']] = $m['cobertura_departamental'] ? 1 : 0;
        }
    } elseif ($s['tipo'] === 'abierta') {
        $abiertas[$s['id']] = true;
    }
}

// --- Validar y normalizar el cuerpo ANTES de abrir la transacción -----------

$niveles = [];
if (isset($body['materias']) && is_array($body['materias'])) {
    foreach ($body['materias'] as $m) {
        $materiaId = is_array($m)
            ? filter_var(isset($m['materia_id']) ? $m['materia_id'] : null, FILTER_VALIDATE_INT)
            : false;
        $nivel = is_array($m) && isset($m['nivel']) ? (string) $m['nivel'] : '';
        if ($materiaId === false || $materiaId === null || !in_array($nivel, $nivelesValidos, true)) {
            error_json('Hay una materia con datos inválidos', 400);
        }
        if (isset($coberturaPorMateria[(int) $materiaId])) {
            $niveles[(int) $materiaId] = $nivel;
        }
    }
}

// En qué días existe cada franja: null = todos (2026-10-02: 14:00-14:30 solo
// martes y jueves). Una celda de un día en que su franja no existe se descarta
// en silencio, igual que las materias que no están en el formulario; una
// franja que no existe en el catálogo es un error.
$diasDeFranja = [];
foreach ($pdo->query('SELECT id, dias FROM franja_horaria') as $f) {
    $diasDeFranja[(int) $f['id']] = ($f['dias'] === null || $f['dias'] === '') ? null : explode(',', $f['dias']);
}

$celdas     = [];
$horasVerde = 0.0;
if (isset($body['disponibilidad']) && is_array($body['disponibilidad'])) {
    foreach ($body['disponibilidad'] as $d) {
        if (!is_array($d)) {
            error_json('Hay una celda de disponibilidad con datos inválidos', 400);
        }
        $dia      = isset($d['dia']) ? (string) $d['dia'] : '';
        $franjaId = filter_var(isset($d['franja_id']) ? $d['franja_id'] : null, FILTER_VALIDATE_INT);
        $nivel    = isset($d['nivel']) ? (string) $d['nivel'] : '';
        if (!in_array($dia, $dias, true) || $franjaId === false || $franjaId === null
            || !in_array($nivel, $nivelesValidos, true)
            || !array_key_exists((int) $franjaId, $diasDeFranja)) {
            error_json('Hay una celda de disponibilidad con datos inválidos', 400);
        }
        $permitidos = $diasDeFranja[(int) $franjaId];
        if ($permitidos !== null && !in_array($dia, $permitidos, true)) {
            continue;
        }
        $celdas[$dia . '-' . $franjaId] = [$dia, (int) $franjaId, $nivel];
    }
    foreach ($celdas as $c) {
        if ($c[2] === 'verde') {
            $horasVerde += 0.5;
        }
    }
}

$respuestas = [];
if (isset($body['respuestas']) && is_array($body['respuestas'])) {
    foreach ($body['respuestas'] as $r) {
        $seccionId = is_array($r)
            ? filter_var(isset($r['seccion_id']) ? $r['seccion_id'] : null, FILTER_VALIDATE_INT)
            : false;
        if ($seccionId === false || $seccionId === null || !isset($abiertas[(int) $seccionId])) {
            continue;
        }
        $texto = trim(isset($r['texto']) ? (string) $r['texto'] : '');
        if ($texto === '') {
            continue;
        }
        if (mb_strlen($texto) > LARGO_RESPUESTA) {
            error_json('Una de tus respuestas es demasiado larga (máximo ' . LARGO_RESPUESTA . ' caracteres)', 400);
        }
        $respuestas[(int) $seccionId] = $texto;
    }
}

if ($estado === 'enviado') {
    $faltantes = faltantes_para_enviar($cuestionario, $niveles, $respuestas, $horasVerde);
    if ($faltantes !== []) {
        error_json('Antes de enviar te falta: ' . implode('; ', $faltantes) . '.', 400, 'incompleta');
    }
}

// --- Guardar -----------------------------------------------------------------

$pdo->beginTransaction();
try {
    // FOR UPDATE: dos pestañas del mismo profesor guardando a la vez no deben
    // acabar en dos filas de preferencia para el mismo semestre.
    $st = $pdo->prepare(
        'SELECT id, estado FROM preferencia WHERE profesor_id = ? AND semestre_id = ? FOR UPDATE'
    );
    $st->execute([$yo, $semestreId]);
    $existente = $st->fetch();

    // propia_preferencia_update exigía estado = 'borrador': una vez enviada, el
    // profesor ya no edita por su cuenta. Reabrirla es tarea del Jefe
    // (reabrir.php). Se revisa aquí porque es LA regla de esta pantalla.
    if ($existente && $existente['estado'] === 'enviado') {
        $pdo->rollBack();
        error_json(
            'Tus preferencias ya fueron enviadas. Pide a tu Jefe de Departamento que reabra el formulario.',
            409,
            'ya_enviada'
        );
    }

    $enviadoAt = $estado === 'enviado' ? ahora_utc() : null;

    if ($existente) {
        $prefId = (int) $existente['id'];
        $pdo->prepare(
            'UPDATE preferencia SET num_cursos_max = ?, estado = ?, enviado_at = ?
              WHERE id = ? AND profesor_id = ?'
        )->execute([$numCursos, $estado, $enviadoAt, $prefId, $yo]);
    } else {
        // profesor_id de mi_id(), NUNCA del cuerpo (propia_preferencia_insert).
        $pdo->prepare(
            'INSERT INTO preferencia (profesor_id, semestre_id, num_cursos_max, estado, enviado_at)
             VALUES (?,?,?,?,?)'
        )->execute([$yo, $semestreId, $numCursos, $estado, $enviadoAt]);
        $prefId = (int) $pdo->lastInsertId();
    }

    // Borrar + reinsertar, pero DENTRO de la transacción: si el insert falla, el
    // delete se deshace.
    $pdo->prepare('DELETE FROM preferencia_materia WHERE preferencia_id = ?')->execute([$prefId]);
    $ins = $pdo->prepare(
        'INSERT INTO preferencia_materia (preferencia_id, materia_id, nivel, cobertura_departamental)
         VALUES (?,?,?,?)'
    );
    foreach ($niveles as $materiaId => $nivel) {
        // cobertura_departamental sale de la sección donde la jefatura puso la
        // materia, no de lo que diga el cliente.
        $ins->execute([$prefId, $materiaId, $nivel, $coberturaPorMateria[$materiaId]]);
    }

    $pdo->prepare('DELETE FROM disponibilidad WHERE preferencia_id = ?')->execute([$prefId]);
    $ins = $pdo->prepare(
        'INSERT INTO disponibilidad (preferencia_id, dia, franja_id, nivel) VALUES (?,?,?,?)'
    );
    foreach ($celdas as $c) {
        $ins->execute([$prefId, $c[0], $c[1], $c[2]]);
    }

    $pdo->prepare('DELETE FROM preferencia_respuesta WHERE preferencia_id = ?')->execute([$prefId]);
    $ins = $pdo->prepare(
        'INSERT INTO preferencia_respuesta (preferencia_id, seccion_id, texto) VALUES (?,?,?)'
    );
    foreach ($respuestas as $seccionId => $texto) {
        $ins->execute([$prefId, $seccionId, $texto]);
    }

    $pdo->commit();
    responder(['id' => $prefId, 'estado' => $estado]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fallo_interno('preferencia.php', $e, 'No se pudo guardar');
}
