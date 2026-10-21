<?php
// =============================================================================
// La vista de malla (paso 13 de malla-horarios/docs/flujo-del-sistema.md).
//
//   GET ?semestre_id=N[&departamentos=1,2,3]
//     -> { entrada, grupos, corrida }
//
// entrada  el mismo paquete autoplanear-entrada/2 que arma la descarga del
//          motor (lib/motor.php) para ese alcance: rejilla, materias con sus
//          planes, profesores con su disponibilidad y su ocupado, salones,
//          grupos_fijos (los publicados) y asignaciones_fijas. Con eso la vista
//          revisa en vivo las reglas de §5, igual que optv1/validar.py.
// grupos   los grupos SIN PUBLICAR del alcance, en el formato de un grupo de
//          la salida (§4.2) y con su grupo_id: lo que dejó la última subida.
// corrida  la última corrida aplicada que toca el alcance (motor_corrida): el
//          motor, cuándo y quién la subió, sus métricas y lo sin asignar del
//          alcance con su motivo. null si todavía no hay ninguna.
//
// Las convenciones citadas (§3.7, §4.2...) son de
// malla-horarios/docs/convencion-datos-motor.md.
//
// Dos cosas que la base no guarda y aquí se resuelven:
//   - Qué grupo cumple qué asignación directa: motor_aplicar() no escribe
//     asignacion_fija_id. Se empareja cada asignación con un grupo que tenga
//     su materia y su profesor, prefiriendo el que está en el horario fijado.
//   - Los avisos del motor: señalan grupos por su `ref` de la salida, que no
//     sobrevive a la subida. No se mandan; la vista los recalcula.
//
// Autorización: jefatura (ROLES_GESTION). Quien ve_todos_los_departamentos()
// elige el alcance con ?departamentos=; los demás ven solo el suyo. Solo
// lectura: mover grupos y publicar llegan después.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';
require_once __DIR__ . '/lib/motor.php';

exigir_metodo('GET');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$semestreId = param_id('semestre_id');

if (ve_todos_los_departamentos()) {
    $deptos = motor_departamentos($pdo, (string) filter_input(INPUT_GET, 'departamentos'));
} else {
    $propio = mi_departamento();
    if ($propio === null) {
        error_json('Tu cuenta no tiene departamento', 403);
    }
    $deptos = [$propio];
}

$st = $pdo->prepare('SELECT id, tipo, anio FROM semestre WHERE id = ?');
$st->execute([$semestreId]);
$semestre = $st->fetch();
if (!$semestre) {
    error_json('No existe ese semestre', 404);
}

/** "lunes 07:00 3, miercoles 07:00 3": para comparar dos horarios sin importar el salón. */
function malla_firma_sesiones(array $sesiones): string
{
    $partes = [];
    foreach ($sesiones as $s) {
        $partes[] = "{$s['dia']} {$s['inicio']} {$s['bloques']}";
    }
    sort($partes);
    return implode(', ', $partes);
}

$yo = mi_perfil();
try {
    $rej = motor_rejilla($pdo);
    $entrada = motor_armar_entrada(
        $pdo, $rej, $semestre, $deptos, true, motor_ahora(),
        ['id' => (int) $yo['id'], 'nombre' => $yo['nombre']]
    );
    $clases = motor_clasificar(motor_clases($pdo, $semestreId), $deptos);

    // --- los grupos sin publicar, como los publicados de grupos_fijos (§3.7) ---
    $enPaquete = [];
    foreach ($entrada['profesores'] as $p) {
        $enPaquete[$p['id']] = true;
    }
    $grupos = [];
    foreach ($clases['reemplazo'] as $c) {
        $g = motor_grupo_de_clase($rej, $c);
        $g['ref'] = 'g-' . $g['grupo_id'];
        $g['profesores'] = array_values(array_filter($g['profesores'], function ($pid) use ($enPaquete) {
            return isset($enPaquete[$pid]);
        }));
        $g['grupo_ids'] = array_map(function ($x) {
            return $x['id'];
        }, $c['grupos']);
        $g['estado'] = $c['grupos'][0]['estado'];
        $grupos[] = $g;
    }

    // --- qué grupo cumple cada asignación directa ---
    // Primero los que están en el horario fijado; después cualquiera con la
    // materia y el profesor. Un grupo cumple a lo más una asignación.
    $lugares = [];
    foreach ($grupos as $k => $g) {
        $lugares[] = ['lista' => 'grupos', 'k' => $k, 'g' => $g];
    }
    foreach ($entrada['grupos_fijos'] as $k => $g) {
        $lugares[] = ['lista' => 'grupos_fijos', 'k' => $k, 'g' => $g];
    }
    $usado = [];
    foreach ([true, false] as $exigirHorario) {
        foreach ($entrada['asignaciones_fijas'] as $a) {
            if (isset($usado['a' . $a['id']])) {
                continue;
            }
            foreach ($lugares as $i => $l) {
                $g = $l['g'];
                if (isset($usado[$i])
                    || !in_array($a['profesor_id'], $g['profesores'], true)
                    || !in_array($a['materia_id'], array_column($g['materias'], 'materia_id'), true)) {
                    continue;
                }
                if ($exigirHorario && ($a['sesiones'] === []
                        || malla_firma_sesiones($a['sesiones']) !== malla_firma_sesiones($g['sesiones']))) {
                    continue;
                }
                $usado[$i] = true;
                $usado['a' . $a['id']] = true;
                if ($l['lista'] === 'grupos') {
                    $grupos[$l['k']]['asignacion_fija_id'] = $a['id'];
                } else {
                    $entrada['grupos_fijos'][$l['k']]['asignacion_fija_id'] = $a['id'];
                }
                break;
            }
        }
    }

    // --- la última corrida que toca el alcance ---
    $st = $pdo->prepare(
        'SELECT c.departamentos, c.desfasada, c.motor, c.sin_asignar, c.metricas,
                c.grupos_creados, c.subido_at, p.nombre AS subido_por
           FROM motor_corrida c JOIN profesor p ON p.id = c.subido_por
          WHERE c.semestre_id = ?
          ORDER BY c.id DESC
          LIMIT 20'
    );
    $st->execute([$semestreId]);
    $deptoDe = [];
    foreach ($entrada['materias'] as $m) {
        $deptoDe[$m['id']] = $m['departamento_id'];
    }
    $corrida = null;
    foreach ($st->fetchAll() as $c) {
        $suyos = array_map('intval', explode(',', $c['departamentos']));
        if (array_intersect($suyos, $deptos) === []) {
            continue;
        }
        // Lo sin asignar de otros departamentos no es de quien mira.
        $sinAsignar = [];
        $todo = json_decode((string) $c['sin_asignar'], true);
        foreach (is_array($todo) ? $todo : [] as $x) {
            if (in_array($deptoDe[$x['materia_id'] ?? 0] ?? 0, $deptos, true)) {
                $sinAsignar[] = $x;
            }
        }
        $motor = json_decode((string) $c['motor'], true);
        $metricas = json_decode((string) $c['metricas'], true);
        $corrida = [
            'departamentos'  => $suyos,
            'desfasada'      => (int) $c['desfasada'] === 1,
            'motor'          => is_array($motor) ? $motor : null,
            'sin_asignar'    => $sinAsignar,
            'metricas'       => is_array($metricas) ? $metricas : null,
            'grupos_creados' => (int) $c['grupos_creados'],
            'subido_por'     => $c['subido_por'],
            'subido_at'      => motor_hora_local($c['subido_at']),
        ];
        break;
    }
} catch (Throwable $e) {
    fallo_interno('malla.php', $e, 'No se pudo armar la malla');
}

responder([
    'entrada' => motor_entrada_json($entrada),
    'grupos'  => $grupos,
    'corrida' => $corrida,
]);
