<?php
// =============================================================================
// Estimación de demanda de Servicios Escolares (jefatura).
//
//   GET  ?semestre_id=N[&departamento_id=D]  -> { filas[], materias[], semestre_activo }
//   POST ?semestre_id=N[&departamento_id=D]  { filas:[...] }
//        -> { nuevas, actualizadas, demanda, eliminadas }
//
// Cada semestre Servicios Escolares manda un PDF por departamento con la
// estimación ("Mat 202603.pdf": 15 columnas, ver diseno-bd.md §10.3). Hasta
// 2026-09-29 se transcribía a mano; ahora la pantalla lee el PDF en el
// navegador (frontend/src/lib/parserDemanda.js), enseña una vista previa y
// manda aquí las filas ya revisadas.
//
// Lo que hace el POST, en UNA transacción:
//   1. materia: si la clave no existe, la crea (y la deja OCULTA y por revisar
//      en el formulario del semestre, para que no aparezca sola en uno ya
//      publicado); si existe, actualiza nombre y créditos cuando cambiaron
//      (un rediseño de plan puede subir créditos).
//      Una fila sin nombre (el PDF real de Estadística trae dos) conserva el
//      que ya tenía la materia; si es nueva, es un error.
//   2. estimacion_demanda: upsert por (materia, semestre). No toca
//      mostrar_en_cuestionario, para no revertir un ocultamiento manual.
//   3. La estimación que se sube REEMPLAZA a la anterior de ese departamento y
//      semestre: las materias que ya no vienen en el PDF pierden su fila de
//      demanda (la materia en sí no se toca).
//
// Autorización (equivale a estimacion_demanda_departamento y
// materia_escritura_departamento de rls-policies.sql): departamento_objetivo()
// + cada clave debe llevar el prefijo de ese departamento. Solo el semestre
// activo acepta escrituras.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET', 'POST');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$deptoId    = departamento_objetivo();   // ya corrió exigir_jefe_de()
$semestreId = param_id('semestre_id');

const MAX_FILAS = 300;

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

if (metodo_http() === 'GET') {
    $st = $pdo->prepare(
        'SELECT m.id AS materia_id, m.clave, m.nombre, m.creditos, m.activa,
                ed.alumnos_total, ed.nuevo_ingreso, ed.pct_baja, ed.pct_reprobacion,
                ed.con_prerrequisito, ed.demanda_ajustada, ed.capacidad_planeacion,
                ed.grupos_periodo_anterior, ed.grupos_sugeridos
           FROM estimacion_demanda ed
           JOIN materia m ON m.id = ed.materia_id
          WHERE ed.semestre_id = ? AND m.departamento_id = ?
          ORDER BY m.clave'
    );
    $st->execute([$semestreId, $deptoId]);
    $filas = $st->fetchAll();

    // El catálogo del departamento, para que la vista previa marque qué es
    // nuevo y qué cambió sin pedir nada más.
    $st = $pdo->prepare(
        'SELECT id, clave, nombre, creditos, activa FROM materia WHERE departamento_id = ? ORDER BY clave'
    );
    $st->execute([$deptoId]);

    $estado = $pdo->prepare('SELECT estado FROM semestre WHERE id = ?');
    $estado->execute([$semestreId]);

    responder([
        'filas'           => $filas,
        'materias'        => $st->fetchAll(),
        'semestre_activo' => $estado->fetchColumn() === 'activo',
    ]);
}

// -----------------------------------------------------------------------------
// POST: validar todo antes de escribir
// -----------------------------------------------------------------------------

exigir_semestre_activo($pdo, $semestreId);

$st = $pdo->prepare('SELECT clave_prefijo FROM departamento WHERE id = ?');
$st->execute([$deptoId]);
$prefijo = (string) $st->fetchColumn();

$body = cuerpo_json();
$entrada = isset($body['filas']) && is_array($body['filas']) ? $body['filas'] : [];
if ($entrada === []) {
    error_json('No hay filas que guardar', 400);
}
if (count($entrada) > MAX_FILAS) {
    error_json('Demasiadas filas (máximo ' . MAX_FILAS . ')', 400);
}

/** Número >= 0 (entero si $entero), o corta con 400 nombrando la columna. */
function num_valido(array $f, string $campo, bool $entero, string $clave, float $max = 1e7)
{
    $v = isset($f[$campo]) ? $f[$campo] : null;
    $n = $entero ? filter_var($v, FILTER_VALIDATE_INT) : filter_var($v, FILTER_VALIDATE_FLOAT);
    if ($n === false || $n === null || $n < 0 || $n > $max) {
        error_json("$clave: el valor de $campo no es válido", 400, 'fila_invalida');
    }
    return $entero ? (int) $n : round((float) $n, 2);
}

$filas = [];
foreach ($entrada as $f) {
    if (!is_array($f)) {
        error_json('Fila inválida', 400);
    }
    $clave = strtoupper(trim(isset($f['clave']) ? (string) $f['clave'] : ''));
    if (!preg_match('/^' . preg_quote($prefijo, '/') . '-\d{4,6}$/', $clave)) {
        error_json("La clave \"$clave\" no es de este departamento (se espera $prefijo-#####)", 400, 'clave_ajena');
    }
    if (isset($filas[$clave])) {
        error_json("La clave $clave viene repetida", 400, 'clave_repetida');
    }
    $nombre = trim(isset($f['nombre']) ? (string) $f['nombre'] : '');
    if (mb_strlen($nombre) > 255) {
        error_json("$clave: el nombre es demasiado largo", 400);
    }
    $filas[$clave] = [
        'nombre'   => $nombre,
        'creditos' => num_valido($f, 'creditos', true, $clave, 30),
        'valores'  => [
            num_valido($f, 'alumnos_total', true, $clave),
            num_valido($f, 'nuevo_ingreso', true, $clave),
            num_valido($f, 'pct_baja', false, $clave, 100),
            num_valido($f, 'pct_reprobacion', false, $clave, 100),
            num_valido($f, 'con_prerrequisito', false, $clave, 999999),
            num_valido($f, 'demanda_ajustada', false, $clave, 999999),
            num_valido($f, 'capacidad_planeacion', true, $clave, 9999),
            num_valido($f, 'grupos_periodo_anterior', true, $clave, 999),
            num_valido($f, 'grupos_sugeridos', true, $clave, 999),
        ],
    ];
    if ($filas[$clave]['creditos'] < 1) {
        error_json("$clave: los créditos deben ser mayores que 0", 400, 'fila_invalida');
    }
}

// -----------------------------------------------------------------------------
// Escribir, todo o nada
// -----------------------------------------------------------------------------

$nuevas = 0;
$actualizadas = 0;
$pdo->beginTransaction();
try {
    $buscar = $pdo->prepare('SELECT id, nombre, creditos, departamento_id FROM materia WHERE clave = ? FOR UPDATE');
    $crear  = $pdo->prepare(
        'INSERT INTO materia (clave, nombre, creditos, departamento_id) VALUES (?,?,?,?)'
    );
    $cambiar = $pdo->prepare('UPDATE materia SET nombre = ?, creditos = ? WHERE id = ?');
    $ocultar = $pdo->prepare(
        'INSERT IGNORE INTO materia_cuestionario (materia_id, semestre_id, seccion_id, revisado)
         VALUES (?, ?, NULL, 0)'
    );
    $demanda = $pdo->prepare(
        'INSERT INTO estimacion_demanda
                (materia_id, semestre_id, alumnos_total, nuevo_ingreso, pct_baja, pct_reprobacion,
                 con_prerrequisito, demanda_ajustada, capacidad_planeacion,
                 grupos_periodo_anterior, grupos_sugeridos)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
                alumnos_total = VALUES(alumnos_total), nuevo_ingreso = VALUES(nuevo_ingreso),
                pct_baja = VALUES(pct_baja), pct_reprobacion = VALUES(pct_reprobacion),
                con_prerrequisito = VALUES(con_prerrequisito), demanda_ajustada = VALUES(demanda_ajustada),
                capacidad_planeacion = VALUES(capacidad_planeacion),
                grupos_periodo_anterior = VALUES(grupos_periodo_anterior),
                grupos_sugeridos = VALUES(grupos_sugeridos)'
    );

    $ids = [];
    foreach ($filas as $clave => $f) {
        $buscar->execute([$clave]);
        $materia = $buscar->fetch();
        if ($materia === false) {
            if ($f['nombre'] === '') {
                $pdo->rollBack();
                error_json("$clave es una materia nueva y no trae nombre: escríbelo antes de guardar", 400, 'sin_nombre');
            }
            $crear->execute([$clave, $f['nombre'], $f['creditos'], $deptoId]);
            $materiaId = (int) $pdo->lastInsertId();
            // Oculta y "por revisar" en el formulario de este semestre. Sin
            // esta fila, la regla fail-open de repartir_materias() la pondría
            // sola en la sección por defecto, y como la demanda llega DESPUÉS
            // de que los profesores contestan, aparecería de golpe en un
            // formulario ya publicado. La jefatura decide si la agrega.
            $ocultar->execute([$materiaId, $semestreId]);
            $nuevas++;
        } else {
            if ((int) $materia['departamento_id'] !== $deptoId) {
                $pdo->rollBack();
                error_json("$clave ya existe en otro departamento", 400, 'clave_ajena');
            }
            $materiaId = (int) $materia['id'];
            $nombre = $f['nombre'] === '' ? $materia['nombre'] : $f['nombre'];
            if ($nombre !== $materia['nombre'] || $f['creditos'] !== (int) $materia['creditos']) {
                $cambiar->execute([$nombre, $f['creditos'], $materiaId]);
                $actualizadas++;
            }
        }
        $demanda->execute(array_merge([$materiaId, $semestreId], $f['valores']));
        $ids[] = $materiaId;
    }

    // Reemplazo: lo que ya no viene en el PDF deja de tener demanda este semestre.
    $marcas = implode(',', array_fill(0, count($ids), '?'));
    $st = $pdo->prepare(
        "DELETE ed FROM estimacion_demanda ed JOIN materia m ON m.id = ed.materia_id
          WHERE ed.semestre_id = ? AND m.departamento_id = ? AND ed.materia_id NOT IN ($marcas)"
    );
    $st->execute(array_merge([$semestreId, $deptoId], $ids));
    $eliminadas = $st->rowCount();

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fallo_interno('demanda.php', $e, 'No se pudo guardar la estimación de demanda');
}

responder([
    'nuevas'      => $nuevas,
    'actualizadas' => $actualizadas,
    'demanda'     => count($ids),
    'eliminadas'  => $eliminadas,
]);
