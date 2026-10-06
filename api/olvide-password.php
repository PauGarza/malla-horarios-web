<?php
// =============================================================================
// POST { correo } -> { ok: true }
//
// "Olvidé mi contraseña" (2026-10-02). Si el correo es de una cuenta activa,
// le manda un enlace de un solo uso que vale una hora; restablecer-password.php
// lo canjea. Sin sesión previa, igual que login.php: no llama a sesion().
//
// La respuesta es SIEMPRE la misma, exista o no la cuenta: decir "ese correo no
// está registrado" convertiría esto en un buscador de correos de profesores.
// Por lo mismo, el correo se manda DESPUÉS de responder (fastcgi_finish_request):
// si se mandara antes, lo que tarda el servidor SMTP delataría que sí existe.
//
// El token viaja en el #fragmento del enlace y no en ?query: el fragmento no
// se manda al servidor, así que no queda en los logs de nginx ni en un Referer.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/rate-limit.php';
require_once __DIR__ . '/lib/correo.php';

exigir_metodo('POST');

const VIGENCIA_SEGUNDOS = 60 * 60;
// Por IP frena a quien pruebe muchos correos; por correo, que alguien llene el
// buzón de un profesor pidiendo enlaces.
const RL_MAX_OLVIDE_IP     = 5;
const RL_MAX_OLVIDE_CORREO = 3;

// Misma lectura de la IP que registro.php (ver el comentario allá).
$ip = isset($_SERVER['HTTP_X_FORWARDED_FOR'])
    ? trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0])
    : (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
$llaveIp = 'olvide-ip:' . $ip;
exigir_bajo_limite($llaveIp, RL_MAX_OLVIDE_IP);

$body   = cuerpo_json();
$correo = normalizar_correo(isset($body['correo']) ? $body['correo'] : '');

// intento_login.llave es VARCHAR(64) y un correo puede pasar de eso: se usa su
// hash. Tampoco conviene dejar correos en claro en una tabla de rate limiting.
$llaveCorreo = 'olvide-c:' . sha1($correo);
exigir_bajo_limite($llaveCorreo, RL_MAX_OLVIDE_CORREO);

// Toda solicitud cuenta, exista o no la cuenta: aquí se frena el volumen.
registrar_intento($llaveIp);
registrar_intento($llaveCorreo);

$pdo = db();
$st  = $pdo->prepare('SELECT id, nombre FROM profesor WHERE correo = ? AND activo = 1');
$st->execute([$correo]);
$cuenta = $st->fetch();

$enlace = null;
if ($cuenta) {
    $token = bin2hex(random_bytes(32));
    $ahora = time();
    try {
        $pdo->beginTransaction();
        // Un enlace vivo por cuenta: pedir otro invalida el anterior. De paso
        // se barren los vencidos de todos, para que la tabla no crezca sola.
        $pdo->prepare('DELETE FROM recuperacion_password WHERE profesor_id = ? OR expira_at < ?')
            ->execute([(int) $cuenta['id'], gmdate('Y-m-d H:i:s', $ahora)]);
        $pdo->prepare(
            'INSERT INTO recuperacion_password (profesor_id, token_hash, creado_at, expira_at)
             VALUES (?, ?, ?, ?)'
        )->execute([
            (int) $cuenta['id'],
            hash('sha256', $token),
            gmdate('Y-m-d H:i:s', $ahora),
            gmdate('Y-m-d H:i:s', $ahora + VIGENCIA_SEGUNDOS),
        ]);
        $pdo->commit();
        $enlace = rtrim((string) config_o('url_publica', 'https://horariosdace.itam.mx'), '/')
            . '/#restablecer=' . $token;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        // Se registra y se responde igual que siempre: un 500 aquí sí diría
        // que la cuenta existe.
        error_log('olvide-password.php: ' . $e->getMessage());
    }
}

// Responder ya, y mandar el correo después (ver el encabezado).
http_response_code(200);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => true]);
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}

if ($enlace !== null) {
    $texto = "Hola, {$cuenta['nombre']}:\n\n"
        . "Alguien (esperamos que tú) pidió restablecer tu contraseña de Malla Horarios,\n"
        . "el sistema de preferencias de horario de la División de Ciencias Exactas del ITAM.\n\n"
        . "Para elegir una contraseña nueva, abre este enlace:\n\n"
        . "$enlace\n\n"
        . "El enlace sirve una sola vez y vence en una hora.\n\n"
        . "Si no lo pediste tú, ignora este correo: tu contraseña no cambia.\n";
    enviar_correo($correo, 'Restablecer tu contraseña — Malla Horarios', $texto);
}
exit;
