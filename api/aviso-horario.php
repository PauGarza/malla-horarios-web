<?php
// =============================================================================
// El aviso de horarios a los profesores (2026-11-03): la pantalla de la jefatura.
// Los textos y el armado del correo están en lib/aviso.php.
//
//   GET ?semestre_id=N[&departamento_id=D]
//     -> { semestre, departamento, fechas, borrador, es_inicial, plantillas, campos,
//          perfil, remitente, profesores, cambios }
//   GET ?semestre_id=N&recurso=resumen
//     -> { cambios }: los cambios sin avisar, para el distintivo del inicio. Admin y la
//        jefatura de división reciben la suma de todos los departamentos.
//   GET ?semestre_id=N&recurso=horario&profesor_id=P
//     -> { clases, origen, avisado_at }: lo que vería en su perfil.
//   GET ?semestre_id=N&recurso=envio&envio_id=E
//     -> la copia exacta de un correo enviado.
//
//   POST ?semestre_id=N[&departamento_id=D]
//     { accion: 'guardar_fechas', inicio, bajas, fin, examenes_inicio, examenes_fin }
//         Las fechas son del semestre, no del departamento (decisión de la usuaria):
//         cualquier rol de gestión las corrige y aplica para todos.
//     { accion: 'guardar', borrador }
//     { accion: 'vista_previa', borrador, profesor_id, perfil_excluidos }: no guarda nada.
//     { accion: 'prueba', borrador, profesor_id, para, perfil_excluidos }: va solo a
//         `para`, sin copias. perfil_excluidos es la selección en pantalla, aún sin
//         guardar; enviar usa la guardada.
//     { accion: 'enviar', profesor_id, reenviar? }: un profesor, con el borrador
//         guardado. El navegador recorre la lista para que un envío largo no se corte
//         en el proxy ni en PHP. 409 'ya_avisado' si ya recibió este mismo horario,
//         salvo que venga reenviar.
//     { accion: 'marcar_avisado', profesor_id }: quita la alerta sin mandar correo.
//     { accion: 'perfil_activo', activo, excluidos }: enciende o apaga Mi horario en el
//         perfil, para todo el departamento menos los ids de `excluidos`.
//
// Autorización: ROLES_GESTION, cada jefe en su departamento. La jefatura de división
// revisa la información de cualquier departamento, pero quienes hacen las acciones son
// los jefes (decisión de la usuaria, 2026-11-03): solo puede leer y ver el ejemplo.
// Los destinatarios salen siempre de la base y de ese departamento, nunca del cuerpo.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';
require_once __DIR__ . '/lib/aviso.php';

exigir_metodo('GET', 'POST');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$semestreId = param_id('semestre_id');

$st = $pdo->prepare('SELECT id, tipo, anio, estado FROM semestre WHERE id = ?');
$st->execute([$semestreId]);
$semestre = $st->fetch();
if (!$semestre) {
    error_json('No existe ese semestre', 404);
}

$recurso = (string) filter_input(INPUT_GET, 'recurso');

if (metodo_http() === 'GET' && $recurso === 'resumen') {
    aviso_get_resumen($pdo, $semestreId);
}

// La jefatura de división no pasa por departamento_objetivo(), que la acota al suyo.
$deptoId = departamento_objetivo_aviso();
$st = $pdo->prepare('SELECT id, nombre, clave_prefijo FROM departamento WHERE id = ?');
$st->execute([$deptoId]);
$departamento = $st->fetch();
if (!$departamento) {
    error_json('No existe ese departamento', 404);
}

if (metodo_http() === 'GET') {
    if ($recurso === 'horario') {
        aviso_get_horario($pdo, $semestreId, $deptoId);
    }
    if ($recurso === 'envio') {
        aviso_get_envio($pdo, $semestreId, $deptoId);
    }
    aviso_get($pdo, $semestre, $departamento);
}

$body   = cuerpo_json();
$accion = (string) ($body['accion'] ?? '');

if ($accion === 'vista_previa') {
    aviso_post_vista_previa($pdo, $semestre, $departamento, $body);
}

if (mi_rol() === 'jefe_division') {
    error_json('La jefatura de división consulta esta vista: las acciones las hacen los jefes de departamento', 403, 'solo_consulta');
}

exigir_semestre_activo($pdo, $semestreId);

switch ($accion) {
    case 'guardar_fechas':
        aviso_post_fechas($pdo, $semestreId, $body);
        break;
    case 'guardar':
        aviso_post_guardar($pdo, $semestreId, $deptoId, $body);
        break;
    case 'prueba':
        aviso_post_prueba($pdo, $semestre, $departamento, $body);
        break;
    case 'enviar':
        aviso_post_enviar($pdo, $semestre, $departamento, $body);
        break;
    case 'marcar_avisado':
        aviso_post_marcar($pdo, $semestreId, $deptoId, $body);
        break;
    case 'perfil_activo':
        aviso_post_perfil($pdo, $semestreId, $deptoId, $body);
        break;
}
error_json('Acción no reconocida', 400);

// -----------------------------------------------------------------------------

/** El departamento que se pide: la jefatura de división puede ver cualquiera. */
function departamento_objetivo_aviso(): int
{
    if (mi_rol() !== 'jefe_division') {
        return departamento_objetivo();
    }
    $pedido = filter_input(INPUT_GET, 'departamento_id', FILTER_VALIDATE_INT);
    $depto = ($pedido === false || $pedido === null) ? mi_departamento() : (int) $pedido;
    if ($depto === null) {
        error_json('Falta departamento_id', 400);
    }
    return $depto;
}

/** Los profesores a los que se les puede avisar desde este departamento. */
function aviso_profesores(PDO $pdo, int $deptoId): array
{
    $st = $pdo->prepare(
        'SELECT id, nombre, correo, tipo_contrato FROM profesor
          WHERE departamento_id = ? AND activo = 1 AND tipo_contrato IS NOT NULL AND por_asignar = 0
          ORDER BY nombre, id'
    );
    $st->execute([$deptoId]);
    return $st->fetchAll();
}

/** Un profesor de este departamento, o corta con 404. */
function aviso_profesor(PDO $pdo, int $deptoId, $id): array
{
    $id = filter_var($id, FILTER_VALIDATE_INT);
    if ($id === false || $id < 1) {
        error_json('Falta profesor_id', 400);
    }
    $st = $pdo->prepare(
        'SELECT id, nombre, correo, tipo_contrato FROM profesor
          WHERE id = ? AND departamento_id = ? AND activo = 1 AND tipo_contrato IS NOT NULL AND por_asignar = 0'
    );
    $st->execute([$id, $deptoId]);
    $p = $st->fetch();
    if (!$p) {
        error_json('Ese profesor no está en este departamento', 404);
    }
    return $p;
}

/**
 * Compara el horario actual con su último aviso:
 * 'sin_avisar', 'avisado', 'cambio' o 'sin_clases' (se le avisó y ya no tiene clases).
 */
function aviso_estado(array $clases, ?array $ultimo): string
{
    if ($ultimo === null) {
        return 'sin_avisar';
    }
    if ($ultimo['huella'] === aviso_huella($clases)) {
        return 'avisado';
    }
    return $clases === [] ? 'sin_clases' : 'cambio';
}

/** Los profesores de estas listas con su estado, y cuántos tienen cambios sin avisar. */
function aviso_contar_cambios(array $profesores, array $clases, array $ultimos): int
{
    $n = 0;
    foreach ($profesores as $p) {
        $id = (int) $p['id'];
        $estado = aviso_estado($clases[$id] ?? [], $ultimos[$id] ?? null);
        if ($estado === 'cambio' || $estado === 'sin_clases') {
            $n++;
        }
    }
    return $n;
}

function aviso_get_resumen(PDO $pdo, int $semestreId): void
{
    if (ve_malla_de_toda_la_division() && filter_input(INPUT_GET, 'departamento_id') === null) {
        $deptos = array_map('intval', $pdo->query('SELECT id FROM departamento')->fetchAll(PDO::FETCH_COLUMN));
    } else {
        $deptos = [departamento_objetivo()];
    }
    $profesores = [];
    foreach ($deptos as $d) {
        $profesores = array_merge($profesores, aviso_profesores($pdo, $d));
    }
    $ultimos = aviso_ultimos_avisos($pdo, $semestreId, array_map('intval', array_column($profesores, 'id')));
    // Sin avisos todavía no hay nada que comparar: se ahorra armar las clases.
    if ($ultimos === []) {
        responder(['cambios' => 0]);
    }
    responder(['cambios' => aviso_contar_cambios($profesores, aviso_clases($pdo, $semestreId), $ultimos)]);
}

function aviso_get(PDO $pdo, array $semestre, array $departamento): void
{
    $semestreId = (int) $semestre['id'];
    $deptoId    = (int) $departamento['id'];

    $st = $pdo->prepare(
        'SELECT a.datos, a.perfil_activo, a.perfil_excluidos, a.perfil_at, p.nombre AS perfil_por
           FROM aviso_horario a LEFT JOIN profesor p ON p.id = a.perfil_por
          WHERE a.semestre_id = ? AND a.departamento_id = ?'
    );
    $st->execute([$semestreId, $deptoId]);
    $fila = $st->fetch();

    $borrador = $fila && $fila['datos'] !== null ? json_decode((string) $fila['datos'], true) : null;
    $esInicial = !is_array($borrador);
    if ($esInicial) {
        $borrador = aviso_borrador_inicial($semestre, $departamento);
    } else {
        foreach ($borrador['versiones'] as &$v) {
            $v['cuerpo'] = aviso_frase_a_campo((string) $v['cuerpo']);
        }
        unset($v);
        // Vacío o de un borrador anterior al campo: se muestra el jefe del departamento.
        if (empty($borrador['respuestas_a'])) {
            $borrador['respuestas_a'] = aviso_jefe($departamento) ?? '';
        }
    }

    $profesores = aviso_profesores($pdo, $deptoId);
    $ids = array_map('intval', array_column($profesores, 'id'));
    $clases = aviso_clases($pdo, $semestreId);
    $ultimos = aviso_ultimos_avisos($pdo, $semestreId, $ids);

    // El último intento de cada uno, para decir si falló y qué copia se puede abrir.
    $intentos = [];
    if ($ids !== []) {
        $st = $pdo->prepare(
            'SELECT id, profesor_id, estado FROM aviso_horario_envio
              WHERE semestre_id = ? AND profesor_id IN (' . motor_marcas($ids) . ') ORDER BY id'
        );
        $st->execute(array_merge([$semestreId], $ids));
        foreach ($st->fetchAll() as $f) {
            $pid = (int) $f['profesor_id'];
            $intentos[$pid]['ultimo'] = $f['estado'];
            if ($f['estado'] === 'enviado') {
                $intentos[$pid]['envio_id'] = (int) $f['id'];
            }
        }
    }

    $lista = [];
    $cambios = 0;
    foreach ($profesores as $p) {
        $id = (int) $p['id'];
        $actuales = $clases[$id] ?? [];
        $ultimo = $ultimos[$id] ?? null;
        $estado = aviso_estado($actuales, $ultimo);
        $hayCambio = $estado === 'cambio' || $estado === 'sin_clases';
        if ($hayCambio) {
            $cambios++;
        }
        $sinHorario = 0;
        foreach ($actuales as $c) {
            if ($c['sesiones'] === []) {
                $sinHorario++;
            }
        }
        $lista[] = [
            'id'            => $id,
            'nombre'        => aviso_nombre((string) $p['nombre']),
            'correo'        => $p['correo'],
            'tipo_contrato' => $p['tipo_contrato'],
            'n_clases'      => count($actuales),
            'sin_horario'   => $sinHorario,
            'estado'        => $estado,
            'avisado_at'    => $ultimo === null ? null : motor_hora_local($ultimo['creado_at']),
            'marcado'       => $ultimo !== null && $ultimo['estado'] === 'marcado',
            'envio_id'      => $intentos[$id]['envio_id'] ?? null,
            'fallo'         => ($intentos[$id]['ultimo'] ?? null) === 'error',
            'antes'         => $hayCambio ? json_decode((string) $ultimo['clases'], true) : null,
            'ahora'         => $hayCambio ? $actuales : null,
        ];
    }

    $perfilNombre = $fila && $fila['perfil_por'] !== null ? aviso_nombre((string) $fila['perfil_por']) : null;
    responder([
        'semestre'     => ['id' => $semestreId, 'tipo' => $semestre['tipo'], 'anio' => (int) $semestre['anio'], 'activo' => $semestre['estado'] === 'activo'],
        'departamento' => ['id' => $deptoId, 'nombre' => $departamento['nombre'], 'clave_prefijo' => $departamento['clave_prefijo']],
        'fechas'       => aviso_leer_fechas($pdo, $semestreId),
        'borrador'     => $borrador,
        'es_inicial'   => $esInicial,
        'plantillas'   => aviso_plantillas(),
        'campos'       => aviso_campos(),
        'perfil'       => [
            'activo'    => $fila && (int) $fila['perfil_activo'] === 1,
            'excluidos' => $fila && $fila['perfil_excluidos'] !== null
                ? (json_decode((string) $fila['perfil_excluidos'], true) ?: [])
                : [],
            'por'       => $perfilNombre,
            'at'        => $fila ? motor_hora_local($fila['perfil_at']) : null,
        ],
        'remitente'    => [
            'nombre' => aviso_nombre_remitente($departamento),
            'correo' => aviso_correo_remitente($departamento),
        ],
        'profesores'   => $lista,
        'cambios'      => $cambios,
    ]);
}

/**
 * Lo que vería un profesor en su perfil: su último aviso o, si aún no se le envía,
 * la malla actual, con origen 'malla' para que la pantalla lo aclare.
 */
function aviso_get_horario(PDO $pdo, int $semestreId, int $deptoId): void
{
    $p = aviso_profesor($pdo, $deptoId, filter_input(INPUT_GET, 'profesor_id'));
    $id = (int) $p['id'];
    $ultimo = aviso_ultimos_avisos($pdo, $semestreId, [$id])[$id] ?? null;
    if ($ultimo !== null) {
        responder([
            'nombre'     => aviso_nombre((string) $p['nombre']),
            'clases'     => json_decode((string) $ultimo['clases'], true),
            'origen'     => 'aviso',
            'avisado_at' => motor_hora_local($ultimo['creado_at']),
        ]);
    }
    responder([
        'nombre'     => aviso_nombre((string) $p['nombre']),
        'clases'     => aviso_clases($pdo, $semestreId)[$id] ?? [],
        'origen'     => 'malla',
        'avisado_at' => null,
    ]);
}

function aviso_get_envio(PDO $pdo, int $semestreId, int $deptoId): void
{
    $st = $pdo->prepare(
        "SELECT correo, copias, responder_a, asunto, html, creado_at FROM aviso_horario_envio
          WHERE id = ? AND semestre_id = ? AND departamento_id = ? AND estado = 'enviado'"
    );
    $st->execute([param_id('envio_id'), $semestreId, $deptoId]);
    $f = $st->fetch();
    if (!$f) {
        error_json('No se encontró ese envío', 404);
    }
    $f['creado_at'] = motor_hora_local($f['creado_at']);
    responder($f);
}

function aviso_post_fechas(PDO $pdo, int $semestreId, array $body): void
{
    $f = [
        'inicio'          => aviso_fecha_valida($body['inicio'] ?? null, 'inicio del semestre'),
        'bajas'           => aviso_fecha_valida($body['bajas'] ?? null, 'límite de bajas'),
        'fin'             => aviso_fecha_valida($body['fin'] ?? null, 'fin del semestre'),
        'examenes_inicio' => aviso_fecha_valida($body['examenes_inicio'] ?? null, 'inicio de exámenes'),
        'examenes_fin'    => aviso_fecha_valida($body['examenes_fin'] ?? null, 'fin de exámenes'),
    ];
    aviso_validar_orden_fechas($f);
    $st = $pdo->prepare(
        'INSERT INTO semestre_fechas
            (semestre_id, inicio, bajas, fin, examenes_inicio, examenes_fin, actualizado_por, actualizado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE inicio = VALUES(inicio), bajas = VALUES(bajas), fin = VALUES(fin),
            examenes_inicio = VALUES(examenes_inicio), examenes_fin = VALUES(examenes_fin),
            actualizado_por = VALUES(actualizado_por), actualizado_at = VALUES(actualizado_at)'
    );
    $st->execute([$semestreId, $f['inicio'], $f['bajas'], $f['fin'], $f['examenes_inicio'], $f['examenes_fin'], mi_id(), ahora_utc()]);
    responder(['fechas' => aviso_leer_fechas($pdo, $semestreId)]);
}

function aviso_post_guardar(PDO $pdo, int $semestreId, int $deptoId, array $body): void
{
    $borrador = aviso_normalizar_borrador($body['borrador'] ?? null);
    // Sin tocar perfil_activo: guardar el texto no enciende ni apaga la vista.
    $st = $pdo->prepare(
        'INSERT INTO aviso_horario (semestre_id, departamento_id, datos, guardado_por, guardado_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE datos = VALUES(datos), guardado_por = VALUES(guardado_por), guardado_at = VALUES(guardado_at)'
    );
    $st->execute([$semestreId, $deptoId, json_encode($borrador, JSON_UNESCAPED_UNICODE), mi_id(), ahora_utc()]);
    responder(['borrador' => $borrador]);
}

/**
 * Lo que comparten la vista previa, la prueba y el envío: arma el correo de un
 * profesor. Si no se puede armar devuelve ['motivo' => texto].
 */
function aviso_preparar(PDO $pdo, array $semestre, array $departamento, array $borrador, array $profesor, array $excluidos): array
{
    $semestreId = (int) $semestre['id'];
    $id = (int) $profesor['id'];
    $version = aviso_version_de($borrador, $profesor['tipo_contrato']);
    if ($version === null) {
        return ['motivo' => 'Su tipo de profesor no está en ninguna versión del correo.'];
    }
    $clases = aviso_clases($pdo, $semestreId)[$id] ?? [];
    if ($clases === []) {
        return ['motivo' => 'No tiene clases asignadas en la malla actual.'];
    }
    $ultimo = aviso_ultimos_avisos($pdo, $semestreId, [$id])[$id] ?? null;
    $huella = aviso_huella($clases);
    $esActualizacion = $ultimo !== null && $ultimo['huella'] !== $huella;
    $ctx = [
        'borrador'     => $borrador,
        'departamento' => $departamento,
        'fechas'       => aviso_leer_fechas($pdo, $semestreId),
        'perfil_excluidos' => $excluidos,
    ];
    return [
        'version'  => $version,
        'clases'   => $clases,
        'huella'   => $huella,
        'ultimo'   => $ultimo,
        'correo'   => aviso_armar_correo($ctx, $version, $profesor, $clases, $esActualizacion),
        'actualiza' => $esActualizacion,
    ];
}

/** Los desmarcados de la pantalla, aún sin guardar; si no vienen, los guardados. */
function aviso_excluidos_del_cuerpo(PDO $pdo, int $semestreId, int $deptoId, array $body): array
{
    if (is_array($body['perfil_excluidos'] ?? null)) {
        return array_map('intval', array_filter($body['perfil_excluidos'], 'is_numeric'));
    }
    return aviso_leer_excluidos($pdo, $semestreId, $deptoId);
}

function aviso_post_vista_previa(PDO $pdo, array $semestre, array $departamento, array $body): void
{
    $borrador = aviso_normalizar_borrador($body['borrador'] ?? null, false);
    $profesor = aviso_profesor($pdo, (int) $departamento['id'], $body['profesor_id'] ?? null);
    $excluidos = aviso_excluidos_del_cuerpo($pdo, (int) $semestre['id'], (int) $departamento['id'], $body);
    $preparado = aviso_preparar($pdo, $semestre, $departamento, $borrador, $profesor, $excluidos);
    if (isset($preparado['motivo'])) {
        responder(['motivo' => $preparado['motivo']]);
    }
    if (empty($profesor['correo'])) {
        responder(['motivo' => 'No tiene correo registrado: no se le puede enviar el aviso.']);
    }
    $correo = $preparado['correo'];
    $copias = aviso_copias_validas($borrador['copias']);
    responder([
        'version'     => $preparado['version']['nombre'],
        'de'          => aviso_nombre_remitente($departamento) . ' <' . aviso_correo_remitente($departamento) . '>',
        'para'        => $profesor['correo'],
        'cc'          => $copias,
        'responder_a' => aviso_responder_a($departamento, $borrador, $copias),
        'asunto'      => $correo['asunto'],
        'html'        => $correo['html'],
        'faltan'      => $correo['faltan'],
        'sin_lista'   => $correo['sin_lista'],
        'actualiza'   => $preparado['actualiza'],
    ]);
}

function aviso_post_prueba(PDO $pdo, array $semestre, array $departamento, array $body): void
{
    $para = normalizar_correo($body['para'] ?? '');
    $borrador = aviso_normalizar_borrador($body['borrador'] ?? null, false);
    $profesor = aviso_profesor($pdo, (int) $departamento['id'], $body['profesor_id'] ?? null);
    $excluidos = aviso_excluidos_del_cuerpo($pdo, (int) $semestre['id'], (int) $departamento['id'], $body);
    $preparado = aviso_preparar($pdo, $semestre, $departamento, $borrador, $profesor, $excluidos);
    if (isset($preparado['motivo'])) {
        error_json($preparado['motivo'], 409, 'sin_correo_que_armar');
    }
    $correo = $preparado['correo'];
    $problema = aviso_problema_de_correo($correo);
    if ($problema !== null) {
        error_json($problema, 409, 'faltan_datos');
    }
    $ok = enviar_correo_html($para, '[PRUEBA] ' . $correo['asunto'], $correo['html'], $correo['texto'], [
        'nombre'      => aviso_nombre_remitente($departamento),
        'remitente'   => aviso_correo_remitente($departamento),
        'responder_a' => aviso_responder_a($departamento, $borrador, aviso_copias_validas($borrador['copias'])),
    ]);
    if (!$ok) {
        error_json('El servidor no pudo mandar el correo de prueba', 502, 'correo_fallo');
    }
    responder(['ok' => true, 'para' => $para]);
}

function aviso_post_enviar(PDO $pdo, array $semestre, array $departamento, array $body): void
{
    $semestreId = (int) $semestre['id'];
    $deptoId = (int) $departamento['id'];

    $st = $pdo->prepare('SELECT datos FROM aviso_horario WHERE semestre_id = ? AND departamento_id = ?');
    $st->execute([$semestreId, $deptoId]);
    $borrador = json_decode((string) $st->fetchColumn(), true);
    if (!is_array($borrador)) {
        error_json('Guarda el borrador antes de enviar', 409, 'sin_borrador');
    }
    // Lo guardado ya pasó por la limpieza, pero las copias van a las cabeceras: se
    // vuelven a validar aquí.
    $borrador = aviso_normalizar_borrador($borrador);

    $profesor = aviso_profesor($pdo, $deptoId, $body['profesor_id'] ?? null);
    if (empty($profesor['correo'])) {
        error_json('Ese profesor no tiene correo registrado', 409, 'sin_correo');
    }
    $preparado = aviso_preparar($pdo, $semestre, $departamento, $borrador, $profesor, aviso_leer_excluidos($pdo, $semestreId, $deptoId));
    if (isset($preparado['motivo'])) {
        error_json($preparado['motivo'], 409, 'sin_correo_que_armar');
    }
    $correo = $preparado['correo'];
    $problema = aviso_problema_de_correo($correo);
    if ($problema !== null) {
        error_json($problema, 409, 'faltan_datos');
    }
    if ($preparado['ultimo'] !== null && !$preparado['actualiza'] && empty($body['reenviar'])) {
        error_json('Ya había recibido este mismo horario', 409, 'ya_avisado');
    }

    $copias = aviso_parsear_copias($borrador['copias']);
    $para = normalizar_correo($profesor['correo']);
    $responderA = aviso_responder_a($departamento, $borrador, $copias);
    $ok = enviar_correo_html($para, $correo['asunto'], $correo['html'], $correo['texto'], [
        'nombre'      => aviso_nombre_remitente($departamento),
        'remitente'   => aviso_correo_remitente($departamento),
        'copias'      => $copias,
        'responder_a' => $responderA,
    ]);

    $st = $pdo->prepare(
        'INSERT INTO aviso_horario_envio
            (semestre_id, departamento_id, profesor_id, estado, es_actualizacion, version_nombre, correo, copias,
             responder_a, asunto, html, clases, huella, error, creado_por, creado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $st->execute([
        $semestreId, $deptoId, (int) $profesor['id'], $ok ? 'enviado' : 'error', $preparado['actualiza'] ? 1 : 0,
        $preparado['version']['nombre'], $para, implode(', ', $copias), $responderA,
        mb_substr($correo['asunto'], 0, 300), $correo['html'], json_encode($preparado['clases'], JSON_UNESCAPED_UNICODE),
        $preparado['huella'], $ok ? null : 'El servidor no pudo mandar el correo', mi_id(), ahora_utc(),
    ]);
    if (!$ok) {
        error_json('El servidor no pudo mandar el correo', 502, 'correo_fallo');
    }
    responder(['ok' => true, 'profesor_id' => (int) $profesor['id'], 'actualiza' => $preparado['actualiza']]);
}

function aviso_post_marcar(PDO $pdo, int $semestreId, int $deptoId, array $body): void
{
    $profesor = aviso_profesor($pdo, $deptoId, $body['profesor_id'] ?? null);
    $id = (int) $profesor['id'];
    $clases = aviso_clases($pdo, $semestreId)[$id] ?? [];
    $ultimo = aviso_ultimos_avisos($pdo, $semestreId, [$id])[$id] ?? null;
    $estado = aviso_estado($clases, $ultimo);
    if ($estado !== 'cambio' && $estado !== 'sin_clases') {
        error_json('Ese profesor no tiene cambios sin avisar', 409, 'sin_cambios');
    }
    $st = $pdo->prepare(
        "INSERT INTO aviso_horario_envio
            (semestre_id, departamento_id, profesor_id, estado, clases, huella, creado_por, creado_at)
         VALUES (?, ?, ?, 'marcado', ?, ?, ?, ?)"
    );
    $st->execute([$semestreId, $deptoId, $id, json_encode($clases, JSON_UNESCAPED_UNICODE), aviso_huella($clases), mi_id(), ahora_utc()]);
    responder(['ok' => true]);
}

function aviso_post_perfil(PDO $pdo, int $semestreId, int $deptoId, array $body): void
{
    if (!array_key_exists('activo', $body) || !is_bool($body['activo'])) {
        error_json('Falta activo', 400);
    }
    if (!is_array($body['excluidos'] ?? null)) {
        error_json('Falta excluidos', 400);
    }
    // Solo profesores de este departamento: los demás ids no significan nada aquí.
    $delDepartamento = array_map('intval', array_column(aviso_profesores($pdo, $deptoId), 'id'));
    $excluidos = array_values(array_intersect($delDepartamento, $body['excluidos']));
    $st = $pdo->prepare(
        'INSERT INTO aviso_horario (semestre_id, departamento_id, perfil_activo, perfil_excluidos, perfil_por, perfil_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE perfil_activo = VALUES(perfil_activo), perfil_excluidos = VALUES(perfil_excluidos),
            perfil_por = VALUES(perfil_por), perfil_at = VALUES(perfil_at)'
    );
    $st->execute([$semestreId, $deptoId, $body['activo'] ? 1 : 0, json_encode($excluidos), mi_id(), ahora_utc()]);
    responder(['activo' => $body['activo'], 'excluidos' => $excluidos]);
}
