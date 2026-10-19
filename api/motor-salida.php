<?php
// =============================================================================
// Subida del resultado del motor (autoplanear-salida/2).
//
//   POST ?accion=validar   cuerpo = la salida tal cual
//          -> { errores, avisos, avisos_motor, sin_asignar, resumen, desfase, motor }
//             No escribe nada.
//   POST ?accion=aplicar   cuerpo = { salida, confirmar_desfase }
//          -> { corrida, resumen }
//             422 salida_invalida si hay errores, 409 desfasada si algo cambió
//             desde la descarga y no se confirmó, 409 rechazado_por_la_base si
//             un trigger lo detuvo.
//   GET    ?semestre_id=N
//          -> { corridas, grupos }: las últimas corridas aplicadas y cuántos
//             grupos hay hoy en el semestre, por estado.
//
// "aplicar" revalida TODO aunque el navegador ya haya llamado "validar": el
// archivo pudo cambiar entre las dos llamadas, y la base también.
//
// La validación es contra el paquete de entrada armado AHORA con el alcance de
// la salida (entrada.departamentos), no contra el que se descargó: lo que se
// escribe tiene que valer hoy. El desfase (§4.1) se detecta comparando la
// huella de ese paquete con la que se guardó al descargar (motor_descarga).
//
// Al aplicar (§5 "Qué se escribe" y "Al volver a subir"), en una transacción:
// se borran los grupos no publicados del alcance (y sus espejos de otros
// departamentos), se crean los de la salida sin publicar, y se guarda la
// corrida (sin_asignar, avisos, métricas) en motor_corrida para la vista de
// malla. Nunca se toca un grupo publicado.
//
// Autorización: solo admin por ahora (D43), igual que motor-entrada.php.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';
require_once __DIR__ . '/lib/motor.php';

exigir_metodo('GET', 'POST');
exigir_rol('admin');

$pdo = db();

// -----------------------------------------------------------------------------
// GET — las corridas aplicadas
// -----------------------------------------------------------------------------

if (metodo_http() === 'GET') {
    $semestreId = param_id('semestre_id');
    $st = $pdo->prepare(
        'SELECT c.id, c.departamentos, c.descarga_id, c.desfasada, c.motor, c.sin_asignar, c.avisos,
                c.grupos_creados, c.grupos_reemplazados, c.subido_at, p.nombre AS subido_por
           FROM motor_corrida c JOIN profesor p ON p.id = c.subido_por
          WHERE c.semestre_id = ?
          ORDER BY c.id DESC
          LIMIT 20'
    );
    $st->execute([$semestreId]);
    $corridas = [];
    foreach ($st->fetchAll() as $c) {
        $motor = json_decode((string) $c['motor'], true);
        $sinAsignar = json_decode((string) $c['sin_asignar'], true);
        $avisos = json_decode((string) $c['avisos'], true);
        $faltantes = 0;
        foreach (is_array($sinAsignar) ? $sinAsignar : [] as $x) {
            $faltantes += (int) ($x['grupos_faltantes'] ?? 0);
        }
        $avisosSistema = 0;
        foreach ($avisos['sistema'] ?? [] as $a) {
            $avisosSistema += (int) ($a['total'] ?? 0);
        }
        $corridas[] = [
            'id'                  => (int) $c['id'],
            'departamentos'       => array_map('intval', explode(',', $c['departamentos'])),
            'desfasada'           => (int) $c['desfasada'] === 1,
            'descarga_reconocida' => $c['descarga_id'] !== null,
            'motor'               => is_array($motor) ? $motor : null,
            'grupos_creados'      => (int) $c['grupos_creados'],
            'grupos_reemplazados' => (int) $c['grupos_reemplazados'],
            'grupos_sin_asignar'  => $faltantes,
            'avisos_motor'        => count($avisos['motor'] ?? []),
            'avisos_sistema'      => $avisosSistema,
            'subido_por'          => $c['subido_por'],
            'subido_at'           => motor_hora_local($c['subido_at']),
        ];
    }

    $st = $pdo->prepare(
        'SELECT m.departamento_id, g.estado, g.publicado, COUNT(*) AS n
           FROM grupo g JOIN materia m ON m.id = g.materia_id
          WHERE g.semestre_id = ?
          GROUP BY m.departamento_id, g.estado, g.publicado
          ORDER BY m.departamento_id, g.estado, g.publicado'
    );
    $st->execute([$semestreId]);
    $grupos = [];
    foreach ($st->fetchAll() as $g) {
        $grupos[] = [
            'departamento_id' => (int) $g['departamento_id'],
            'estado'          => $g['estado'],
            'publicado'       => (int) $g['publicado'] === 1,
            'n'               => (int) $g['n'],
        ];
    }
    responder(['corridas' => $corridas, 'grupos' => $grupos]);
}

// -----------------------------------------------------------------------------
// POST — validar o aplicar
// -----------------------------------------------------------------------------

$accion = filter_input(INPUT_GET, 'accion');
if (!in_array($accion, ['validar', 'aplicar'], true)) {
    error_json('accion debe ser validar o aplicar', 400);
}
$aplicar = $accion === 'aplicar';

$cuerpo = cuerpo_json();
$salida = $aplicar ? ($cuerpo['salida'] ?? null) : $cuerpo;
$confirmarDesfase = $aplicar && ($cuerpo['confirmar_desfase'] ?? false) === true;

/** Una salida que ni siquiera dice a qué descarga responde: se rechaza sin armar nada. */
function rechazar_sin_entrada(string $tipo, string $mensaje, bool $aplicar): void
{
    $cuerpo = [
        'errores'      => [['tipo' => $tipo, 'total' => 1, 'mensajes' => [$mensaje]]],
        'avisos'       => [],
        'avisos_motor' => [],
        'sin_asignar'  => [],
        'resumen'      => null,
        'desfase'      => null,
        'motor'        => null,
    ];
    if ($aplicar) {
        responder(['error' => $mensaje, 'codigo' => 'salida_invalida'] + $cuerpo, 422);
    }
    responder($cuerpo);
}

if (!is_array($salida) || motor_es_lista($salida)) {
    rechazar_sin_entrada('estructura', 'El archivo no es un objeto JSON.', $aplicar);
}
$info = $salida['entrada'] ?? null;
if (!is_array($info) || !isset($info['semestre_id'], $info['departamentos'], $info['generado_at'])
    || !is_int($info['semestre_id']) || !is_string($info['generado_at']) || !motor_es_lista($info['departamentos'])) {
    rechazar_sin_entrada(
        'estructura',
        'Falta el bloque "entrada" con semestre_id, departamentos y generado_at: sin él no se sabe a qué descarga responde (§4.1).',
        $aplicar
    );
}

// 1. El semestre de la salida tiene que ser el activo.
$activo = semestre_activo($pdo);
if ($activo === null) {
    error_json('No hay ningún semestre activo', 409);
}
if ($info['semestre_id'] !== (int) $activo['id']) {
    rechazar_sin_entrada(
        'semestre',
        "El resultado es del semestre {$info['semestre_id']} y el semestre activo es {$activo['etiqueta']} (id {$activo['id']}). Hay que volver a descargar y correr el motor.",
        $aplicar
    );
}
$semestreId = (int) $activo['id'];
$deptos = motor_departamentos($pdo, $info['departamentos']);
$alcanceTxt = implode(',', $deptos);

$st = $pdo->prepare(
    'SELECT id, con_salones, huella, descargado_at FROM motor_descarga
      WHERE semestre_id = ? AND generado_at = ? AND departamentos = ?'
);
$st->execute([$semestreId, $info['generado_at'], $alcanceTxt]);
$descarga = $st->fetch() ?: null;

// Sin la descarga no se sabe si fue con salones: se deduce de la salida.
if ($descarga !== null) {
    $conSalones = (int) $descarga['con_salones'] === 1;
} else {
    $conSalones = false;
    foreach (motor_es_lista($salida['grupos'] ?? null) ? $salida['grupos'] : [] as $g) {
        if (is_array($g) && ($g['salon_id'] ?? null) !== null) {
            $conSalones = true;
            break;
        }
    }
}

$yo = mi_perfil();
try {
    $rej = motor_rejilla($pdo);
    $entrada = motor_armar_entrada(
        $pdo, $rej, $activo, $deptos, $conSalones, $info['generado_at'],
        ['id' => (int) $yo['id'], 'nombre' => $yo['nombre']]
    );
    $huella = motor_huella($entrada);
    $v = motor_validar_salida($rej, $entrada, $salida);
    $clases = motor_clasificar(motor_clases($pdo, $semestreId), $deptos);
} catch (Throwable $e) {
    fallo_interno("motor-salida.php $accion", $e, 'No se pudo revisar el resultado');
}

$reemplaza = 0;
foreach ($clases['reemplazo'] as $c) {
    $reemplaza += count($c['grupos']);
}
$desfase = [
    'reconocida'    => $descarga !== null,
    'desfasada'     => $descarga === null || $descarga['huella'] !== $huella,
    'descargado_at' => $descarga === null ? null : motor_hora_local($descarga['descargado_at']),
    'con_salones'   => $conSalones,
];
$respuesta = [
    'errores'      => $v['errores'],
    'avisos'       => $v['avisos'],
    'avisos_motor' => $v['avisos_motor'],
    'sin_asignar'  => $v['sin_asignar'],
    'resumen'      => $v['resumen'] + ['reemplaza' => $reemplaza],
    'desfase'      => $desfase,
    'motor'        => is_array($salida['motor'] ?? null) ? $salida['motor'] : null,
];

if (!$aplicar) {
    responder($respuesta);
}

if ($v['errores'] !== []) {
    responder(['error' => 'El resultado tiene errores: no se aplicó nada.', 'codigo' => 'salida_invalida'] + $respuesta, 422);
}
if ($desfase['desfasada'] && !$confirmarDesfase) {
    error_json(
        $descarga === null
            ? 'No se reconoce la descarga de la que salió este resultado. Confirma para aplicarlo de todos modos.'
            : 'Algo cambió desde la descarga (demanda, preferencias, bloqueos, asignaciones o grupos). Confirma para aplicarlo de todos modos.',
        409,
        'desfasada'
    );
}

$pdo->beginTransaction();
try {
    list($creados, $reemplazados) = motor_aplicar($pdo, $rej, $entrada, $v['plan'], $clases['reemplazo']);
    $pdo->prepare(
        'INSERT INTO motor_corrida
                (semestre_id, departamentos, descarga_id, desfasada, motor, sin_asignar, avisos, metricas,
                 grupos_creados, grupos_reemplazados, subido_por, subido_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    )->execute([
        $semestreId,
        $alcanceTxt,
        $descarga === null ? null : (int) $descarga['id'],
        $desfase['desfasada'] ? 1 : 0,
        json_encode($respuesta['motor'], JSON_UNESCAPED_UNICODE),
        json_encode($v['sin_asignar'], JSON_UNESCAPED_UNICODE),
        json_encode(['motor' => $v['avisos_motor'], 'sistema' => $v['avisos']], JSON_UNESCAPED_UNICODE),
        json_encode($salida['metricas'] ?? null, JSON_UNESCAPED_UNICODE),
        $creados,
        $reemplazados,
        mi_id(),
        ahora_utc(),
    ]);
    $corridaId = (int) $pdo->lastInsertId();
    $pdo->commit();
} catch (PDOException $e) {
    // Va antes que RuntimeException, de la que hereda: su mensaje es de MySQL
    // y no debe llegar al navegador.
    $pdo->rollBack();
    fallo_interno('motor-salida.php aplicar', $e, 'No se pudo aplicar el resultado; no se escribió nada');
} catch (RuntimeException $e) {
    // Un trigger lo detuvo (SQLSTATE 45000, motor_aplicar lo convierte): el
    // mensaje es el MESSAGE_TEXT de nuestro SIGNAL, se puede mostrar.
    $pdo->rollBack();
    error_json('La base rechazó el resultado y no se aplicó nada. ' . $e->getMessage(), 409, 'rechazado_por_la_base');
} catch (Throwable $e) {
    $pdo->rollBack();
    fallo_interno('motor-salida.php aplicar', $e, 'No se pudo aplicar el resultado; no se escribió nada');
}

responder([
    'corrida' => [
        'id'                  => $corridaId,
        'grupos_creados'      => $creados,
        'grupos_reemplazados' => $reemplazados,
        'desfasada'           => $desfase['desfasada'],
    ],
    'resumen' => $respuesta['resumen'],
]);
