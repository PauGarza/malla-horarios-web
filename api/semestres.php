<?php
// =============================================================================
// El ciclo de semestres (admin y jefa de división).
//
//   GET                                  -> { semestres[], resumen{} }
//   POST ?recurso=abrir     { tipo, anio }       -> { semestre }
//   POST ?recurso=reactivar { semestre_id }      -> { semestre }
//
// Hay exactamente UN semestre activo: el que se está planeando. Abrir el
// siguiente lo activa y cierra el anterior, que queda de consulta (ninguna
// escritura lo acepta: exigir_semestre_activo() en lib/semestre.php).
//
// Al abrir, cada departamento arranca con una COPIA del formulario que usó la
// vez pasada, sin publicar (decisión del 2026-09-29), y con la misma
// disponibilidad de salones. No se copian preferencias, bloqueos ni demanda:
// eso es de cada semestre.
//
// Autorización: el semestre es uno solo para los 3 departamentos de la
// división, así que no basta con ser jefe de departamento —
// administra_semestres() (admin y jefe_division). No es
// ve_todos_los_departamentos(): desde 2026-10-02 la jefa de división ve solo
// Matemáticas, pero el semestre sigue siendo suyo.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET', 'POST');
exigir_rol(...ROLES_GESTION);
if (!administra_semestres()) {
    error_json('Solo la jefatura de división y el administrador manejan los semestres', 403);
}

$pdo = db();

// -----------------------------------------------------------------------------
// GET: los semestres y, por departamento, cómo va cada uno
// -----------------------------------------------------------------------------

if (metodo_http() === 'GET') {
    $semestres = $pdo->query(
        'SELECT id, tipo, anio, CONCAT(tipo, \'-\', anio) AS etiqueta, estado, abierto_at, cerrado_at
           FROM semestre ORDER BY anio DESC, FIELD(tipo, \'otono\', \'verano\', \'primavera\')'
    )->fetchAll();

    // resumen[semestre_id][departamento_id] = { publicado, enviadas, borradores, demanda }
    $resumen = [];
    $poner = static function (int $sem, int $depto, string $campo, $valor) use (&$resumen) {
        if (!isset($resumen[$sem][$depto])) {
            $resumen[$sem][$depto] = ['publicado' => false, 'enviadas' => 0, 'borradores' => 0, 'demanda' => 0];
        }
        $resumen[$sem][$depto][$campo] = $valor;
    };

    foreach ($pdo->query('SELECT departamento_id, semestre_id, publicado FROM departamento_semestre_config') as $c) {
        $poner((int) $c['semestre_id'], (int) $c['departamento_id'], 'publicado', (int) $c['publicado'] === 1);
    }
    $st = $pdo->query(
        'SELECT pref.semestre_id, p.departamento_id, pref.estado, COUNT(*) AS n
           FROM preferencia pref JOIN profesor p ON p.id = pref.profesor_id
          WHERE p.departamento_id IS NOT NULL
          GROUP BY pref.semestre_id, p.departamento_id, pref.estado'
    );
    foreach ($st as $f) {
        $poner((int) $f['semestre_id'], (int) $f['departamento_id'],
            $f['estado'] === 'enviado' ? 'enviadas' : 'borradores', (int) $f['n']);
    }
    $st = $pdo->query(
        'SELECT ed.semestre_id, m.departamento_id, COUNT(*) AS n
           FROM estimacion_demanda ed JOIN materia m ON m.id = ed.materia_id
          GROUP BY ed.semestre_id, m.departamento_id'
    );
    foreach ($st as $f) {
        $poner((int) $f['semestre_id'], (int) $f['departamento_id'], 'demanda', (int) $f['n']);
    }

    // Quien administra semestres sin ver todos los departamentos (hoy, la
    // jefatura de división: ver DIVISION_SOLO_SU_DEPARTAMENTO) solo recibe el
    // avance del suyo. Los semestres en sí sí son de toda la división.
    if (!ve_todos_los_departamentos()) {
        $mio = mi_departamento();
        foreach ($resumen as $sem => $porDepto) {
            $resumen[$sem] = ($mio !== null && isset($porDepto[$mio])) ? [$mio => $porDepto[$mio]] : [];
        }
    }

    responder([
        'semestres' => $semestres,
        'resumen'   => (object) $resumen,
        // null = todos. Para que la pantalla no pinte columnas vacías de
        // departamentos que no le tocan.
        'departamentos_visibles' => ve_todos_los_departamentos() ? null : [mi_departamento()],
    ]);
}

// -----------------------------------------------------------------------------
// POST
// -----------------------------------------------------------------------------

$recurso = filter_input(INPUT_GET, 'recurso');
$body    = cuerpo_json();

/**
 * Deja $destino como el único semestre activo y, para cada departamento que
 * todavía no tenga formulario ahí, copia el del semestre anterior. También
 * copia la disponibilidad de salones si el destino no tiene.
 * Corre dentro de la transacción de quien llama.
 */
function activar_semestre(PDO $pdo, int $destino): void
{
    $anterior = semestre_activo($pdo);

    $pdo->prepare(
        'UPDATE semestre SET estado = \'cerrado\', cerrado_at = ? WHERE estado = \'activo\' AND id <> ?'
    )->execute([ahora_utc(), $destino]);
    $pdo->prepare(
        'UPDATE semestre SET estado = \'activo\', abierto_at = ?, abierto_por = ?, cerrado_at = NULL WHERE id = ?'
    )->execute([ahora_utc(), mi_id(), $destino]);

    foreach ($pdo->query('SELECT id FROM departamento')->fetchAll(PDO::FETCH_COLUMN) as $depto) {
        $depto = (int) $depto;
        if (tiene_formulario($pdo, $depto, $destino)) {
            continue;
        }
        $desde = semestre_anterior_con_formulario($pdo, $depto, $destino);
        if ($desde !== null) {
            copiar_formulario($pdo, $depto, $desde, $destino);
        }
        // Sin formulario anterior no se siembra aquí: asegurar_formulario()
        // pone la plantilla la primera vez que alguien abre el editor.
    }

    if ($anterior !== null && (int) $anterior['id'] !== $destino) {
        $st = $pdo->prepare('SELECT COUNT(*) FROM salon_disponibilidad_departamento WHERE semestre_id = ?');
        $st->execute([$destino]);
        if ((int) $st->fetchColumn() === 0) {
            $pdo->prepare(
                'INSERT IGNORE INTO salon_disponibilidad_departamento
                        (salon_id, departamento_id, semestre_id, dia, franja_id)
                 SELECT salon_id, departamento_id, ?, dia, franja_id
                   FROM salon_disponibilidad_departamento WHERE semestre_id = ?'
            )->execute([$destino, (int) $anterior['id']]);
        }
    }
}

if ($recurso === 'abrir') {
    $tipo = isset($body['tipo']) ? (string) $body['tipo'] : '';
    if (!in_array($tipo, ['primavera', 'verano', 'otono'], true)) {
        error_json('Tipo de semestre inválido', 400);
    }
    $anio = filter_var(isset($body['anio']) ? $body['anio'] : null, FILTER_VALIDATE_INT);
    if ($anio === false || $anio === null || $anio < 2020 || $anio > 2100) {
        error_json('Año inválido', 400);
    }

    $pdo->beginTransaction();
    try {
        // FOR UPDATE sobre la tabla completa: dos personas abriendo semestre a
        // la vez no deben terminar con dos activos.
        $pdo->query('SELECT id FROM semestre FOR UPDATE')->fetchAll();

        $st = $pdo->prepare('SELECT id, estado FROM semestre WHERE tipo = ? AND anio = ?');
        $st->execute([$tipo, (int) $anio]);
        $existente = $st->fetch();
        if ($existente && $existente['estado'] === 'activo') {
            $pdo->rollBack();
            error_json('Ese semestre ya es el activo', 409, 'ya_activo');
        }
        if ($existente) {
            $destino = (int) $existente['id'];
        } else {
            $pdo->prepare('INSERT INTO semestre (tipo, anio, estado) VALUES (?, ?, \'cerrado\')')
                ->execute([$tipo, (int) $anio]);
            $destino = (int) $pdo->lastInsertId();
        }

        activar_semestre($pdo, $destino);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fallo_interno('semestres.php abrir', $e, 'No se pudo abrir el semestre');
    }
    responder(['semestre' => semestre_activo($pdo)]);
}

if ($recurso === 'reactivar') {
    $id = filter_var(isset($body['semestre_id']) ? $body['semestre_id'] : null, FILTER_VALIDATE_INT);
    if ($id === false || $id === null) {
        error_json('Falta semestre_id', 400);
    }

    $pdo->beginTransaction();
    try {
        $pdo->query('SELECT id FROM semestre FOR UPDATE')->fetchAll();
        $st = $pdo->prepare('SELECT estado FROM semestre WHERE id = ?');
        $st->execute([(int) $id]);
        $estado = $st->fetchColumn();
        if ($estado === false) {
            $pdo->rollBack();
            error_json('No existe ese semestre', 404);
        }
        if ($estado === 'activo') {
            $pdo->rollBack();
            error_json('Ese semestre ya es el activo', 409, 'ya_activo');
        }
        activar_semestre($pdo, (int) $id);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fallo_interno('semestres.php reactivar', $e, 'No se pudo reactivar el semestre');
    }
    responder(['semestre' => semestre_activo($pdo)]);
}

error_json('Recurso no soportado', 400);
