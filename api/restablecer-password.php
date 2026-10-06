<?php
// =============================================================================
// POST { token, password_nueva } -> { ok: true, cu }
//
// Canjea el enlace que mandó olvide-password.php. Sin sesión previa: quien
// llega aquí es justo quien no puede entrar. El token es la credencial; vale
// una hora y una sola vez.
//
// Mismas reglas de contraseña que cambiar-password.php y registro.php, menos
// "igual a la actual": la actual es la que se olvidó, y no se compara contra
// el hash a propósito para no tener un tercer lugar que lea password_hash.
//
// Devuelve el cu para que la pantalla pueda entrar de una vez con la nueva.
// Los tokens de sesión ya emitidos siguen valiendo, igual que al cambiarla.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/rate-limit.php';

exigir_metodo('POST');

const MIN_LARGO = 6;
const MAX_BYTES = 72;   // bcrypt ignora en silencio lo que pase de 72 bytes.
const COSTO     = 10;
const RL_MAX_RESTABLECER = 8;

// Adivinar un token de 256 bits no es factible; el límite es para que nadie
// use este endpoint para martillar la base.
$ip = isset($_SERVER['HTTP_X_FORWARDED_FOR'])
    ? trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0])
    : (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
$llave = 'restablecer:' . $ip;
exigir_bajo_limite($llave, RL_MAX_RESTABLECER);

$body  = cuerpo_json();
$token = trim((string) (isset($body['token']) ? $body['token'] : ''));
$nueva = (string) (isset($body['password_nueva']) ? $body['password_nueva'] : '');
if ($token === '' || $nueva === '') {
    error_json('Faltan el enlace y la nueva contraseña', 400);
}

$invalido = 'El enlace no es válido o ya venció. Pide uno nuevo.';
if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
    registrar_intento($llave);
    error_json($invalido, 400, 'token_invalido');
}

$pdo = db();
$st  = $pdo->prepare(
    'SELECT r.id, r.profesor_id, p.cu
       FROM recuperacion_password r
       JOIN profesor p ON p.id = r.profesor_id
      WHERE r.token_hash = ? AND r.usado_at IS NULL AND r.expira_at >= ? AND p.activo = 1'
);
$st->execute([hash('sha256', $token), ahora_utc()]);
$fila = $st->fetch();
if (!$fila) {
    registrar_intento($llave);
    error_json($invalido, 400, 'token_invalido');
}

// El token ANTES que las reglas: a quien no tiene un enlace válido no se le
// cuentan las reglas de la contraseña (mismo criterio que cambiar-password.php).
if (mb_strlen($nueva) < MIN_LARGO) {
    error_json('La nueva contraseña debe tener al menos ' . MIN_LARGO . ' caracteres', 400);
}
// strlen y no mb_strlen: el tope de bcrypt es en BYTES, no en caracteres.
if (strlen($nueva) > MAX_BYTES) {
    error_json('La nueva contraseña es demasiado larga', 400);
}
if ($nueva === (string) $fila['cu']) {
    error_json('La nueva contraseña no puede ser tu Clave Única', 400);
}

$hash = password_hash($nueva, PASSWORD_BCRYPT, ['cost' => COSTO]);
if (!is_string($hash)) {
    error_log('restablecer-password.php: password_hash devolvió algo que no es una cadena');
    error_json('No se pudo guardar la nueva contraseña', 500);
}

try {
    $pdo->beginTransaction();
    // usado_at IS NULL en el WHERE: si dos pestañas canjean el mismo enlace a
    // la vez, solo una afecta la fila; la otra se entera por rowCount().
    $marca = $pdo->prepare('UPDATE recuperacion_password SET usado_at = ? WHERE id = ? AND usado_at IS NULL');
    $marca->execute([ahora_utc(), (int) $fila['id']]);
    if ($marca->rowCount() !== 1) {
        $pdo->rollBack();
        error_json($invalido, 400, 'token_invalido');
    }
    $pdo->prepare('UPDATE profesor SET password_hash = ?, password_predeterminada = 0 WHERE id = ?')
        ->execute([$hash, (int) $fila['profesor_id']]);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fallo_interno('restablecer-password.php', $e, 'No se pudo guardar la nueva contraseña');
}

responder(['ok' => true, 'cu' => (string) $fila['cu']]);
