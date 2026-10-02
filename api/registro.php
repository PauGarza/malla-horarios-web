<?php
// =============================================================================
// GET  -> { departamentos: [{id, nombre}] }
// POST { cu, nombre, password, departamento_id, tipo_contrato[, correo] }
//      -> { ok: true }   (201)
//
// Alta de cuenta desde la pantalla de login. Igual que login.php, no hay sesión
// previa: no llama a sesion().
//
// Lo que la persona NO elige, a propósito:
//   rol      -> siempre 'profesor'. Si el cuerpo trae otro, se ignora: dejar que
//               alguien se dé de alta como jefe o admin desde internet abierto
//               sería regalar el sistema. Los roles los sube un admin a mano.
//   activo   -> 1. La cuenta sirve para entrar en cuanto se crea.
//   password_predeterminada -> 0, porque la contraseña la eligió ella.
//   estado_especial -> NULL. Sabático/licencia/jubilación lo captura solo un
//               administrador; si el cuerpo lo trae, se ignora.
//
// Las reglas de la contraseña son las mismas de cambiar-password.php.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/rate-limit.php';

exigir_metodo('GET', 'POST');

const MIN_LARGO = 6;
const MAX_BYTES = 72;   // bcrypt ignora en silencio lo que pase de 72 bytes.
const COSTO     = 10;
const RL_MAX_REGISTRO = 5;
const TIPOS_CONTRATO = ['tiempo_completo', 'asignatura', 'medio_tiempo'];

$pdo = db();

if (metodo_http() === 'GET') {
    // Solo id y nombre: es lo único que el formulario necesita para el select,
    // y es información pública de la división.
    responder([
        'departamentos' => $pdo->query('SELECT id, nombre FROM departamento ORDER BY id')->fetchAll(),
    ]);
}

// Detrás del proxy REMOTE_ADDR es el proxy mismo, así que se prefiere la
// primera IP de X-Forwarded-For. Se puede falsificar, pero lo peor que logra
// quien la falsifica es saltarse este límite, no entrar a ningún lado.
$ip = isset($_SERVER['HTTP_X_FORWARDED_FOR'])
    ? trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0])
    : (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
$llave = 'registro:' . $ip;
exigir_bajo_limite($llave, RL_MAX_REGISTRO);

$body = cuerpo_json();

// Sin ceros a la izquierda: así está guardado el roster y así lo normaliza
// login.php, para que 000123456 y 123456 sean la misma cuenta.
$cu = ltrim(trim((string) (isset($body['cu']) ? $body['cu'] : '')), '0');
$nombre         = trim((string) (isset($body['nombre']) ? $body['nombre'] : ''));
$password       = (string) (isset($body['password']) ? $body['password'] : '');
$departamentoId = filter_var(isset($body['departamento_id']) ? $body['departamento_id'] : null, FILTER_VALIDATE_INT);
$tipoContrato   = (string) (isset($body['tipo_contrato']) ? $body['tipo_contrato'] : '');
// Opcional (2026-10-02); se puede capturar después en Mi perfil.
$correo         = normalizar_correo(isset($body['correo']) ? $body['correo'] : '');

if ($cu === '' || $nombre === '' || $password === '' || $departamentoId === false || $tipoContrato === '') {
    error_json('Faltan datos obligatorios', 400);
}
if (!preg_match('/^[0-9]{1,10}$/', $cu)) {
    error_json('La Clave Única solo puede tener números (máximo 10)', 400);
}
if (mb_strlen($nombre) > 255) {
    error_json('El nombre es demasiado largo', 400);
}
if (!in_array($tipoContrato, TIPOS_CONTRATO, true)) {
    error_json('Tipo de contrato inválido', 400);
}

$st = $pdo->prepare('SELECT 1 FROM departamento WHERE id = ?');
$st->execute([$departamentoId]);
if (!$st->fetchColumn()) {
    error_json('Departamento inválido', 400);
}

if (mb_strlen($password) < MIN_LARGO) {
    error_json('La contraseña debe tener al menos ' . MIN_LARGO . ' caracteres', 400);
}
// strlen y no mb_strlen: el tope de bcrypt es en BYTES, no en caracteres.
if (strlen($password) > MAX_BYTES) {
    error_json('La contraseña es demasiado larga', 400);
}
if ($password === $cu) {
    error_json('La contraseña no puede ser tu Clave Única', 400);
}

$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => COSTO]);
if (!is_string($hash)) {
    error_log('registro.php: password_hash devolvió algo que no es una cadena');
    error_json('No se pudo crear la cuenta', 500);
}

// Cada alta cuenta para el límite, salga bien o mal: aquí lo que se frena es
// la creación masiva de cuentas, no adivinar contraseñas.
registrar_intento($llave);

try {
    $pdo->prepare(
        "INSERT INTO profesor
            (cu, password_hash, nombre, correo, rol, departamento_id, tipo_contrato,
             password_predeterminada, estado_especial, activo)
         VALUES (?, ?, ?, ?, 'profesor', ?, ?, 0, NULL, 1)"
    )->execute([$cu, $hash, $nombre, $correo, $departamentoId, $tipoContrato]);
} catch (PDOException $e) {
    // 23000 = violación de integridad; con los datos ya validados, la única
    // posible es el UNIQUE de cu.
    if ($e->getCode() === '23000') {
        error_json('Ya existe una cuenta con esa Clave Única', 409, 'cuenta_existente');
    }
    fallo_interno('registro.php', $e, 'No se pudo crear la cuenta');
}

responder(['ok' => true], 201);
