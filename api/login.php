<?php
// =============================================================================
// POST { cu, password } -> { token, expira_en, rol }
//
// Reemplaza backend/supabase/functions/login/index.ts. Mismos mensajes, mismo
// cuerpo de respuesta y mismos claims, para que el frontend no tenga que
// aprender nada nuevo.
//
// Único endpoint sin sesión previa (junto con nada más): no llama a sesion().
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/rate-limit.php';

exigir_metodo('POST');

$cfg  = config();
$body = cuerpo_json();

$cu       = trim((string) (isset($body['cu']) ? $body['cu'] : ''));
$password = (string) (isset($body['password']) ? $body['password'] : '');
if ($cu === '' || $password === '') {
    error_json('Faltan credenciales', 400);
}

$llave = 'login:' . $cu;
exigir_bajo_limite($llave, RL_MAX_LOGIN);

// Login unificado: profesor, jefe, servicios escolares, nómina y admin son
// todos filas de `profesor`; lo único que cambia es `rol` (diseno-bd.md §4.1).
//
// Este es uno de los DOS únicos lugares del API que seleccionan password_hash
// (el otro es cambiar-password.php). Es el equivalente del
// REVOKE ALL ON profesor + GRANT SELECT (lista explícita) de rls-policies.sql.
$st = db()->prepare('SELECT id, password_hash, rol, activo FROM profesor WHERE cu = ?');
$st->execute([$cu]);
$cuenta = $st->fetch();

// Mensaje genérico a propósito, y el mismo para cuenta inexistente, cuenta
// inactiva y contraseña incorrecta: no revelar si el cu existe.
if (!$cuenta || (int) $cuenta['activo'] !== 1) {
    registrar_intento($llave);
    error_json('Credenciales inválidas', 401);
}

// password_verify lee los hashes $2a$/$2b$ que generó bcryptjs, y también los
// de costo 6 con los que se cargó el roster (default de pgcrypto, documentado
// en cambiar-password/index.ts). No hay que regenerar nada al migrar.
if (!password_verify($password, (string) $cuenta['password_hash'])) {
    registrar_intento($llave);
    error_json('Credenciales inválidas', 401);
}

$ahora = time();
$token = jwt_firmar([
    'iss'         => 'autoplanear-login',
    'iat'         => $ahora,
    'exp'         => $ahora + (int) $cfg['token_ttl'],
    'profesor_id' => (int) $cuenta['id'],
    'rol'         => $cuenta['rol'],
    // El claim "role": "authenticated" que exigía PostgREST ya no hace falta:
    // el que valida el token somos nosotros (lib/auth.php).
], (string) $cfg['jwt_secret']);

responder([
    'token'     => $token,
    'expira_en' => (int) $cfg['token_ttl'],
    'rol'       => $cuenta['rol'],
]);
