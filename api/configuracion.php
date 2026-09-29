<?php
// =============================================================================
// El editor del formulario (jefatura).
//
//   GET  ?semestre_id=N[&departamento_id=D]
//        -> { publicado, publicado_at, texto_introduccion, horas_minimas_verde,
//             secciones[], ocultas[], enviadas }
//
//   PUT  ?recurso=formulario&semestre_id=N[&departamento_id=D]
//        { texto_introduccion, horas_minimas_verde, secciones:[...], materias:[...] }
//        -> lo mismo que el GET, ya guardado
//
//   POST ?recurso=publicar&semestre_id=N[&departamento_id=D]   { publicado: bool }
//        -> { publicado, publicado_at }
//
// Desde 2026-09-28 el formulario es una lista ordenada de secciones que la
// jefatura edita en la misma vista que ve el profesor, y lo PUBLICA cuando está
// listo. El guardado es UN PUT con el formulario completo, en una transacción:
// la pantalla ya tiene todo en memoria y así nunca queda a medias.
//
// Ya no existen los recursos modo_materias / elegibles (lista personalizada por
// profesor): todos los de un departamento ven el mismo formulario. Tampoco
// cuestionario / departamento, que este PUT reemplaza.
//
// Políticas que reemplaza:
//   materia_cuestionario_escritura  -> exigir_jefe_de(departamento objetivo), y
//                                      cada materia tiene que ser de ese depto
//   departamento_config_escritura   -> exigir_jefe_de(departamento objetivo)
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET', 'PUT', 'POST');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$metodo     = metodo_http();
$deptoId    = departamento_objetivo();   // ya corrió exigir_jefe_de()
$semestreId = param_id('semestre_id');

/** El formulario completo más lo que el editor necesita para avisar. */
function vista_editor(PDO $pdo, int $deptoId, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT COUNT(*) FROM preferencia pref
           JOIN profesor p ON p.id = pref.profesor_id
          WHERE pref.semestre_id = ? AND p.departamento_id = ? AND pref.estado = \'enviado\''
    );
    $st->execute([$semestreId, $deptoId]);

    return array_merge(formulario_completo($pdo, $deptoId, $semestreId), [
        'enviadas' => (int) $st->fetchColumn(),
    ]);
}

// Escribir solo en el semestre activo; un semestre cerrado se puede ver en el
// editor pero no cambiar.
if ($metodo !== 'GET') {
    exigir_semestre_activo($pdo, $semestreId);
}

// Sembrar el formulario solo en el semestre activo: abrir el editor sobre uno
// cerrado es consulta y no debe crear nada.
$st = $pdo->prepare('SELECT estado FROM semestre WHERE id = ?');
$st->execute([$semestreId]);
if ($st->fetchColumn() === 'activo') {
    try {
        asegurar_formulario($pdo, $deptoId, $semestreId);
    } catch (Throwable $e) {
        fallo_interno('configuracion.php asegurar_formulario', $e, 'No se pudo preparar el formulario');
    }
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

if ($metodo === 'GET') {
    responder(vista_editor($pdo, $deptoId, $semestreId));
}

$recurso = filter_input(INPUT_GET, 'recurso');
$body    = cuerpo_json();

// -----------------------------------------------------------------------------
// POST ?recurso=publicar
// -----------------------------------------------------------------------------

if ($metodo === 'POST' && $recurso === 'publicar') {
    $publicar = !empty($body['publicado']);
    try {
        if ($publicar) {
            $pdo->prepare(
                'INSERT INTO departamento_semestre_config
                        (departamento_id, semestre_id, publicado, publicado_at, publicado_por)
                 VALUES (?,?,1,?,?)
                 ON DUPLICATE KEY UPDATE publicado = 1,
                        publicado_at = VALUES(publicado_at), publicado_por = VALUES(publicado_por)'
            )->execute([$deptoId, $semestreId, ahora_utc(), mi_id()]);
        } else {
            // publicado_at/por se conservan: dicen cuándo se abrió por última vez.
            $pdo->prepare(
                'UPDATE departamento_semestre_config SET publicado = 0
                  WHERE departamento_id = ? AND semestre_id = ?'
            )->execute([$deptoId, $semestreId]);
        }
    } catch (Throwable $e) {
        fallo_interno('configuracion.php publicar', $e, 'No se pudo cambiar la publicación');
    }
    $cfg = config_formulario($pdo, $deptoId, $semestreId);
    responder(['publicado' => $cfg['publicado'], 'publicado_at' => $cfg['publicado_at']]);
}

if ($metodo !== 'PUT' || $recurso !== 'formulario') {
    error_json('Recurso no soportado', 400);
}

// -----------------------------------------------------------------------------
// PUT ?recurso=formulario — validar todo antes de escribir nada
// -----------------------------------------------------------------------------

/** Entero >= 0, o null si viene vacío. Corta con 400 si viene algo raro. */
function entero_opcional($valor, string $que): ?int
{
    if ($valor === null || $valor === '') {
        return null;
    }
    $n = filter_var($valor, FILTER_VALIDATE_INT);
    if ($n === false || $n < 0) {
        error_json("$que debe ser un número entero mayor o igual que 0", 400);
    }
    return (int) $n;
}

$horas = filter_var(
    isset($body['horas_minimas_verde']) ? $body['horas_minimas_verde'] : null,
    FILTER_VALIDATE_FLOAT
);
if ($horas === false || $horas === null || $horas < 0 || $horas > 60) {
    error_json('Las horas mínimas en verde deben ser un número entre 0 y 60', 400, 'horas_invalidas');
}

$intro = isset($body['texto_introduccion']) ? trim((string) $body['texto_introduccion']) : '';
// Guardar el texto por defecto tal cual sería ruido: NULL significa "el de
// siempre", y así un cambio futuro al default le llega a quien no lo tocó.
$intro = ($intro === '' || $intro === TEXTO_INTRODUCCION_DEFAULT) ? null : $intro;

// --- Secciones ---------------------------------------------------------------

$st = $pdo->prepare(
    'SELECT id, tipo FROM cuestionario_seccion WHERE departamento_id = ? AND semestre_id = ?'
);
$st->execute([$deptoId, $semestreId]);
$tipoExistente = [];
foreach ($st->fetchAll() as $s) {
    $tipoExistente[(int) $s['id']] = $s['tipo'];
}

$entrada = isset($body['secciones']) && is_array($body['secciones']) ? $body['secciones'] : [];
$secciones = [];
$conteoTipo = ['num_cursos' => 0, 'disponibilidad' => 0];
$vistas = [];
foreach ($entrada as $s) {
    if (!is_array($s)) {
        error_json('Sección inválida', 400);
    }
    $id = filter_var(isset($s['id']) ? $s['id'] : null, FILTER_VALIDATE_INT);
    $id = ($id === false || $id === null) ? null : (int) $id;
    $tipo = isset($s['tipo']) ? (string) $s['tipo'] : '';
    if (!in_array($tipo, TIPOS_SECCION, true)) {
        error_json('Tipo de sección inválido', 400);
    }
    if ($id !== null) {
        // Una sección de otro depto/semestre, o de otro tipo, no se toca desde aquí.
        if (!isset($tipoExistente[$id]) || $tipoExistente[$id] !== $tipo) {
            error_json('Una de las secciones no pertenece a este formulario', 400);
        }
        if (isset($vistas[$id])) {
            error_json('Hay una sección repetida', 400);
        }
        $vistas[$id] = true;
    }
    $clave = isset($s['clave_temporal']) ? (string) $s['clave_temporal'] : '';
    if ($id === null && $clave === '') {
        error_json('Falta clave_temporal en una sección nueva', 400);
    }
    if (isset($conteoTipo[$tipo])) {
        $conteoTipo[$tipo]++;
    }

    $titulo = trim(isset($s['titulo']) ? (string) $s['titulo'] : '');
    if ($titulo === '') {
        error_json('Toda sección necesita un título', 400, 'titulo_vacio');
    }
    if (mb_strlen($titulo) > 255) {
        error_json('Un título es demasiado largo (máximo 255 caracteres)', 400);
    }
    $audiencia = isset($s['audiencia']) ? (string) $s['audiencia'] : 'todos';
    if (!in_array($audiencia, AUDIENCIAS, true)) {
        error_json('Audiencia inválida', 400);
    }
    // num_cursos y disponibilidad son para todos: sin ellos no hay qué asignar.
    if ($tipo === 'num_cursos' || $tipo === 'disponibilidad') {
        $audiencia = 'todos';
    }

    $secciones[] = [
        'id'          => $id,
        'clave'       => $clave,
        'tipo'        => $tipo,
        'titulo'      => $titulo,
        'descripcion' => texto_opcional($s, 'descripcion'),
        'audiencia'   => $audiencia,
        'minimo'      => $tipo === 'materias'
            ? entero_opcional(isset($s['minimo_verdes']) ? $s['minimo_verdes'] : null, 'El mínimo de verdes')
            : null,
        'cobertura'   => $tipo === 'materias' && !empty($s['cobertura_departamental']) ? 1 : 0,
        'obligatoria' => $tipo === 'abierta' && !empty($s['obligatoria']) ? 1 : 0,
    ];
}
if ($conteoTipo['num_cursos'] !== 1 || $conteoTipo['disponibilidad'] !== 1) {
    error_json(
        'El formulario debe tener exactamente una pregunta de número de cursos y una de disponibilidad',
        400,
        'secciones_fijas'
    );
}

// --- Materias ----------------------------------------------------------------

$st = $pdo->prepare('SELECT id FROM materia WHERE departamento_id = ?');
$st->execute([$deptoId]);
$materiasDelDepto = array_flip(array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)));

$tipoPorRef = [];
foreach ($secciones as $s) {
    $tipoPorRef[$s['id'] !== null ? 'id:' . $s['id'] : 'tmp:' . $s['clave']] = $s['tipo'];
}

// El alias ("nombre viejo de") NO se edita desde aquí: decisión del
// 2026-09-28, lo cambia un administrador directo en la base. Se conserva el que
// ya haya y se ignora lo que mande el cliente.
$st = $pdo->prepare(
    'SELECT mc.materia_id, mc.alias_de_id FROM materia_cuestionario mc
       JOIN materia m ON m.id = mc.materia_id
      WHERE mc.semestre_id = ? AND m.departamento_id = ? AND mc.alias_de_id IS NOT NULL'
);
$st->execute([$semestreId, $deptoId]);
$aliasActual = [];
foreach ($st->fetchAll() as $a) {
    $aliasActual[(int) $a['materia_id']] = (int) $a['alias_de_id'];
}

$materias = [];
$entrada = isset($body['materias']) && is_array($body['materias']) ? $body['materias'] : [];
foreach ($entrada as $m) {
    if (!is_array($m)) {
        error_json('Materia inválida', 400);
    }
    $materiaId = filter_var(isset($m['materia_id']) ? $m['materia_id'] : null, FILTER_VALIDATE_INT);
    if ($materiaId === false || $materiaId === null || !isset($materiasDelDepto[(int) $materiaId])) {
        error_json('Una de las materias no es de este departamento', 400);
    }
    $materiaId = (int) $materiaId;

    // `seccion` es el id de una sección existente, la clave_temporal de una
    // nueva, o null para ocultarla.
    $ref = null;
    if (isset($m['seccion']) && $m['seccion'] !== null && $m['seccion'] !== '') {
        $ref = is_int($m['seccion']) || ctype_digit((string) $m['seccion'])
            ? 'id:' . (int) $m['seccion']
            : 'tmp:' . (string) $m['seccion'];
        if (!isset($tipoPorRef[$ref]) || $tipoPorRef[$ref] !== 'materias') {
            error_json('Una materia apunta a una sección que no es de materias', 400);
        }
    }

    // chk_mc_alias_oculta: un alias solo tiene sentido en una materia oculta,
    // así que si la jefatura la pasa a una sección, el alias se limpia. Se
    // aplica aquí porque en MariaDB 5.5 el CHECK se ignora en silencio.
    $alias = ($ref === null && isset($aliasActual[$materiaId])) ? $aliasActual[$materiaId] : null;

    $etiqueta = texto_opcional($m, 'etiqueta');
    if ($etiqueta !== null && mb_strlen($etiqueta) > 255) {
        error_json('Un nombre de materia es demasiado largo (máximo 255 caracteres)', 400);
    }

    $materias[$materiaId] = [
        'ref'      => $ref,
        'alias'    => $alias,
        'etiqueta' => $etiqueta,
        'orden'    => entero_opcional(isset($m['orden']) ? $m['orden'] : null, 'El orden'),
        'revisado' => empty($m['revisado']) ? 0 : 1,
    ];
}

// -----------------------------------------------------------------------------
// Escribir, todo o nada
// -----------------------------------------------------------------------------

$pdo->beginTransaction();
try {
    $pdo->prepare(
        'INSERT INTO departamento_semestre_config
                (departamento_id, semestre_id, horas_minimas_verde, texto_introduccion)
         VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE horas_minimas_verde = VALUES(horas_minimas_verde),
                texto_introduccion = VALUES(texto_introduccion)'
    )->execute([$deptoId, $semestreId, $horas, $intro]);

    $upd = $pdo->prepare(
        'UPDATE cuestionario_seccion
            SET titulo = ?, descripcion = ?, audiencia = ?, minimo_verdes = ?,
                cobertura_departamental = ?, obligatoria = ?, orden = ?, activa = 1
          WHERE id = ? AND departamento_id = ? AND semestre_id = ?'
    );
    $ins = $pdo->prepare(
        'INSERT INTO cuestionario_seccion
                (departamento_id, semestre_id, tipo, titulo, descripcion, audiencia,
                 minimo_verdes, cobertura_departamental, obligatoria, orden)
         VALUES (?,?,?,?,?,?,?,?,?,?)'
    );

    $idPorRef = [];
    $orden = 1;
    foreach ($secciones as $s) {
        if ($s['id'] !== null) {
            $upd->execute([
                $s['titulo'], $s['descripcion'], $s['audiencia'], $s['minimo'],
                $s['cobertura'], $s['obligatoria'], $orden, $s['id'], $deptoId, $semestreId,
            ]);
            $idPorRef['id:' . $s['id']] = $s['id'];
        } else {
            $ins->execute([
                $deptoId, $semestreId, $s['tipo'], $s['titulo'], $s['descripcion'], $s['audiencia'],
                $s['minimo'], $s['cobertura'], $s['obligatoria'], $orden,
            ]);
            $idPorRef['tmp:' . $s['clave']] = (int) $pdo->lastInsertId();
        }
        $orden++;
    }

    // Lo que no vino, se borra en suave: puede tener respuestas colgando.
    $conservadas = array_values($idPorRef);
    $marcas = implode(',', array_fill(0, count($conservadas), '?'));
    $pdo->prepare(
        "UPDATE cuestionario_seccion SET activa = 0
          WHERE departamento_id = ? AND semestre_id = ? AND id NOT IN ($marcas)"
    )->execute(array_merge([$deptoId, $semestreId], $conservadas));

    $upsert = $pdo->prepare(
        'INSERT INTO materia_cuestionario
                (materia_id, semestre_id, seccion_id, alias_de_id, etiqueta, orden, revisado)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE seccion_id = VALUES(seccion_id), alias_de_id = VALUES(alias_de_id),
                etiqueta = VALUES(etiqueta), orden = VALUES(orden), revisado = VALUES(revisado)'
    );
    foreach ($materias as $materiaId => $m) {
        $upsert->execute([
            $materiaId,
            $semestreId,
            $m['ref'] === null ? null : $idPorRef[$m['ref']],
            $m['alias'],
            $m['etiqueta'],
            $m['orden'],
            $m['revisado'],
        ]);
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fallo_interno('configuracion.php formulario', $e, 'No se pudo guardar el formulario');
}

responder(vista_editor($pdo, $deptoId, $semestreId));
