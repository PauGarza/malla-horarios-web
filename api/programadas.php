<?php
// =============================================================================
// Archivos de Matemáticas (2026-11-03): los datos con que la vista arma el
// Excel de Materias programadas (para Servicios Escolares) y los PDF por
// división. Solo Matemáticas: Estadística no usa ese formato.
//
//   GET    ?semestre_id=N
//          -> { departamento_id, grupos: [...], ajustes: [...] }
//
//   POST   ?semestre_id=N&recurso=ajustes
//          { materia_id, numero, accion, valor, motivo }  -> { ajustes }
//          Guarda (o reemplaza) un ajuste. accion: separar | vaciar |
//          porcentaje (valor 0 a 100) | confirmado.
//
//   DELETE ?semestre_id=N&recurso=ajustes&id=A             -> { ajustes }
//
// grupos: los de MAT no cancelados del semestre, uno por clave (una clase
// compartida sale con cada una de sus claves, como en el Excel):
//   { grupo_id, materia_id, clave, materia, numero, cupo_maximo, porcentaje,
//     profesores: [{ nombre, cu, departamento_id, por_asignar }],
//     sesiones:   [{ dia, inicio, fin, bloques }],   un renglón por día
//     compartido: [{ clave, numero, nombre, porcentaje }],
//     planes:     [{ clave, vigente, semestre_plan }] }
// porcentaje es el de este grupo en su clase compartida: el sistema lo guarda
// en las filas de imparte_co_oferta cuyo imparte_id es el del propio grupo
// (motor_clases en lib/motor.php). Va con los de otros departamentos
// (ACT-11310) porque el Excel nombra todas las claves de la clase.
//
// Los ajustes solo cambian los archivos, nunca la malla; ver
// bd/mysql/migracion-2026-11-03-ajustes-programadas.sql. Qué grupos quedan
// fuera (los que programa Actuaría) y cómo se arma cada archivo lo decide el
// frontend (src/lib/archivosMate.js), que enseña la lista.
//
// Autorización: ROLES_GESTION + exigir_jefe_de(Matemáticas). Entran la
// jefatura de Matemáticas (la de división hoy está acotada a Matemáticas) y el
// admin; el resto, 403.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';
require_once __DIR__ . '/lib/motor.php';

const ACCIONES_AJUSTE = ['separar', 'vaciar', 'porcentaje', 'confirmado'];

exigir_metodo('GET', 'POST', 'DELETE');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$semestreId = param_id('semestre_id');

$mat = $pdo->query("SELECT id FROM departamento WHERE clave_prefijo = 'MAT'")->fetchColumn();
if ($mat === false) {
    error_json('No existe el departamento de Matemáticas', 404);
}
$mat = (int) $mat;
exigir_jefe_de($mat);

/** Los ajustes del semestre, en el orden en que se enseñan. */
function leer_ajustes(PDO $pdo, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT a.id, a.materia_id, m.clave, a.numero, a.accion, a.valor, a.motivo,
                p.nombre AS creado_por, a.creado_at
           FROM ajuste_programadas a
           JOIN materia m  ON m.id = a.materia_id
           JOIN profesor p ON p.id = a.creado_por
          WHERE a.semestre_id = ?
          ORDER BY m.clave, a.numero, a.accion'
    );
    $st->execute([$semestreId]);
    return array_map(static function (array $a): array {
        return [
            'id'         => (int) $a['id'],
            'materia_id' => (int) $a['materia_id'],
            'clave'      => $a['clave'],
            'numero'     => $a['numero'],
            'accion'     => $a['accion'],
            'valor'      => $a['valor'] === null ? null : (float) $a['valor'],
            'motivo'     => $a['motivo'],
            'creado_por' => $a['creado_por'],
            'creado_at'  => motor_hora_local($a['creado_at']),
        ];
    }, $st->fetchAll());
}

$recurso = filter_input(INPUT_GET, 'recurso');

// -----------------------------------------------------------------------------
// POST / DELETE ?recurso=ajustes
// -----------------------------------------------------------------------------

if (metodo_http() !== 'GET') {
    if ($recurso !== 'ajustes') {
        error_json('Falta recurso=ajustes', 400);
    }
    exigir_semestre_activo($pdo, $semestreId);

    if (metodo_http() === 'DELETE') {
        $id = param_id('id');
        $st = $pdo->prepare('DELETE FROM ajuste_programadas WHERE id = ? AND semestre_id = ?');
        $st->execute([$id, $semestreId]);
        if ($st->rowCount() === 0) {
            error_json('Ese ajuste no existe', 404);
        }
        responder(['ajustes' => leer_ajustes($pdo, $semestreId)]);
    }

    $body = cuerpo_json();
    $accion = $body['accion'] ?? null;
    if (!in_array($accion, ACCIONES_AJUSTE, true)) {
        error_json('accion debe ser ' . implode(', ', ACCIONES_AJUSTE), 400);
    }
    $materiaId = filter_var($body['materia_id'] ?? null, FILTER_VALIDATE_INT);
    $numero = trim((string) ($body['numero'] ?? ''));
    if ($materiaId === false || $materiaId < 1 || $numero === '') {
        error_json('Faltan materia_id y numero', 400);
    }

    // El grupo tiene que ser de Matemáticas, de este semestre y no cancelado.
    $st = $pdo->prepare(
        "SELECT g.id, i.id AS imparte_id
           FROM grupo g
           JOIN materia m      ON m.id = g.materia_id
           LEFT JOIN imparte i ON i.grupo_id = g.id
          WHERE g.semestre_id = ? AND g.materia_id = ? AND g.numero = ?
            AND m.departamento_id = ? AND g.estado <> 'cancelado'"
    );
    $st->execute([$semestreId, $materiaId, $numero, $mat]);
    $grupo = $st->fetch();
    if ($grupo === false) {
        error_json('Ese grupo no está en la malla de Matemáticas de este semestre', 404);
    }

    $valor = null;
    if ($accion === 'porcentaje') {
        $valor = filter_var($body['valor'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($valor === false || $valor < 0 || $valor > 100) {
            error_json('El porcentaje va de 0 a 100', 400);
        }
    }
    if ($accion === 'separar' || $accion === 'porcentaje') {
        $compartido = false;
        if ($grupo['imparte_id'] !== null) {
            $st = $pdo->prepare('SELECT 1 FROM imparte_co_oferta WHERE imparte_id = ? LIMIT 1');
            $st->execute([(int) $grupo['imparte_id']]);
            $compartido = $st->fetchColumn() !== false;
        }
        if (!$compartido) {
            error_json('Ese grupo no comparte clase con otra clave', 400, 'sin_clave_compartida');
        }
    }
    $motivo = texto_opcional($body, 'motivo');
    if ($motivo !== null) {
        $motivo = function_exists('mb_substr') ? mb_substr($motivo, 0, 300) : substr($motivo, 0, 300);
    }

    try {
        $st = $pdo->prepare(
            'INSERT INTO ajuste_programadas
                    (semestre_id, materia_id, numero, accion, valor, motivo, creado_por, creado_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE valor = VALUES(valor), motivo = VALUES(motivo),
                                     creado_por = VALUES(creado_por), creado_at = VALUES(creado_at)'
        );
        $st->execute([$semestreId, $materiaId, $numero, $accion, $valor, $motivo, mi_id(), ahora_utc()]);
    } catch (Throwable $e) {
        fallo_interno('programadas.php POST', $e, 'No se pudo guardar el ajuste');
    }
    responder(['ajustes' => leer_ajustes($pdo, $semestreId)]);
}

// -----------------------------------------------------------------------------
// GET — los grupos de Matemáticas y los ajustes
// -----------------------------------------------------------------------------

$st = $pdo->prepare(
    "SELECT g.id, g.materia_id, m.clave, m.nombre, g.numero, g.cupo_maximo, i.id AS imparte_id
       FROM grupo g
       JOIN materia m      ON m.id = g.materia_id
       LEFT JOIN imparte i ON i.grupo_id = g.id
      WHERE g.semestre_id = ? AND m.departamento_id = ? AND g.estado <> 'cancelado'
      ORDER BY m.clave, g.numero, g.id"
);
$st->execute([$semestreId, $mat]);
$filas = $st->fetchAll();

// Lo de cada imparte del semestre; abajo se toma solo el de los grupos MAT.
$deSemestre = 'JOIN imparte i ON i.id = t.imparte_id JOIN grupo g ON g.id = i.grupo_id WHERE g.semestre_id = ?';

$profesores = [];
$st = $pdo->prepare(
    "SELECT t.imparte_id, p.nombre, p.cu, p.departamento_id, p.por_asignar
       FROM imparte_profesor t JOIN profesor p ON p.id = t.profesor_id
     $deSemestre ORDER BY p.nombre"
);
$st->execute([$semestreId]);
foreach ($st->fetchAll() as $p) {
    $profesores[(int) $p['imparte_id']][] = [
        'nombre'          => $p['nombre'],
        'cu'              => $p['cu'],
        'departamento_id' => $p['departamento_id'] === null ? null : (int) $p['departamento_id'],
        'por_asignar'     => (int) $p['por_asignar'] === 1,
    ];
}

// Un renglón por día: inicio, fin y cuántos bloques de 30 min tiene (si no
// cuadran con inicio-fin, el día tiene un hueco y la vista lo avisa).
$sesiones = [];
$st = $pdo->prepare(
    "SELECT t.imparte_id, t.dia,
            TIME_FORMAT(MIN(f.hora_inicio), '%H:%i') AS inicio,
            TIME_FORMAT(MAX(f.hora_fin), '%H:%i') AS fin,
            COUNT(*) AS bloques
       FROM imparte_horario t JOIN franja_horaria f ON f.id = t.franja_id
     $deSemestre
      GROUP BY t.imparte_id, t.dia
      ORDER BY t.imparte_id, FIELD(t.dia, 'lunes', 'martes', 'miercoles', 'jueves', 'viernes')"
);
$st->execute([$semestreId]);
foreach ($st->fetchAll() as $s) {
    $sesiones[(int) $s['imparte_id']][] = [
        'dia'     => $s['dia'],
        'inicio'  => $s['inicio'],
        'fin'     => $s['fin'],
        'bloques' => (int) $s['bloques'],
    ];
}

// El % de cada imparte en su clase compartida, y con quién la comparte.
$porcentaje = [];
$st = $pdo->prepare(
    "SELECT t.imparte_id, MAX(t.porcentaje_responsabilidad) AS porcentaje
       FROM imparte_co_oferta t $deSemestre GROUP BY t.imparte_id"
);
$st->execute([$semestreId]);
foreach ($st->fetchAll() as $c) {
    $porcentaje[(int) $c['imparte_id']] = $c['porcentaje'] === null ? null : (float) $c['porcentaje'];
}
$compartido = [];
$st = $pdo->prepare(
    "SELECT t.imparte_id, t.imparte_relacionado_id, m2.clave, m2.nombre, g2.numero
       FROM imparte_co_oferta t
       JOIN imparte i2 ON i2.id = t.imparte_relacionado_id
       JOIN grupo g2   ON g2.id = i2.grupo_id
       JOIN materia m2 ON m2.id = g2.materia_id
     $deSemestre ORDER BY m2.clave, g2.numero"
);
$st->execute([$semestreId]);
foreach ($st->fetchAll() as $c) {
    $rel = (int) $c['imparte_relacionado_id'];
    $compartido[(int) $c['imparte_id']][] = [
        'clave'      => $c['clave'],
        'numero'     => $c['numero'],
        'nombre'     => $c['nombre'],
        'porcentaje' => $porcentaje[$rel] ?? null,
    ];
}

$planes = [];
$st = $pdo->prepare(
    'SELECT pem.materia_id, pe.clave, pe.activo, pem.semestre_plan
       FROM plan_estudio_materia pem
       JOIN plan_estudio pe ON pe.id = pem.plan_estudio_id
       JOIN materia m       ON m.id = pem.materia_id
      WHERE m.departamento_id = ? AND pe.clave IS NOT NULL
      ORDER BY pe.clave'
);
$st->execute([$mat]);
foreach ($st->fetchAll() as $p) {
    $planes[(int) $p['materia_id']][] = [
        'clave'         => $p['clave'],
        'vigente'       => (int) $p['activo'] === 1,
        'semestre_plan' => $p['semestre_plan'] === null ? null : (int) $p['semestre_plan'],
    ];
}

$grupos = [];
foreach ($filas as $g) {
    $iid = $g['imparte_id'] === null ? null : (int) $g['imparte_id'];
    $grupos[] = [
        'grupo_id'    => (int) $g['id'],
        'materia_id'  => (int) $g['materia_id'],
        'clave'       => $g['clave'],
        'materia'     => $g['nombre'],
        'numero'      => $g['numero'],
        'cupo_maximo' => $g['cupo_maximo'] === null ? null : (int) $g['cupo_maximo'],
        'porcentaje'  => $iid === null ? null : ($porcentaje[$iid] ?? null),
        'profesores'  => $iid === null ? [] : ($profesores[$iid] ?? []),
        'sesiones'    => $iid === null ? [] : ($sesiones[$iid] ?? []),
        'compartido'  => $iid === null ? [] : ($compartido[$iid] ?? []),
        'planes'      => $planes[(int) $g['materia_id']] ?? [],
    ];
}

responder([
    'departamento_id' => $mat,
    'grupos'          => $grupos,
    'ajustes'         => leer_ajustes($pdo, $semestreId),
]);
