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
//          la salida (§4.2) y con su grupo_id: lo que dejó la última subida
//          más lo que la jefatura conservó, con `conservado` ({por, at} o
//          null). Los conservados no van en entrada.grupos_fijos: se siguen
//          editando aquí (motor_armar_entrada con $conservadosComoFijos false).
// corrida  la última corrida aplicada que toca el alcance (motor_corrida): el
//          motor, cuándo y quién la subió, sus métricas y lo sin asignar del
//          alcance con su motivo. null si todavía no hay ninguna.
//
//   GET ?semestre_id=N[&departamentos=1,2,3]&corrida_id=C
//     -> { entrada, grupos, corrida, descartados, version }
//
// Una versión anterior (2026-10-29, D60): los grupos que dejó la subida C en
// el alcance (malla_version), con la entrada de HOY, así que los avisos se
// revisan contra los datos de hoy. corrida es la C. version trae cuándo y
// quién la subió y qué departamentos la marcaron como preferida. La vista la
// pinta en solo lectura; la lista de versiones es de api/malla-versiones.php.
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
//     { grupo_id, profesor_id }  -> { grupo_id, profesores, conservado }
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
//   POST ?semestre_id=N[&departamentos=1,2,3]
//     { grupo_id, sesiones: [{dia, inicio, bloques, salon_id?}], salon_id }
//       -> { grupo_id, salon_id, sesiones, conservado }
//
// Mueve una clase sin publicar de horario y/o salón (2026-10-27, el arrastre de
// la malla). Ver malla_mover().
//
//   POST { accion: 'descartar', llave, departamento_id, descripcion }
//        { accion: 'restaurar', llave }
//
// Descarta o restaura un aviso (2026-10-27, malla_aviso_descartado). El GET
// trae los descartados del alcance en `descartados`. Ver malla_descartar().
//
//   POST { accion: 'soltar', grupo_id }  -> { grupo_id, conservado: null }
//
// Conservar (2026-10-27, grupo.conservado_at): cambiar el profesor, mover o
// descartar un aviso conserva la clase (todas sus claves espejo). Para el motor
// es un grupo fijo y la siguiente subida no la borra. 'soltar' quita la marca:
// la siguiente subida la rehace. Las respuestas de editar y descartar traen
// `conservado` para que la vista lo muestre sin recargar.
//
// Autorización (2026-10-27): ver y editar la malla es de ROLES_GESTION — la
// jefatura hace la edición final. Quien ve_malla_de_toda_la_division() (admin
// y jefe_division, sin la acotación temporal de DIVISION_SOLO_SU_DEPARTAMENTO)
// elige el alcance con ?departamentos=; jefe_departamento ve y edita solo el
// suyo (los POST buscan la clase dentro del alcance). Publicar llega después.
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

$st = $pdo->prepare('SELECT id, tipo, anio FROM semestre WHERE id = ?');
$st->execute([$semestreId]);
$semestre = $st->fetch();
if (!$semestre) {
    error_json('No existe ese semestre', 404);
}

if (metodo_http() === 'POST') {
    exigir_semestre_activo($pdo, $semestreId);
    $body = cuerpo_json();
    if (in_array($body['accion'] ?? null, ['descartar', 'restaurar'], true)) {
        malla_descartar($pdo, $semestreId, $deptos, $body);
    }
    $grupoId = filter_var($body['grupo_id'] ?? null, FILTER_VALIDATE_INT);
    if ($grupoId === false || $grupoId < 1) {
        error_json('Falta grupo_id', 400);
    }

    // La clase completa (con sus espejos), y solo si la vista la deja editar.
    $clase = malla_clase_editable($pdo, $semestreId, $deptos, $grupoId);
    if ($clase === null) {
        error_json('Ese grupo no está en la malla sin publicar de este alcance', 404);
    }
    if (($body['accion'] ?? null) === 'soltar') {
        malla_soltar($pdo, $clase);
    }
    $impartes = array_values(array_filter(array_column($clase['grupos'], 'imparte_id')));
    if (count($impartes) !== count($clase['grupos'])) {
        error_json('Ese grupo todavía no tiene asignación: vuelve a subir la salida del motor', 409);
    }
    $mids = array_column($clase['grupos'], 'materia_id');

    if (array_key_exists('sesiones', $body)) {
        malla_mover($pdo, $semestreId, $clase, $impartes, $body);
    }

    $profesorId = null;
    if (($body['profesor_id'] ?? null) !== null) {
        $profesorId = filter_var($body['profesor_id'], FILTER_VALIDATE_INT);
        if ($profesorId === false || $profesorId < 1) {
            error_json('profesor_id inválido', 400);
        }
    }

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
        $conservado = malla_conservar($pdo, $clase);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fallo_interno('malla.php POST', $e, 'No se pudo cambiar el profesor');
    }
    responder([
        'grupo_id'   => $clase['grupos'][0]['id'],
        'profesores' => $profesorId === null ? [] : [$profesorId],
        'conservado' => $conservado,
    ]);
}

/** La clase sin publicar del alcance (conservada o no) que tiene ese grupo, o null. */
function malla_clase_editable(PDO $pdo, int $semestreId, array $deptos, int $grupoId): ?array
{
    $clases = motor_clasificar(motor_clases($pdo, $semestreId), $deptos);
    foreach (array_merge($clases['reemplazo'], $clases['conservados']) as $c) {
        if (in_array($grupoId, array_column($c['grupos'], 'id'), true)) {
            return $c;
        }
    }
    return null;
}

/**
 * Conserva una clase con todas sus claves espejo (2026-10-27): la siguiente
 * subida del motor ya no la borra. Si ya estaba conservada se queda el primero
 * que lo hizo. Corre dentro de la transacción de quien llama.
 *
 * @return array {por, at}, para la respuesta
 */
function malla_conservar(PDO $pdo, array $clase): array
{
    $antes = motor_conservado_de($clase);
    if ($antes !== null) {
        return $antes;
    }
    $gids = array_column($clase['grupos'], 'id');
    $ahora = ahora_utc();
    $pdo->prepare(
        'UPDATE grupo SET conservado_por = ?, conservado_at = ?
          WHERE conservado_at IS NULL AND id IN (' . motor_marcas($gids) . ')'
    )->execute(array_merge([mi_id(), $ahora], $gids));
    return ['por' => mi_perfil()['nombre'], 'at' => motor_hora_local($ahora)];
}

/** Quita la marca de conservado: la siguiente subida del motor rehace la clase. */
function malla_soltar(PDO $pdo, array $clase): void
{
    $gids = array_column($clase['grupos'], 'id');
    try {
        $pdo->prepare('UPDATE grupo SET conservado_por = NULL, conservado_at = NULL WHERE id IN (' . motor_marcas($gids) . ')')
            ->execute($gids);
    } catch (Throwable $e) {
        fallo_interno('malla.php soltar', $e, 'No se pudo soltar el grupo');
    }
    responder(['grupo_id' => $clase['grupos'][0]['id'], 'conservado' => null]);
}

/**
 * Mueve una clase sin publicar a otro horario y/o salón (2026-10-27, el arrastre
 * de la malla). Body: { grupo_id, sesiones: [{dia, inicio, bloques, salon_id?}],
 * salon_id } — el salon_id de la sesión manda sobre el del grupo, como en §4.2.
 * Va a todas sus claves espejo. Se rechaza solo lo que la base ya prohíbe:
 *   - franjas fuera de la rejilla del departamento, o que cruzan la comida;
 *   - un número de bloques distinto al de la clase (mover no cambia su duración);
 *   - un salón que no existe o no está autorizado para el departamento en esa franja;
 *   - un traslape de profesor o de salón (los chequeos de sp_validar_imparte_horario).
 * Lo demás (rojo, cupo mayor que el salón, choques de semestre) se guarda: la
 * vista lo muestra antes y la jefatura decide.
 */
function malla_mover(PDO $pdo, int $semestreId, array $clase, array $impartes, array $body): void
{
    $rej = motor_rejilla($pdo);
    $sesiones = $body['sesiones'];
    if (!motor_es_lista($sesiones) || $sesiones === []) {
        error_json('sesiones debe ser una lista con al menos una sesión', 400);
    }
    $salonDe = function ($v) {
        if ($v === null) {
            return null;
        }
        $id = filter_var($v, FILTER_VALIDATE_INT);
        if ($id === false || $id < 1) {
            error_json('salon_id inválido', 400);
        }
        return $id;
    };
    $salonGrupo = $salonDe($body['salon_id'] ?? null);
    $depto = $clase['grupos'][0]['departamento_id'];

    $bloques = [];
    foreach ($sesiones as $s) {
        $bl = motor_bloques_de_sesion($rej, $s);
        if ($bl === null) {
            error_json('Una sesión sale de la rejilla o cruza la comida', 400);
        }
        $sid = is_array($s) && array_key_exists('salon_id', $s) ? $salonDe($s['salon_id']) : $salonGrupo;
        foreach ($bl as [$dia, $h]) {
            $f = $rej['por_inicio'][$h];
            if (!motor_franja_vale($f, $dia, $depto)) {
                error_json(str_replace('miercoles', 'miércoles', $dia) . " $h no es una franja de este departamento", 409, 'franja');
            }
            $llave = $dia . '|' . $f['id'];
            if (isset($bloques[$llave])) {
                error_json('Dos sesiones ocupan la misma franja', 400);
            }
            $bloques[$llave] = ['dia' => $dia, 'franja_id' => $f['id'], 'salon_id' => $sid, 'inicio' => $h];
        }
    }
    if (count($bloques) !== count($clase['bloques'])) {
        error_json('La clase dura ' . count($clase['bloques']) . ' bloques de media hora y el horario nuevo tiene '
            . count($bloques) . ': mover no cambia su duración', 400);
    }

    // Salones: que existan y estén autorizados para el departamento en cada bloque.
    $porSalon = [];
    foreach ($bloques as $b) {
        if ($b['salon_id'] !== null) {
            $porSalon[$b['salon_id']][] = $b;
        }
    }
    $stSalon = $pdo->prepare('SELECT nombre FROM salon WHERE id = ? AND activo = 1');
    $stDisp = $pdo->prepare(
        'SELECT dia, franja_id FROM salon_disponibilidad_departamento
          WHERE salon_id = ? AND departamento_id = ? AND semestre_id = ?'
    );
    foreach ($porSalon as $sid => $lista) {
        $stSalon->execute([$sid]);
        $nombre = $stSalon->fetchColumn();
        if ($nombre === false) {
            error_json("El salón $sid no existe o no está activo", 404);
        }
        $stDisp->execute([$sid, $depto, $semestreId]);
        $autorizado = [];
        foreach ($stDisp->fetchAll() as $d) {
            $autorizado[$d['dia'] . '|' . (int) $d['franja_id']] = true;
        }
        foreach ($lista as $b) {
            if (!isset($autorizado[$b['dia'] . '|' . $b['franja_id']])) {
                error_json("El salón $nombre no está autorizado para este departamento el "
                    . str_replace('miercoles', 'miércoles', $b['dia']) . " a las {$b['inicio']}", 409, 'salon');
            }
        }
    }

    // Los traslapes, con nombre: los mismos dos chequeos de sp_validar_imparte_horario,
    // pero diciendo qué clase estorba. Un jefe de departamento no ve las clases de los
    // otros y comparten salones; el trigger solo diría "Traslape de salón". Las claves
    // espejo de esta clase no cuentan (se reescriben aquí mismo).
    $m = motor_marcas($impartes);
    $donde = implode(' OR ', array_fill(0, count($bloques), '(ih.dia = ? AND ih.franja_id = ?)'));
    $enBloques = [];
    foreach ($bloques as $b) {
        $enBloques[] = $b['dia'];
        $enBloques[] = $b['franja_id'];
    }
    $otra = "SELECT m2.clave, g2.numero, d2.nombre AS departamento, ih.dia, f.hora_inicio
               FROM imparte_horario ih
               JOIN imparte i2      ON i2.id = ih.imparte_id
               JOIN grupo g2        ON g2.id = i2.grupo_id AND g2.semestre_id = ? AND g2.estado <> 'cancelado'
               JOIN materia m2      ON m2.id = g2.materia_id
               JOIN departamento d2 ON d2.id = m2.departamento_id
               JOIN franja_horaria f ON f.id = ih.franja_id
              %s
              WHERE ih.imparte_id NOT IN ($m) AND ($donde) %s
              ORDER BY f.hora_inicio LIMIT 1";
    $cuando = function (array $c): string {
        return str_replace('miercoles', 'miércoles', $c['dia']) . ' a las ' . substr((string) $c['hora_inicio'], 0, 5);
    };
    $stNombre = $pdo->prepare('SELECT nombre FROM profesor WHERE id = ?');
    foreach ($clase['profesores'] as $pid) {
        $st = $pdo->prepare(sprintf($otra, 'JOIN imparte_profesor ip ON ip.imparte_id = ih.imparte_id AND ip.profesor_id = ?', ''));
        $st->execute(array_merge([$semestreId, $pid], $impartes, $enBloques));
        $c = $st->fetch();
        if ($c) {
            $stNombre->execute([$pid]);
            error_json($stNombre->fetchColumn() . " ya da {$c['clave']} · {$c['numero']} ({$c['departamento']}) el " . $cuando($c)
                . ': un profesor no puede estar en dos grupos a la vez', 409, 'traslape');
        }
    }
    foreach ($porSalon as $sid => $lista) {
        $st = $pdo->prepare(sprintf($otra, '', 'AND ih.salon_id = ?'));
        $st->execute(array_merge([$semestreId], $impartes, $enBloques, [$sid]));
        $c = $st->fetch();
        if ($c) {
            $stSalon->execute([$sid]);
            error_json('El salón ' . $stSalon->fetchColumn() . " ya lo ocupa {$c['clave']} · {$c['numero']} ({$c['departamento']}) el "
                . $cuando($c), 409, 'traslape');
        }
    }

    $completo = $clase['profesores'] !== [];
    foreach ($bloques as $b) {
        $completo = $completo && $b['salon_id'] !== null;
    }
    $pdo->beginTransaction();
    try {
        $m = motor_marcas($impartes);
        $pdo->prepare("DELETE FROM imparte_horario WHERE imparte_id IN ($m)")->execute($impartes);
        // Todas las claves en cada bloque; el trigger no cuenta como traslape a las
        // claves espejo de la misma clase (imparte_co_oferta), igual que en motor_aplicar().
        $ins = $pdo->prepare('INSERT INTO imparte_horario (imparte_id, dia, franja_id, salon_id) VALUES (?, ?, ?, ?)');
        foreach ($impartes as $iid) {
            foreach ($bloques as $b) {
                $ins->execute([$iid, $b['dia'], $b['franja_id'], $b['salon_id']]);
            }
        }
        $gids = array_column($clase['grupos'], 'id');
        $pdo->prepare('UPDATE grupo SET estado = ? WHERE estado <> \'cancelado\' AND id IN (' . motor_marcas($gids) . ')')
            ->execute(array_merge([$completo ? 'asignado' : 'en_asignacion'], $gids));
        $conservado = malla_conservar($pdo, $clase);
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        if (($e->errorInfo[0] ?? '') === '45000') {
            // El MESSAGE_TEXT de nuestro SIGNAL: traslape de profesor o de salón.
            error_json(($e->errorInfo[2] ?? 'La base lo rechazó') . '. No se movió nada.', 409, 'traslape');
        }
        fallo_interno('malla.php mover', $e, 'No se pudo mover la clase');
    } catch (Throwable $e) {
        $pdo->rollBack();
        fallo_interno('malla.php mover', $e, 'No se pudo mover la clase');
    }

    [$salon, $ses] = motor_sesiones_con_salon($rej, array_map(function ($b) {
        return ['dia' => $b['dia'], 'franja_id' => $b['franja_id'], 'salon_id' => $b['salon_id']];
    }, array_values($bloques)));
    responder(['grupo_id' => $clase['grupos'][0]['id'], 'salon_id' => $salon, 'sesiones' => $ses, 'conservado' => $conservado]);
}

/**
 * Descarta o restaura un aviso de la malla (2026-10-27).
 * Body: { accion: 'descartar', llave, departamento_id, descripcion }
 *         -> { llave, descartado_por, descartado_at, conservados: [{grupo_id, conservado}] }
 *       { accion: 'restaurar', llave } -> { llave }
 * La llave la arma la vista (mallaVista.js, llaveAviso) y solo se guarda: el
 * servidor no recalcula avisos. departamento_id es el del grupo del aviso y
 * tiene que estar en el alcance de quien llama; restaurar, igual.
 *
 * Descartar es "ya lo vi y así se queda": conserva las clases del aviso o del
 * pendiente "por asignar" (2026-10-27), para que la siguiente subida del motor
 * no las rehaga y el descarte siga valiendo. Son los g-<grupo_id> de la llave
 * que sean de una clase editable del alcance. Restaurar no quita la marca.
 */
function malla_descartar(PDO $pdo, int $semestreId, array $deptos, array $body): void
{
    $llave = $body['llave'] ?? null;
    if (!is_string($llave) || $llave === '' || strlen($llave) > 20000) {
        error_json('Falta la llave del aviso', 400);
    }
    $sha = sha1($llave);

    if ($body['accion'] === 'restaurar') {
        $st = $pdo->prepare(
            'DELETE FROM malla_aviso_descartado
              WHERE semestre_id = ? AND llave_sha1 = ? AND departamento_id IN (' . motor_marcas($deptos) . ')'
        );
        $st->execute(array_merge([$semestreId, $sha], $deptos));
        responder(['llave' => $llave]);
    }

    $depto = filter_var($body['departamento_id'] ?? null, FILTER_VALIDATE_INT);
    if ($depto === false || !in_array($depto, $deptos, true)) {
        error_json('Ese aviso no es de tu departamento', 403);
    }
    $desc = trim((string) ($body['descripcion'] ?? ''));
    $desc = function_exists('mb_substr') ? mb_substr($desc, 0, 500) : substr($desc, 0, 500);
    $ahora = ahora_utc();
    // Los grupos del aviso: el segundo elemento de la llave, como g-<grupo_id>
    // (los fijo-<grupo_id> son publicados y ya no se mueven). En un aviso es una
    // lista; en un pendiente "por asignar", un solo grupo; en uno "falta" son
    // materias y no hay grupo que conservar.
    $partes = json_decode($llave, true);
    $refs = is_array($partes) ? ($partes[1] ?? null) : null;
    $delAviso = [];
    foreach (is_array($refs) ? $refs : [$refs] as $ref) {
        if (is_string($ref) && preg_match('/^g-(\d+)$/', $ref, $m)) {
            $delAviso[] = (int) $m[1];
        }
    }
    $clases = [];
    if ($delAviso !== []) {
        $c = motor_clasificar(motor_clases($pdo, $semestreId), $deptos);
        foreach (array_merge($c['reemplazo'], $c['conservados']) as $clase) {
            if (array_intersect($delAviso, array_column($clase['grupos'], 'id')) !== []) {
                $clases[] = $clase;
            }
        }
    }

    $pdo->beginTransaction();
    try {
        // INSERT IGNORE: si otra persona ya lo descartó, se queda el primero.
        $pdo->prepare(
            'INSERT IGNORE INTO malla_aviso_descartado
                    (semestre_id, departamento_id, llave, llave_sha1, descripcion, descartado_por, descartado_at)
             VALUES (?,?,?,?,?,?,?)'
        )->execute([$semestreId, $depto, $llave, $sha, $desc, mi_id(), $ahora]);
        $conservados = [];
        foreach ($clases as $clase) {
            $conservados[] = ['grupo_id' => $clase['grupos'][0]['id'], 'conservado' => malla_conservar($pdo, $clase)];
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fallo_interno('malla.php descartar', $e, 'No se pudo descartar el aviso');
    }
    $yo = mi_perfil();
    responder([
        'llave'          => $llave,
        'descartado_por' => $yo['nombre'],
        'descartado_at'  => motor_hora_local($ahora),
        'conservados'    => $conservados,
    ]);
}

/**
 * Los grupos que dejó una subida en los departamentos del alcance (malla_version,
 * D60), y lo que la vista dice de esa versión. Una clase espejo entre dos
 * departamentos viene en los dos: se cuenta una vez. 404 si la subida no dejó
 * nada en el alcance.
 *
 * @return array [grupos, {corrida_id, subido_at, subido_por, preferida: [{departamento_id, por, at, nota}]}]
 */
function malla_grupos_de_version(PDO $pdo, int $semestreId, array $deptos, int $corridaId): array
{
    $st = $pdo->prepare(
        'SELECT v.departamento_id, v.grupos, v.preferida_at, v.nota, pp.nombre AS preferida_por,
                c.subido_at, p.nombre AS subido_por
           FROM malla_version v
           JOIN motor_corrida c ON c.id = v.corrida_id
           JOIN profesor p      ON p.id = c.subido_por
           LEFT JOIN profesor pp ON pp.id = v.preferida_por
          WHERE v.semestre_id = ? AND v.corrida_id = ? AND v.departamento_id IN (' . motor_marcas($deptos) . ')
          ORDER BY v.departamento_id'
    );
    $st->execute(array_merge([$semestreId, $corridaId], $deptos));
    $filas = $st->fetchAll();
    if ($filas === []) {
        error_json('Esa versión de la malla no existe en este alcance', 404);
    }
    $grupos = [];
    $preferida = [];
    foreach ($filas as $f) {
        foreach (json_decode((string) $f['grupos'], true) ?: [] as $g) {
            $grupos[$g['grupo_id']] = $g;
        }
        if ($f['preferida_at'] !== null) {
            $preferida[] = [
                'departamento_id' => (int) $f['departamento_id'],
                'por'             => $f['preferida_por'],
                'at'              => motor_hora_local($f['preferida_at']),
                'nota'            => $f['nota'],
            ];
        }
    }
    return [array_values($grupos), [
        'corrida_id' => $corridaId,
        'subido_at'  => motor_hora_local($filas[0]['subido_at']),
        'subido_por' => $filas[0]['subido_por'],
        'preferida'  => $preferida,
    ]];
}

// GET ?corrida_id=N: la malla que dejó esa subida, en solo lectura (D60).
$corridaVista = null;
if (filter_input(INPUT_GET, 'corrida_id') !== null) {
    $corridaVista = param_id('corrida_id');
}

$yo = mi_perfil();
try {
    $rej = motor_rejilla($pdo);
    $entrada = motor_armar_entrada(
        $pdo, $rej, $semestre, $deptos, true, motor_ahora(),
        ['id' => (int) $yo['id'], 'nombre' => $yo['nombre']],
        false
    );
    // --- los grupos sin publicar (los conservados también), como los publicados de grupos_fijos (§3.7) ---
    // O, con ?corrida_id=, los que dejó esa subida (malla_version, D60).
    $version = null;
    if ($corridaVista === null) {
        $grupos = motor_grupos_sin_publicar($rej, $entrada, motor_clases($pdo, $semestreId), $deptos);
    } else {
        list($grupos, $version) = malla_grupos_de_version($pdo, $semestreId, $deptos, $corridaVista);
        $grupos = motor_solo_profesores_del_paquete($grupos, $entrada);
    }

    // --- qué grupo cumple cada asignación directa (motor_emparejar_asignaciones) ---
    $lugares = array_merge($grupos, $entrada['grupos_fijos']);
    foreach (motor_emparejar_asignaciones($entrada['asignaciones_fijas'], $lugares) as $i => $aid) {
        if ($i < count($grupos)) {
            $grupos[$i]['asignacion_fija_id'] = $aid;
        } else {
            $entrada['grupos_fijos'][$i - count($grupos)]['asignacion_fija_id'] = $aid;
        }
    }

    // --- la última corrida que toca el alcance (o la de la versión que se ve) ---
    $st = $pdo->prepare(
        'SELECT c.departamentos, c.desfasada, c.motor, c.sin_asignar, c.metricas,
                c.grupos_creados, c.subido_at, p.nombre AS subido_por
           FROM motor_corrida c JOIN profesor p ON p.id = c.subido_por
          WHERE c.semestre_id = ?' . ($corridaVista === null ? '' : ' AND c.id = ?') . '
          ORDER BY c.id DESC
          LIMIT 20'
    );
    $st->execute($corridaVista === null ? [$semestreId] : [$semestreId, $corridaVista]);
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

    // --- los avisos que la jefatura descartó, de los departamentos del alcance ---
    $st = $pdo->prepare(
        'SELECT a.llave, a.descripcion, a.departamento_id, a.descartado_at, p.nombre AS descartado_por
           FROM malla_aviso_descartado a JOIN profesor p ON p.id = a.descartado_por
          WHERE a.semestre_id = ? AND a.departamento_id IN (' . motor_marcas($deptos) . ')'
    );
    $st->execute(array_merge([$semestreId], $deptos));
    $descartados = [];
    foreach ($st->fetchAll() as $a) {
        $descartados[] = [
            'llave'           => $a['llave'],
            'descripcion'     => $a['descripcion'],
            'departamento_id' => (int) $a['departamento_id'],
            'descartado_por'  => $a['descartado_por'],
            'descartado_at'   => motor_hora_local($a['descartado_at']),
        ];
    }
} catch (Throwable $e) {
    fallo_interno('malla.php', $e, 'No se pudo armar la malla');
}

responder([
    'entrada'     => motor_entrada_json($entrada),
    'grupos'      => $grupos,
    'corrida'     => $corrida,
    'descartados' => $descartados,
    'version'     => $version,
]);
