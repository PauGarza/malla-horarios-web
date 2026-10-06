<?php
// =============================================================================
// Envío de correo (2026-10-02, para "olvidé mi contraseña").
//
// Dos caminos, según config.php:
//
//   * Sin 'smtp' (o con smtp.host vacío): mail() de PHP, que entrega al
//     sendmail/postfix local del servidor. No se ha comprobado todavía que el
//     servidor del ITAM tenga uno que reenvíe hacia fuera — ver api/README.md.
//   * Con 'smtp' => ['host' => ...]: un cliente SMTP mínimo aquí mismo, con
//     STARTTLS y AUTH LOGIN. Existe por si mail() no sale: así se cambia el
//     camino editando config.php en el servidor, sin redesplegar código.
//
// Sin PHPMailer a propósito: es el mismo motivo por el que el JWT de
// lib/auth.php está escrito a mano — no hay Composer en este hosting.
//
// Las funciones devuelven bool y NUNCA cortan la petición: quien las llama
// decide qué decirle a la persona (en olvide-password.php, lo mismo siempre).
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';

/** Valor de config.php con default, para claves que se agregaron después. */
function config_o(string $llave, $default)
{
    $cfg = config();
    return isset($cfg[$llave]) && $cfg[$llave] !== '' ? $cfg[$llave] : $default;
}

/**
 * Manda un correo de texto plano en UTF-8. $para ya debe venir validado
 * (normalizar_correo): va tal cual en la cabecera To.
 */
function enviar_correo(string $para, string $asunto, string $texto): bool
{
    $remitente = (string) config_o('correo_remitente', 'no-responder@horariosdace.itam.mx');
    $nombre    = (string) config_o('correo_nombre', 'Malla Horarios DACE');

    // RFC 2047: el asunto y el nombre llevan acentos.
    $codificar = function (string $s): string {
        return '=?UTF-8?B?' . base64_encode($s) . '?=';
    };

    $cabeceras = [
        'From'                      => $codificar($nombre) . ' <' . $remitente . '>',
        'MIME-Version'              => '1.0',
        'Content-Type'              => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => '8bit',
    ];

    $smtp = config_o('smtp', []);
    if (is_array($smtp) && !empty($smtp['host'])) {
        return smtp_enviar($smtp, $remitente, $para, $codificar($asunto), $cabeceras, $texto);
    }

    // -f fija el remitente del sobre (Return-Path); sin él, postfix usa
    // apache@<host>, que muchos servidores de correo rechazan.
    $ok = mail($para, $codificar($asunto), $texto, $cabeceras, '-f' . $remitente);
    if (!$ok) {
        error_log('correo.php: mail() devolvió false enviando a ' . $para);
    }
    return $ok;
}

/**
 * Cliente SMTP mínimo: un mensaje, un destinatario.
 *
 * $smtp = ['host', 'puerto' => 587, 'seguridad' => 'tls'|'ssl'|'', 'usuario', 'password'].
 * 'tls' = STARTTLS sobre el puerto 587; 'ssl' = TLS desde el inicio (465).
 */
function smtp_enviar(array $smtp, string $de, string $para, string $asunto, array $cabeceras, string $texto): bool
{
    $host      = (string) $smtp['host'];
    $puerto    = isset($smtp['puerto']) ? (int) $smtp['puerto'] : 587;
    $seguridad = isset($smtp['seguridad']) ? (string) $smtp['seguridad'] : 'tls';
    $usuario   = isset($smtp['usuario']) ? (string) $smtp['usuario'] : '';
    $password  = isset($smtp['password']) ? (string) $smtp['password'] : '';

    $destino = ($seguridad === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $puerto;
    $s = @stream_socket_client($destino, $errno, $errstr, 15);
    if (!$s) {
        error_log("correo.php: no se pudo conectar a $destino: $errstr ($errno)");
        return false;
    }
    stream_set_timeout($s, 15);

    // Una respuesta SMTP puede ocupar varias líneas ("250-..."); termina en la
    // que trae espacio en la cuarta posición ("250 ...").
    $leer = function () use ($s): string {
        $respuesta = '';
        while (($linea = fgets($s, 515)) !== false) {
            $respuesta .= $linea;
            if (strlen($linea) < 4 || $linea[3] === ' ') {
                break;
            }
        }
        return $respuesta;
    };
    // $etiqueta es lo que va al log en vez de la línea: la de AUTH lleva la
    // contraseña en base64.
    $paso = function (?string $linea, array $esperados, string $etiqueta) use ($s, $leer): bool {
        if ($linea !== null) {
            fwrite($s, $linea . "\r\n");
        }
        $respuesta = $leer();
        if (!in_array((int) substr($respuesta, 0, 3), $esperados, true)) {
            error_log("correo.php: SMTP $etiqueta -> " . trim($respuesta));
            return false;
        }
        return true;
    };

    $yo = (string) config_o('smtp_ehlo', 'horariosdace.itam.mx');

    $ok = $paso(null, [220], 'saludo')
        && $paso("EHLO $yo", [250], 'EHLO');

    if ($ok && $seguridad === 'tls') {
        $ok = $paso('STARTTLS', [220], 'STARTTLS')
            && stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLS_CLIENT) === true
            && $paso("EHLO $yo", [250], 'EHLO tras STARTTLS');
    }
    if ($ok && $usuario !== '') {
        $ok = $paso('AUTH LOGIN', [334], 'AUTH LOGIN')
            && $paso(base64_encode($usuario), [334], 'usuario')
            && $paso(base64_encode($password), [235], 'password');
    }

    if ($ok) {
        $mensaje = '';
        foreach ($cabeceras + [
            'To'         => $para,
            'Subject'    => $asunto,
            'Date'       => date('r'),
            'Message-ID' => '<' . bin2hex(random_bytes(12)) . '@' . $yo . '>',
        ] as $nombre => $valor) {
            $mensaje .= "$nombre: $valor\r\n";
        }
        // Saltos de línea CRLF y "dot-stuffing": una línea que empieza con
        // punto se duplica, o el servidor la tomaría como fin del mensaje.
        $cuerpo = preg_replace('/\r\n|\r|\n/', "\r\n", $texto);
        $cuerpo = preg_replace('/^\./m', '..', $cuerpo);

        $ok = $paso("MAIL FROM:<$de>", [250], 'MAIL FROM')
            && $paso("RCPT TO:<$para>", [250, 251], 'RCPT TO')
            && $paso('DATA', [354], 'DATA')
            && $paso($mensaje . "\r\n" . $cuerpo . "\r\n.", [250], 'fin de DATA');
    }

    @fwrite($s, "QUIT\r\n");
    fclose($s);
    return $ok;
}
