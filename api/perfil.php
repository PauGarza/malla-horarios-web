<?php
// =============================================================================
// POST { correo } -> { ok: true, correo }
//
// Lo que la persona puede cambiar de su propio perfil. Hoy es solo el correo
// (agregado 2026-10-02); nombre, departamento, rol y tipo de contrato los
// corrige la jefatura o un admin, igual que antes.
//
// El profesor_id sale del token y solo del token, nunca del cuerpo, igual que
// en cambiar-password.php. Correo vacío = borrarlo (NULL): es opcional.
//
// POST y no PATCH a propósito aunque sea una actualización: es una sola
// columna del propio registro y así no depende del tunelado de
// X-HTTP-Method-Override (ver metodo_http() en lib/auth.php).
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

exigir_metodo('POST');

$yo   = mi_id();
// mi_perfil() corta con 403 si la cuenta está desactivada.
mi_perfil();

$body   = cuerpo_json();
$correo = normalizar_correo(isset($body['correo']) ? $body['correo'] : '');

try {
    db()->prepare('UPDATE profesor SET correo = ? WHERE id = ?')->execute([$correo, $yo]);
} catch (Throwable $e) {
    fallo_interno('perfil.php', $e, 'No se pudo guardar el correo');
}

responder(['ok' => true, 'correo' => $correo]);
