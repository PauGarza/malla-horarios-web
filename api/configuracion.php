<?php
// =============================================================================
// Configuración del cuestionario (vista de Jefe de Departamento/admin).
//
//   GET ?semestre_id=N
//       -> { materias[], cuestionario{}, config, profesores[], elegibles{} }
//
//   PUT ?recurso=cuestionario&semestre_id=N   { filas:[...] }
//   PUT ?recurso=departamento&semestre_id=N   { mostrar_seleccion_materias, horas_minimas_verde }
//   PUT ?recurso=modo_materias&semestre_id=N  { profesor_id, modo }
//   PUT ?recurso=elegibles                    { profesor_id, materia_ids:[...] }
//
// Políticas que reemplaza:
//   materia_cuestionario_escritura  -> exigir_jefe_de(depto de cada materia)
//   departamento_config_escritura   -> exigir_jefe_de($departamento_id)
//   jefe_modo_materias_update       -> exigir_jefe_de(depto del profesor objetivo)
//   jefe_elegibilidad_escritura     -> igual
//   roster_departamento_select      -> el roster se filtra por departamento
//
// Aquí mueren dos triggers de rls-policies.sql:
//   trg_bloquear_automodificacion_modo_materias — existía porque
//   GRANT UPDATE (modo_materias_elegibles) es necesariamente amplio (Postgres
//   no permite atar una columna a una sola política) y un profesor podía
//   cambiarse el suyo aprovechando propio_perfil_update. Este endpoint es el
//   único que escribe esa columna y exige ser Jefe del departamento del
//   profesor objetivo, así que no hay nada que bloquear.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

exigir_metodo('GET', 'PUT');
exigir_rol(...ROLES_GESTION);

$pdo     = db();
$metodo  = metodo_http();
$deptoId = departamento_objetivo();

/** Materias activas del departamento que el cuestionario sí muestra. */
function materias_visibles(PDO $pdo, int $deptoId, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT m.id
           FROM materia m
           LEFT JOIN materia_cuestionario mc
                  ON mc.materia_id = m.id AND mc.semestre_id = ?
          WHERE m.departamento_id = ? AND m.activa = 1
            AND (mc.seccion IS NULL OR mc.seccion <> \'oculta\')'
    );
    $st->execute([$semestreId, $deptoId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

/** Corta con 403 si el profesor no es del departamento sobre el que se trabaja. */
function exigir_profesor_del_departamento(PDO $pdo, int $profesorId): int
{
    $st = $pdo->prepare('SELECT departamento_id FROM profesor WHERE id = ?');
    $st->execute([$profesorId]);
    $depto = $st->fetchColumn();
    if ($depto === false) {
        error_json('No existe ese profesor', 404);
    }
    exigir_jefe_de($depto === null ? null : (int) $depto);
    return $depto === null ? 0 : (int) $depto;
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

if ($metodo === 'GET') {
    $semestreId = param_id('semestre_id');

    $st = $pdo->prepare(
        'SELECT id, clave, nombre FROM materia
          WHERE departamento_id = ? AND activa = 1 ORDER BY clave'
    );
    $st->execute([$deptoId]);
    $materias = $st->fetchAll();

    // Solo las filas de materias de este departamento. La lectura de
    // materia_cuestionario estaba abierta a cualquier autenticado en RLS (qué
    // materias están ocultas no es información sensible), pero esta pantalla
    // solo administra las propias y devolver de más no aporta nada.
    $st = $pdo->prepare(
        'SELECT mc.materia_id, mc.seccion, mc.alias_de_id, mc.etiqueta, mc.orden, mc.revisado
           FROM materia_cuestionario mc
           JOIN materia m ON m.id = mc.materia_id
          WHERE mc.semestre_id = ? AND m.departamento_id = ?'
    );
    $st->execute([$semestreId, $deptoId]);
    $cuestionario = [];
    foreach ($st->fetchAll() as $c) {
        $cuestionario[(string) (int) $c['materia_id']] = [
            'materia_id'  => (int) $c['materia_id'],
            'seccion'     => $c['seccion'],
            'alias_de_id' => $c['alias_de_id'] === null ? null : (int) $c['alias_de_id'],
            'etiqueta'    => $c['etiqueta'],
            'orden'       => $c['orden'] === null ? null : (int) $c['orden'],
            'revisado'    => (int) $c['revisado'] === 1,
        ];
    }

    $st = $pdo->prepare(
        'SELECT mostrar_seleccion_materias, horas_minimas_verde
           FROM departamento_semestre_config WHERE departamento_id = ? AND semestre_id = ?'
    );
    $st->execute([$deptoId, $semestreId]);
    $cfg = $st->fetch();

    // Mismo criterio que PanelPreferencias: quien no da clases no aparece.
    $st = $pdo->prepare(
        'SELECT id, nombre, tipo_contrato, modo_materias_elegibles, estado_especial
           FROM profesor
          WHERE departamento_id = ? AND tipo_contrato IS NOT NULL AND activo = 1
          ORDER BY nombre'
    );
    $st->execute([$deptoId]);
    $profesores = $st->fetchAll();

    // Hoy el frontend pide TODA la tabla profesor_materia_elegible y la agrupa
    // en JS. Aquí el JOIN la acota al departamento.
    $st = $pdo->prepare(
        'SELECT pme.profesor_id, pme.materia_id
           FROM profesor_materia_elegible pme
           JOIN profesor p ON p.id = pme.profesor_id
          WHERE p.departamento_id = ?'
    );
    $st->execute([$deptoId]);
    $elegibles = [];
    foreach ($st->fetchAll() as $e) {
        $k = (string) (int) $e['profesor_id'];
        if (!isset($elegibles[$k])) {
            $elegibles[$k] = [];
        }
        $elegibles[$k][] = (int) $e['materia_id'];
    }

    responder([
        'materias'     => $materias,
        'cuestionario' => (object) $cuestionario,
        'config' => [
            // Sin fila = defaults de la propia tabla (fail-open), igual que lee
            // el formulario del profesor.
            'mostrar_seleccion_materias' => $cfg === false ? true : ((int) $cfg['mostrar_seleccion_materias'] === 1),
            'horas_minimas_verde'        => $cfg === false ? 10 : (float) $cfg['horas_minimas_verde'],
        ],
        'profesores' => $profesores,
        'elegibles'  => (object) $elegibles,
    ]);
}

// -----------------------------------------------------------------------------
// PUT
// -----------------------------------------------------------------------------

$recurso = filter_input(INPUT_GET, 'recurso');
$body    = cuerpo_json();

// --- ?recurso=cuestionario: una o varias filas de materia_cuestionario -------
// Reemplaza los dos POST con Prefer: resolution=merge-duplicates (guardar una
// fila, y "marcar las restantes como revisadas"). Los dos mandan la misma
// forma; la única diferencia era objeto vs. arreglo.
if ($recurso === 'cuestionario') {
    $semestreId = param_id('semestre_id');
    $filas = isset($body['filas']) && is_array($body['filas']) ? $body['filas'] : [];
    if ($filas === []) {
        responder(['ok' => true, 'guardadas' => 0]);
    }

    $secciones = ['cobertura_departamental', 'catalogo_general', 'oculta'];

    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare(
            'INSERT INTO materia_cuestionario
                    (materia_id, semestre_id, seccion, alias_de_id, etiqueta, orden, revisado)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
                    seccion = VALUES(seccion), alias_de_id = VALUES(alias_de_id),
                    etiqueta = VALUES(etiqueta), orden = VALUES(orden),
                    revisado = VALUES(revisado)'
        );

        foreach ($filas as $f) {
            if (!is_array($f)) {
                $pdo->rollBack();
                error_json('Fila de configuración inválida', 400);
            }
            $materiaId = filter_var(isset($f['materia_id']) ? $f['materia_id'] : null, FILTER_VALIDATE_INT);
            if ($materiaId === false || $materiaId === null) {
                $pdo->rollBack();
                error_json('Falta materia_id en una de las filas', 400);
            }
            // Una por una y no un IN: la guardia tiene que correr por materia.
            $deptoMateria = departamento_de_materia((int) $materiaId);
            if ($deptoMateria === null) {
                $pdo->rollBack();
                error_json('No existe la materia ' . $materiaId, 404);
            }
            exigir_jefe_de($deptoMateria);

            $seccion = isset($f['seccion']) ? (string) $f['seccion'] : 'catalogo_general';
            if (!in_array($seccion, $secciones, true)) {
                $pdo->rollBack();
                error_json('Sección inválida', 400);
            }

            // Un alias solo tiene sentido en una materia oculta (chk_mc_alias_oculta).
            // Se limpia aquí y no solo en el cliente porque en MySQL < 8.0.16 el
            // CHECK se ignora en silencio y la fila entraría inconsistente.
            $alias = filter_var(isset($f['alias_de_id']) ? $f['alias_de_id'] : null, FILTER_VALIDATE_INT);
            if ($alias === false) {
                $alias = null;
            }
            if ($seccion !== 'oculta') {
                $alias = null;
            }
            if ($alias !== null && (int) $alias === (int) $materiaId) {
                $pdo->rollBack();
                error_json('Una materia no puede ser alias de sí misma', 400);
            }

            $orden = filter_var(isset($f['orden']) ? $f['orden'] : null, FILTER_VALIDATE_INT);
            if ($orden === false) {
                $orden = null;
            }

            $st->execute([
                (int) $materiaId,
                $semestreId,
                $seccion,
                $alias,
                texto_opcional($f, 'etiqueta'),
                $orden,
                empty($f['revisado']) ? 0 : 1,
            ]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fallo_interno('configuracion.php cuestionario', $e, 'No se pudo guardar la configuración');
    }

    responder(['ok' => true, 'guardadas' => count($filas)]);
}

// --- ?recurso=departamento: departamento_semestre_config ---------------------
if ($recurso === 'departamento') {
    $semestreId = param_id('semestre_id');
    // exigir_jefe_de ya corrió dentro de departamento_objetivo().

    $mostrar = empty($body['mostrar_seleccion_materias']) ? 0 : 1;
    $horas   = filter_var(
        isset($body['horas_minimas_verde']) ? $body['horas_minimas_verde'] : null,
        FILTER_VALIDATE_FLOAT
    );
    if ($horas === false || $horas === null || $horas < 0) {
        error_json('Las horas mínimas en verde deben ser un número mayor o igual que 0', 400, 'horas_invalidas');
    }

    $pdo->prepare(
        'INSERT INTO departamento_semestre_config
                (departamento_id, semestre_id, mostrar_seleccion_materias, horas_minimas_verde)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE
                mostrar_seleccion_materias = VALUES(mostrar_seleccion_materias),
                horas_minimas_verde = VALUES(horas_minimas_verde)'
    )->execute([$deptoId, $semestreId, $mostrar, $horas]);

    responder(['ok' => true]);
}

// --- ?recurso=modo_materias: RF15 -------------------------------------------
// Cambiar el modo y, en el mismo movimiento, dejar la lista personalizada
// coherente: al poner 'personalizada' se siembra con TODO el cuestionario
// (si se dejara vacía, esa persona abriría el formulario sin una sola materia
// y sin ninguna pista de por qué), y al salir de 'personalizada' se borra
// (si solo cambiara el modo, la lista quedaría latente y reaparecería la
// próxima vez que alguien la volviera a poner). Antes eran 2 o 3 peticiones
// sin transacción entre ellas.
if ($recurso === 'modo_materias') {
    $semestreId = param_id('semestre_id');
    $profesorId = filter_var(isset($body['profesor_id']) ? $body['profesor_id'] : null, FILTER_VALIDATE_INT);
    $modo       = isset($body['modo']) ? (string) $body['modo'] : '';
    if ($profesorId === false || $profesorId === null) {
        error_json('Falta profesor_id', 400);
    }
    if (!in_array($modo, ['todas', 'personalizada', 'ninguna'], true)) {
        error_json('Modo inválido', 400);
    }
    exigir_profesor_del_departamento($pdo, (int) $profesorId);

    $pdo->beginTransaction();
    try {
        // El UPDATE lista una sola columna: no hay forma de que por aquí se
        // cambie rol, departamento_id ni password_hash.
        $pdo->prepare('UPDATE profesor SET modo_materias_elegibles = ? WHERE id = ?')
            ->execute([$modo, (int) $profesorId]);

        if ($modo === 'personalizada') {
            $st = $pdo->prepare('SELECT COUNT(*) FROM profesor_materia_elegible WHERE profesor_id = ?');
            $st->execute([(int) $profesorId]);
            if ((int) $st->fetchColumn() === 0) {
                $ins = $pdo->prepare(
                    'INSERT IGNORE INTO profesor_materia_elegible (profesor_id, materia_id) VALUES (?, ?)'
                );
                foreach (materias_visibles($pdo, $deptoId, $semestreId) as $materiaId) {
                    $ins->execute([(int) $profesorId, $materiaId]);
                }
            }
        } else {
            $pdo->prepare('DELETE FROM profesor_materia_elegible WHERE profesor_id = ?')
                ->execute([(int) $profesorId]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fallo_interno('configuracion.php modo_materias', $e, 'No se pudo cambiar el modo');
    }

    // Se devuelve la lista resultante para que la pantalla no la adivine.
    $st = $pdo->prepare('SELECT materia_id FROM profesor_materia_elegible WHERE profesor_id = ?');
    $st->execute([(int) $profesorId]);
    responder([
        'ok'        => true,
        'modo'      => $modo,
        'elegibles' => array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)),
    ]);
}

// --- ?recurso=elegibles: reemplaza la lista personalizada completa -----------
// Un solo PUT con el conjunto final, en vez de un POST por materia marcada y un
// DELETE por materia desmarcada. La pantalla ya tiene el conjunto completo en
// memoria, así que mandarlo entero es más simple y además atómico.
if ($recurso === 'elegibles') {
    $profesorId = filter_var(isset($body['profesor_id']) ? $body['profesor_id'] : null, FILTER_VALIDATE_INT);
    if ($profesorId === false || $profesorId === null) {
        error_json('Falta profesor_id', 400);
    }
    exigir_profesor_del_departamento($pdo, (int) $profesorId);

    $ids = [];
    if (isset($body['materia_ids']) && is_array($body['materia_ids'])) {
        foreach ($body['materia_ids'] as $id) {
            $n = filter_var($id, FILTER_VALIDATE_INT);
            if ($n !== false && $n !== null) {
                $ids[(int) $n] = true;
            }
        }
    }

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM profesor_materia_elegible WHERE profesor_id = ?')
            ->execute([(int) $profesorId]);
        if ($ids !== []) {
            $ins = $pdo->prepare(
                'INSERT IGNORE INTO profesor_materia_elegible (profesor_id, materia_id) VALUES (?, ?)'
            );
            foreach (array_keys($ids) as $materiaId) {
                $ins->execute([(int) $profesorId, $materiaId]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fallo_interno('configuracion.php elegibles', $e, 'No se pudo guardar la lista');
    }

    responder(['ok' => true, 'elegibles' => array_keys($ids)]);
}

error_json('Recurso no soportado', 400);
