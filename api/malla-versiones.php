<?php
// =============================================================================
// Las versiones anteriores de la malla (2026-10-29, D60).
//
// Cada subida del motor borra los grupos sin publicar de la anterior. Para que
// la jefatura pueda volver a ver una malla que le gustó más, la subida guarda
// por departamento los grupos que dejó (malla_version, motor_guardar_versiones
// en lib/motor.php). La malla de una versión se pinta con
// api/malla.php?corrida_id=C, en solo lectura. Aquí van la lista, la marca de
// "la que prefiero" y la descarga para el motor. No se restaura directo: el
// admin la usa como referencia para la siguiente corrida y el motor la respeta
// con los datos de hoy.
//
//   GET  ?semestre_id=N[&departamentos=1,2,3]
//        -> { versiones: [{ corrida_id, subido_at, subido_por,
//                           departamentos: [{ departamento_id, n_grupos, huella,
//                                             preferida: {por, at, nota} | null }] }] }
//        De la más nueva a la más vieja. Dos subidas con la misma huella en un
//        departamento dejaron la misma malla ahí.
//
//   GET  ?semestre_id=N[&departamentos=1,2,3]&referencia=C   (solo admin)
//        -> una salida autoplanear-salida/2 con los grupos que dejó la subida C
//           en el alcance: lo que lee --referencia de optV1 (grupos[].materias,
//           profesores y sesiones).
//
//   POST ?semestre_id=N[&departamentos=1,2,3]
//        { accion: 'preferir', corrida_id, nota }    -> { preferida: [...] }
//        { accion: 'quitar_preferida', corrida_id }  -> { preferida: [] }
//        Marca (o desmarca) la versión de esa subida en cada departamento del
//        alcance que tenga una. Una sola preferida por semestre y departamento:
//        marcar otra quita la anterior.
//
// Autorización (la de api/malla.php): ROLES_GESTION. Quien
// ve_malla_de_toda_la_division() elige el alcance con ?departamentos=;
// jefe_departamento, solo el suyo. La referencia es del admin, como "Datos
// para el motor".
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';
require_once __DIR__ . '/lib/motor.php';

exigir_metodo('GET', 'POST');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$semestreId = param_id('semestre_id');

if (ve_malla_de_toda_la_division()) {
    $deptos = motor_departamentos($pdo, (string) filter_input(INPUT_GET, 'departamentos'));
} else {
    $propio = mi_departamento();
    if ($propio === null) {
        error_json('Tu cuenta no tiene departamento', 403);
    }
    $deptos = [$propio];
}
$enDeptos = motor_marcas($deptos);

// -----------------------------------------------------------------------------
// POST — preferir / quitar la preferida
// -----------------------------------------------------------------------------

if (metodo_http() === 'POST') {
    exigir_semestre_activo($pdo, $semestreId);
    $body = cuerpo_json();
    $accion = $body['accion'] ?? null;
    if (!in_array($accion, ['preferir', 'quitar_preferida'], true)) {
        error_json('accion debe ser preferir o quitar_preferida', 400);
    }
    $corridaId = filter_var($body['corrida_id'] ?? null, FILTER_VALIDATE_INT);
    if ($corridaId === false || $corridaId < 1) {
        error_json('Falta corrida_id', 400);
    }
    $st = $pdo->prepare(
        "SELECT id, departamento_id FROM malla_version
          WHERE semestre_id = ? AND corrida_id = ? AND departamento_id IN ($enDeptos)"
    );
    $st->execute(array_merge([$semestreId, $corridaId], $deptos));
    $filas = $st->fetchAll();
    if ($filas === []) {
        error_json('Esa versión de la malla no existe en este alcance', 404);
    }
    $nota = texto_opcional($body, 'nota');
    if ($nota !== null) {
        $nota = function_exists('mb_substr') ? mb_substr($nota, 0, 300) : substr($nota, 0, 300);
    }
    $ahora = ahora_utc();

    $pdo->beginTransaction();
    try {
        $quitar = $pdo->prepare(
            'UPDATE malla_version SET preferida_por = NULL, preferida_at = NULL, nota = NULL
              WHERE semestre_id = ? AND departamento_id = ?'
        );
        $marcar = $pdo->prepare('UPDATE malla_version SET preferida_por = ?, preferida_at = ?, nota = ? WHERE id = ?');
        $desmarcar = $pdo->prepare('UPDATE malla_version SET preferida_por = NULL, preferida_at = NULL, nota = NULL WHERE id = ?');
        foreach ($filas as $f) {
            if ($accion === 'preferir') {
                $quitar->execute([$semestreId, (int) $f['departamento_id']]);
                $marcar->execute([mi_id(), $ahora, $nota, (int) $f['id']]);
            } else {
                $desmarcar->execute([(int) $f['id']]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fallo_interno('malla-versiones.php POST', $e, 'No se pudo guardar la versión preferida');
    }

    $preferida = [];
    if ($accion === 'preferir') {
        foreach ($filas as $f) {
            $preferida[] = [
                'departamento_id' => (int) $f['departamento_id'],
                'por'             => mi_perfil()['nombre'],
                'at'              => motor_hora_local($ahora),
                'nota'            => $nota,
            ];
        }
    }
    responder(['preferida' => $preferida]);
}

// -----------------------------------------------------------------------------
// GET ?referencia=C — la versión como salida, para --referencia de optV1
// -----------------------------------------------------------------------------

if (filter_input(INPUT_GET, 'referencia') !== null) {
    if (mi_rol() !== 'admin') {
        error_json('Solo el admin descarga una versión para el motor', 403);
    }
    $corridaId = param_id('referencia');
    $st = $pdo->prepare(
        "SELECT v.grupos, c.subido_at FROM malla_version v JOIN motor_corrida c ON c.id = v.corrida_id
          WHERE v.semestre_id = ? AND v.corrida_id = ? AND v.departamento_id IN ($enDeptos)
          ORDER BY v.departamento_id"
    );
    $st->execute(array_merge([$semestreId, $corridaId], $deptos));
    $filas = $st->fetchAll();
    if ($filas === []) {
        error_json('Esa versión de la malla no existe en este alcance', 404);
    }
    // Una clase espejo entre dos departamentos viene en los dos: va una vez.
    $grupos = [];
    foreach ($filas as $f) {
        foreach (json_decode((string) $f['grupos'], true) ?: [] as $g) {
            $grupos[$g['grupo_id']] = $g;
        }
    }
    responder([
        'convencion' => MOTOR_SALIDA,
        'version'    => [
            'semestre_id'   => $semestreId,
            'departamentos' => $deptos,
            'corrida_id'    => $corridaId,
            'subido_at'     => motor_hora_local($filas[0]['subido_at']),
        ],
        'grupos'     => array_values($grupos),
    ]);
}

// -----------------------------------------------------------------------------
// GET — la lista
// -----------------------------------------------------------------------------

$st = $pdo->prepare(
    "SELECT v.corrida_id, v.departamento_id, v.n_grupos, v.huella, v.preferida_at, v.nota,
            pp.nombre AS preferida_por, c.subido_at, p.nombre AS subido_por
       FROM malla_version v
       JOIN motor_corrida c ON c.id = v.corrida_id
       JOIN profesor p      ON p.id = c.subido_por
       LEFT JOIN profesor pp ON pp.id = v.preferida_por
      WHERE v.semestre_id = ? AND v.departamento_id IN ($enDeptos)
      ORDER BY v.corrida_id DESC, v.departamento_id"
);
$st->execute(array_merge([$semestreId], $deptos));
$versiones = [];
foreach ($st->fetchAll() as $v) {
    $cid = (int) $v['corrida_id'];
    if (!isset($versiones[$cid])) {
        $versiones[$cid] = [
            'corrida_id'    => $cid,
            'subido_at'     => motor_hora_local($v['subido_at']),
            'subido_por'    => $v['subido_por'],
            'departamentos' => [],
        ];
    }
    $versiones[$cid]['departamentos'][] = [
        'departamento_id' => (int) $v['departamento_id'],
        'n_grupos'        => (int) $v['n_grupos'],
        'huella'          => $v['huella'],
        'preferida'       => $v['preferida_at'] === null ? null : [
            'por'  => $v['preferida_por'],
            'at'   => motor_hora_local($v['preferida_at']),
            'nota' => $v['nota'],
        ],
    ];
}
responder(['versiones' => array_values($versiones)]);
