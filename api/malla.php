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
//   POST ?semestre_id=N[&departamentos=1,2,3]
//     { grupo_id, profesor_id }  -> { grupo_id, profesores }
//
// Cambia el profesor de una clase sin publicar (2026-10-23): grupo_id es el
// de la clave principal y el cambio va a todas sus claves espejo, como las
// guarda motor_aplicar(). profesor_id null la deja sin profesor, que en la
// base es el "Profesor por asignar" de su departamento. Reemplaza a los
// co-titulares que tuviera. El estado del grupo se recalcula igual que en la
// subida: 'asignado' si tiene profesor, horario y salón en todos sus bloques.
// Se rechaza (409) solo lo que la base o la jefatura ya prohíben:
//   - un traslape del profesor con otra de sus clases del semestre (el chequeo
//     1 de sp_validar_imparte_horario, que solo corre al escribir horario);
//   - un par profesor-materia bloqueado por la jefatura.
// Lo demás (rojo, tope, cursos de más, romper una asignación directa) se
// guarda: la vista lo muestra antes y la jefatura decide.
//
// Autorización: solo admin por ahora; los jefes todavía no ven la malla
// (2026-10-21). Abrirla a jefatura es cambiar exigir_rol a ROLES_GESTION: quien
// ve_todos_los_departamentos() elige el alcance con ?departamentos=, los demás
// ven solo el suyo. Mover grupos de horario o salón y publicar llegan después.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';
require_once __DIR__ . '/lib/motor.php';

exigir_metodo('GET', 'POST');
exigir_rol('admin');

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

if (metodo_http() === 'POST') {
    exigir_semestre_activo($pdo, $semestreId);
    $body = cuerpo_json();
    $grupoId = filter_var($body['grupo_id'] ?? null, FILTER_VALIDATE_INT);
    if ($grupoId === false || $grupoId < 1) {
        error_json('Falta grupo_id', 400);
    }
    $profesorId = null;
    if (($body['profesor_id'] ?? null) !== null) {
        $profesorId = filter_var($body['profesor_id'], FILTER_VALIDATE_INT);
        if ($profesorId === false || $profesorId < 1) {
            error_json('profesor_id inválido', 400);
        }
    }

    // La clase completa (con sus espejos), y solo si la vista la deja editar.
    $clase = null;
    foreach (motor_clasificar(motor_clases($pdo, $semestreId), $deptos)['reemplazo'] as $c) {
        if (in_array($grupoId, array_column($c['grupos'], 'id'), true)) {
            $clase = $c;
            break;
        }
    }
    if ($clase === null) {
        error_json('Ese grupo no está en la malla sin publicar de este alcance', 404);
    }
    $impartes = array_values(array_filter(array_column($clase['grupos'], 'imparte_id')));
    if (count($impartes) !== count($clase['grupos'])) {
        error_json('Ese grupo todavía no tiene asignación: vuelve a subir la salida del motor', 409);
    }
    $mids = array_column($clase['grupos'], 'materia_id');

    if ($profesorId === null) {
        $deptoPrincipal = $clase['grupos'][0]['departamento_id'];
        $guardar = profesores_por_asignar()[$deptoPrincipal] ?? null;
        if ($guardar === null) {
            error_json('Su departamento no tiene "Profesor por asignar" (falta migracion-2026-10-23-profesor-por-asignar.sql)', 409);
        }
    } else {
        $st = $pdo->prepare(
            'SELECT nombre FROM profesor
              WHERE id = ? AND activo = 1 AND tipo_contrato IS NOT NULL AND por_asignar = 0
                AND departamento_id IN (' . motor_marcas($deptos) . ')'
        );
        $st->execute(array_merge([$profesorId], $deptos));
        $nombre = $st->fetchColumn();
        if ($nombre === false) {
            error_json('Ese profesor no está activo en este alcance', 404);
        }
        $guardar = $profesorId;

        $st = $pdo->prepare(
            'SELECT m.clave FROM bloqueo_profesor_materia b JOIN materia m ON m.id = b.materia_id
              WHERE b.profesor_id = ? AND b.semestre_id = ? AND b.materia_id IN (' . motor_marcas($mids) . ')'
        );
        $st->execute(array_merge([$profesorId, $semestreId], $mids));
        $bloqueada = $st->fetchColumn();
        if ($bloqueada !== false) {
            error_json("La jefatura bloqueó a $nombre para $bloqueada: hay que quitar el bloqueo en Respuestas y bloqueos", 409, 'bloqueo');
        }

        // El chequeo 1 del trigger: otra clase suya del semestre en un bloque
        // de esta. Las claves espejo de esta clase no cuentan.
        $m = motor_marcas($impartes);
        $st = $pdo->prepare(
            "SELECT m2.clave, g2.numero, ih.dia, f.hora_inicio
               FROM imparte_horario esta
               JOIN imparte_horario ih ON ih.dia = esta.dia AND ih.franja_id = esta.franja_id
               JOIN imparte_profesor ip ON ip.imparte_id = ih.imparte_id AND ip.profesor_id = ?
               JOIN imparte i2  ON i2.id = ih.imparte_id
               JOIN grupo g2    ON g2.id = i2.grupo_id AND g2.semestre_id = ? AND g2.estado <> 'cancelado'
               JOIN materia m2  ON m2.id = g2.materia_id
               JOIN franja_horaria f ON f.id = ih.franja_id
              WHERE esta.imparte_id IN ($m) AND ih.imparte_id NOT IN ($m)
              ORDER BY f.hora_inicio
              LIMIT 1"
        );
        $st->execute(array_merge([$profesorId, $semestreId], $impartes, $impartes));
        $choque = $st->fetch();
        if ($choque) {
            error_json(
                "$nombre ya da {$choque['clave']} · {$choque['numero']} el " . str_replace('miercoles', 'miércoles', $choque['dia']) . ' a las '
                    . substr((string) $choque['hora_inicio'], 0, 5) . ': un profesor no puede estar en dos grupos a la vez',
                409,
                'traslape'
            );
        }
    }

    $completo = $profesorId !== null && $clase['bloques'] !== [];
    foreach ($clase['bloques'] as $b) {
        $completo = $completo && $b['salon_id'] !== null;
    }
    $pdo->beginTransaction();
    try {
        $m = motor_marcas($impartes);
        $pdo->prepare("DELETE FROM imparte_profesor WHERE imparte_id IN ($m)")->execute($impartes);
        $ins = $pdo->prepare('INSERT INTO imparte_profesor (imparte_id, profesor_id) VALUES (?, ?)');
        foreach ($impartes as $iid) {
            $ins->execute([$iid, $guardar]);
        }
        $gids = array_column($clase['grupos'], 'id');
        $pdo->prepare('UPDATE grupo SET estado = ? WHERE estado <> \'cancelado\' AND id IN (' . motor_marcas($gids) . ')')
            ->execute(array_merge([$completo ? 'asignado' : 'en_asignacion'], $gids));
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fallo_interno('malla.php POST', $e, 'No se pudo cambiar el profesor');
    }
    responder([
        'grupo_id'   => $clase['grupos'][0]['id'],
        'profesores' => $profesorId === null ? [] : [$profesorId],
    ]);
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
    // materia y el profesor. Un grupo cumple a lo más una asignación. Una con
    // "Profesor por asignar" (profesor_id null) busca primero un grupo sin
    // profesor y, al final, uno al que la jefatura ya le puso profesor.
    $lugares = [];
    foreach ($grupos as $k => $g) {
        $lugares[] = ['lista' => 'grupos', 'k' => $k, 'g' => $g];
    }
    foreach ($entrada['grupos_fijos'] as $k => $g) {
        $lugares[] = ['lista' => 'grupos_fijos', 'k' => $k, 'g' => $g];
    }
    $usado = [];
    foreach ([[true, true], [false, true], [true, false], [false, false]] as list($exigirHorario, $sinProfesor)) {
        foreach ($entrada['asignaciones_fijas'] as $a) {
            if (isset($usado['a' . $a['id']])) {
                continue;
            }
            foreach ($lugares as $i => $l) {
                $g = $l['g'];
                $conSuProfesor = $a['profesor_id'] === null
                    ? (!$sinProfesor || $g['profesores'] === [])
                    : in_array($a['profesor_id'], $g['profesores'], true);
                if (isset($usado[$i])
                    || !$conSuProfesor
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
