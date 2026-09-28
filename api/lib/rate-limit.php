<?php
// =============================================================================
// Rate limiting del login y del cambio de contraseña.
//
// Las dos Edge Functions limitaban intentos con un Map en memoria del proceso.
// PHP no tiene estado entre peticiones: cada request arranca de cero, así que
// ese código no se puede portar y el conteo vive en la tabla intento_login.
//
// Los números son los mismos que tenían las Edge Functions:
//   login              8 intentos / 5 min, por cu
//   cambiar-password   5 intentos / 5 min, por profesor_id
//
// Se conserva a propósito en vez de dejarlo para después: el login queda
// expuesto a internet abierto en un dominio del ITAM, que es bastante más
// visible que un proyecto de Supabase que nadie conoce.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const RL_VENTANA_SEGUNDOS   = 5 * 60;
const RL_MAX_LOGIN          = 8;
const RL_MAX_CAMBIO_PASSWORD = 5;

/**
 * ¿La llave ya pasó el límite en la ventana?
 *
 * Solo consulta; no registra nada. El intento se registra con
 * registrar_intento() y únicamente cuando FALLA, igual que en las Edge
 * Functions: entrar bien no debe acercarte al bloqueo.
 */
function paso_el_limite(string $llave, int $maxIntentos): bool
{
    $desde = gmdate('Y-m-d H:i:s', time() - RL_VENTANA_SEGUNDOS);
    $st = db()->prepare('SELECT COUNT(*) FROM intento_login WHERE llave = ? AND momento >= ?');
    $st->execute([$llave, $desde]);
    return (int) $st->fetchColumn() >= $maxIntentos;
}

function registrar_intento(string $llave): void
{
    $pdo = db();
    $pdo->prepare('INSERT INTO intento_login (llave, momento) VALUES (?, ?)')
        ->execute([$llave, ahora_utc()]);

    // La tabla se limpia sola: al escribir se borra lo más viejo que la
    // ventana. Sin esto crece para siempre y nadie se acuerda de podarla.
    $pdo->prepare('DELETE FROM intento_login WHERE momento < ?')
        ->execute([gmdate('Y-m-d H:i:s', time() - RL_VENTANA_SEGUNDOS)]);
}

/** Corta con 429 si la llave ya pasó el límite. Mismo mensaje que antes. */
function exigir_bajo_limite(string $llave, int $maxIntentos): void
{
    if (paso_el_limite($llave, $maxIntentos)) {
        error_json('Demasiados intentos, espera unos minutos', 429);
    }
}
