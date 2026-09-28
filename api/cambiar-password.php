<?php
// =============================================================================
// POST { password_actual, password_nueva } -> { ok: true }
//
// Traducción directa de backend/supabase/functions/cambiar-password/index.ts,
// con las mismas constantes, las mismas reglas, en el mismo orden y con los
// mismos mensajes. El porqué de cada regla está documentado allá.
//
// El profesor_id sale del token y solo del token, nunca del cuerpo.
// Los tokens ya emitidos siguen siendo válidos tras cambiar la contraseña,
// igual que antes.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/rate-limit.php';

exigir_metodo('POST');

const MIN_LARGO = 6;
const MAX_BYTES = 72;   // bcrypt ignora en silencio lo que pase de 72 bytes.
const COSTO     = 10;

$yo = mi_id();

$llave = 'password:' . $yo;
exigir_bajo_limite($llave, RL_MAX_CAMBIO_PASSWORD);

$body   = cuerpo_json();
$actual = (string) (isset($body['password_actual']) ? $body['password_actual'] : '');
$nueva  = (string) (isset($body['password_nueva'])  ? $body['password_nueva']  : '');
if ($actual === '' || $nueva === '') {
    error_json('Faltan la contraseña actual y la nueva', 400);
}

// Segundo y último lugar del API que selecciona password_hash.
$st = db()->prepare('SELECT id, cu, password_hash, activo FROM profesor WHERE id = ?');
$st->execute([$yo]);
$cuenta = $st->fetch();
if (!$cuenta || (int) $cuenta['activo'] !== 1) {
    error_json('Sesión inválida o vencida, vuelve a entrar', 401);
}

// La actual ANTES de revisar la nueva: a quien no conoce la actual no se le
// cuentan las reglas de la nueva.
if (!password_verify($actual, (string) $cuenta['password_hash'])) {
    registrar_intento($llave);
    error_json('La contraseña actual no es correcta', 401);
}

if (mb_strlen($nueva) < MIN_LARGO) {
    error_json('La nueva contraseña debe tener al menos ' . MIN_LARGO . ' caracteres', 400);
}
// strlen y no mb_strlen: el tope de bcrypt es en BYTES, no en caracteres.
if (strlen($nueva) > MAX_BYTES) {
    error_json('La nueva contraseña es demasiado larga', 400);
}
if ($nueva === (string) $cuenta['cu']) {
    error_json('La nueva contraseña no puede ser tu Clave Única', 400);
}
if ($nueva === $actual) {
    error_json('La nueva contraseña es igual a la actual', 400);
}

$hash = password_hash($nueva, PASSWORD_BCRYPT, ['cost' => COSTO]);
if (!is_string($hash)) {
    error_log('cambiar-password.php: password_hash devolvió algo que no es una cadena');
    error_json('No se pudo guardar la nueva contraseña', 500);
}

try {
    db()->prepare('UPDATE profesor SET password_hash = ?, password_predeterminada = 0 WHERE id = ?')
        ->execute([$hash, $yo]);
} catch (Throwable $e) {
    fallo_interno('cambiar-password.php', $e, 'No se pudo guardar la nueva contraseña');
}

responder(['ok' => true]);
