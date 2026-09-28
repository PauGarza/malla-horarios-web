<?php
// =============================================================================
// Conexión a MySQL y helpers de respuesta.
//
// Se escribe para PHP 7.4 a propósito: la versión del hosting del ITAM no
// estaba confirmada al escribir esto (ver §2.2 de plansql.md), así que no se
// usan str_starts_with, match, enums, nullsafe ni spread con llaves de texto.
// Si se confirma PHP 8.x, esto sigue funcionando igual.
// =============================================================================

declare(strict_types=1);

function config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $ruta = __DIR__ . '/config.php';
        if (!is_file($ruta)) {
            // Sin detalles al navegador, pero sí al log: este error solo pasa
            // cuando el deploy olvidó copiar config.php.
            error_log('api: falta lib/config.php (ver lib/config.example.php)');
            error_json('El servidor no está configurado', 500);
        }
        $cfg = require $ruta;
    }
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $cfg = config();
    $dsn = "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4";
    try {
        $pdo = new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Sentencias preparadas de verdad, no emuladas: con emulación PDO
            // interpola el valor en la cadena SQL y la protección depende de su
            // escapado, no del servidor.
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        error_log('api: no se pudo conectar a MySQL: ' . $e->getMessage());
        error_json('No se pudo conectar con la base de datos', 500);
    }

    // Todos los DATETIME se guardan y se leen en UTC (ver bd/mysql/README.md).
    // Sin esto, NOW() usaría la zona del servidor y enviado_at quedaría en hora
    // local sin que nada lo indicara.
    $pdo->exec("SET time_zone = '+00:00'");

    // MySQL en modo no estricto convierte un valor fuera de un ENUM en cadena
    // vacía en vez de fallar. Es exactamente el tipo de pérdida silenciosa que
    // no se quiere: que truene.
    $pdo->exec("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");

    return $pdo;
}

/** Ahora, en UTC, con el formato que acepta un DATETIME de MySQL. */
function ahora_utc(): string
{
    return gmdate('Y-m-d H:i:s');
}

function responder($cuerpo, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // Sin headers CORS: el API vive en el mismo origen que la app. Los que
    // tenían las Edge Functions existían solo porque el frontend estaba en
    // GitHub Pages y la base en Supabase.
    echo json_encode($cuerpo, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Corta la petición con un error.
 *
 * `codigo` es opcional y es un identificador estable que el frontend puede
 * comparar (ej. 'clave_duplicada'). Existe porque CatalogoMaterias.jsx hoy
 * detecta el caso mirando el nombre de la constraint de Postgres dentro del
 * mensaje ('materia_clave_key'), y MySQL nombra sus errores de otra forma:
 * atar la UX a un texto de error de un motor concreto no sobrevive la
 * migración, un código propio sí.
 */
function error_json(string $mensaje, int $status, ?string $codigo = null): void
{
    $cuerpo = ['error' => $mensaje];
    if ($codigo !== null) {
        $cuerpo['codigo'] = $codigo;
    }
    responder($cuerpo, $status);
}

function cuerpo_json(): array
{
    $raw = file_get_contents('php://input');
    $datos = json_decode($raw !== false && $raw !== '' ? $raw : '', true);
    if (!is_array($datos)) {
        error_json('JSON inválido', 400);
    }
    return $datos;
}

/** Lee ?nombre=123 como entero positivo, o corta con 400. */
function param_id(string $nombre): int
{
    $valor = filter_input(INPUT_GET, $nombre, FILTER_VALIDATE_INT);
    if ($valor === false || $valor === null || $valor < 1) {
        error_json("Falta $nombre", 400);
    }
    return (int) $valor;
}

/** Normaliza un texto opcional del cuerpo: '' se guarda como NULL. */
function texto_opcional(array $body, string $llave): ?string
{
    if (!isset($body[$llave])) {
        return null;
    }
    $v = trim((string) $body[$llave]);
    return $v === '' ? null : $v;
}

/**
 * Registra la excepción en el log y devuelve un 500 genérico.
 *
 * El detalle nunca va al navegador: un mensaje de MySQL puede revelar nombres
 * de columnas y estructura de tablas.
 */
function fallo_interno(string $donde, Throwable $e, string $mensaje = 'No se pudo completar la operación'): void
{
    error_log($donde . ': ' . $e->getMessage());
    error_json($mensaje, 500);
}
