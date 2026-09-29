<?php
// =============================================================================
// El reemplazo de Row Level Security.
//
// MySQL no tiene RLS. Las 38 políticas de bd/rls-policies.sql no tienen
// equivalente que traducir: se vuelven autorización explícita, y este archivo
// es su base. Equivalencias directas:
//
//   app_profesor_id()      -> mi_id()            (claim del JWT verificado)
//   app_rol()              -> mi_rol()           (claim del JWT verificado)
//   app_departamento_id()  -> mi_departamento()  (un SELECT)
//
// app_departamento_id() era SECURITY DEFINER para romper una recursión de
// políticas RLS sobre la propia tabla profesor. Aquí no hay recursión que
// romper: es un SELECT normal.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';

// -----------------------------------------------------------------------------
// JWT HS256, sin dependencias
//
// Son ~40 líneas y evitan meter Composer en un hosting donde no se sabe si hay
// acceso a shell. El algoritmo se FIJA a HS256 y se COMPARA contra el header:
// aceptar el `alg` que venga en el token es la vulnerabilidad clásica de JWT
// (un token con alg "none", o un HS256 verificado contra una llave pública).
// -----------------------------------------------------------------------------

function b64url_encode(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function b64url_decode(string $s): string
{
    $relleno = (4 - strlen($s) % 4) % 4;
    $decodificado = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', $relleno), true);
    return $decodificado === false ? '' : $decodificado;
}

function jwt_firmar(array $claims, string $secreto): string
{
    $header  = b64url_encode((string) json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload = b64url_encode((string) json_encode($claims));
    $firma   = b64url_encode(hash_hmac('sha256', "$header.$payload", $secreto, true));
    return "$header.$payload.$firma";
}

function jwt_verificar(string $token, string $secreto): ?array
{
    $partes = explode('.', $token);
    if (count($partes) !== 3) {
        return null;
    }
    list($h, $p, $f) = $partes;

    $header = json_decode(b64url_decode($h), true);
    // Si el token dice alg:"none" o alg:"RS256", se rechaza aquí y no más abajo.
    if (!is_array($header) || !isset($header['alg']) || $header['alg'] !== 'HS256') {
        return null;
    }

    $esperada = hash_hmac('sha256', "$h.$p", $secreto, true);
    // hash_equals y no ===: comparación en tiempo constante.
    if (!hash_equals($esperada, b64url_decode($f))) {
        return null;
    }

    $claims = json_decode(b64url_decode($p), true);
    if (!is_array($claims)) {
        return null;
    }
    if (!isset($claims['exp']) || (int) $claims['exp'] < time()) {
        return null;
    }
    return $claims;
}

// -----------------------------------------------------------------------------
// La sesión
//
// El profesor_id sale del TOKEN, nunca de un parámetro de la petición: eso es
// lo que impide que alguien lea o escriba la preferencia de otro mandando su id.
// -----------------------------------------------------------------------------

/**
 * El token de la petición.
 *
 * Se lee de X-Autoplanear-Token y NO de Authorization. Comprobado contra el
 * servidor del ITAM el 2026-09-25: hay un proxy inverso delante de Apache (se
 * ve en X-Forwarded-For / X-Real-Ip / X-Forwarded-Proto) que **descarta el
 * header Authorization** antes de que llegue a PHP. No aparece en $_SERVER, ni
 * en REDIRECT_HTTP_AUTHORIZATION, ni en getallheaders(), y un .htaccess con la
 * receta habitual de mod_rewrite tampoco lo recupera — el header ya no existe
 * cuando Apache lo ve. Un header propio sí pasa intacto.
 *
 * Se conserva Authorization como respaldo para que el API siga funcionando si
 * algún día se despliega detrás de un servidor que no lo toque.
 */
function token_de_la_peticion(): string
{
    if (isset($_SERVER['HTTP_X_AUTOPLANEAR_TOKEN'])) {
        return trim((string) $_SERVER['HTTP_X_AUTOPLANEAR_TOKEN']);
    }

    $auth = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $auth = (string) $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $auth = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('getallheaders')) {
        foreach (getallheaders() as $nombre => $valor) {
            if (strcasecmp($nombre, 'Authorization') === 0) {
                $auth = (string) $valor;
                break;
            }
        }
    }

    // strncmp y no str_starts_with: str_starts_with es de PHP 8.0.
    return strncmp($auth, 'Bearer ', 7) === 0 ? substr($auth, 7) : '';
}

function sesion(): array
{
    static $sesion = null;
    if ($sesion !== null) {
        return $sesion;
    }

    $cfg   = config();
    $token = token_de_la_peticion();
    if ($token === '') {
        error_json('Falta la sesión', 401);
    }

    $claims = jwt_verificar($token, (string) $cfg['jwt_secret']);
    if ($claims === null) {
        error_json('Sesión inválida o vencida, vuelve a entrar', 401);
    }

    $id = filter_var(isset($claims['profesor_id']) ? $claims['profesor_id'] : null, FILTER_VALIDATE_INT);
    if ($id === false || $id === null) {
        error_json('Sesión inválida', 401);
    }

    $sesion = [
        'profesor_id' => (int) $id,
        'rol'         => isset($claims['rol']) ? (string) $claims['rol'] : 'profesor',
    ];
    return $sesion;
}

function mi_id(): int
{
    $s = sesion();
    return $s['profesor_id'];
}

function mi_rol(): string
{
    $s = sesion();
    return $s['rol'];
}

/**
 * Equivalente de app_departamento_id().
 *
 * Se lee de la fila del profesor y no de un claim del JWT a propósito, igual
 * que en RLS: así no hay que reemitir el token si algún día cambia de
 * departamento (ver el COMMENT de roster_departamento_select).
 */
function mi_departamento(): ?int
{
    static $depto = false;
    if ($depto !== false) {
        return $depto;
    }
    $st = db()->prepare('SELECT departamento_id FROM profesor WHERE id = ?');
    $st->execute([mi_id()]);
    $v = $st->fetchColumn();
    $depto = ($v === false || $v === null) ? null : (int) $v;
    return $depto;
}

/** El perfil propio. Nunca incluye password_hash (REVOKE/GRANT por columna). */
function mi_perfil(): array
{
    static $perfil = null;
    if ($perfil !== null) {
        return $perfil;
    }
    $st = db()->prepare(
        'SELECT id, cu, nombre, rol, departamento_id, tipo_contrato,
                password_predeterminada, estado_especial, activo
           FROM profesor WHERE id = ?'
    );
    $st->execute([mi_id()]);
    $fila = $st->fetch();
    if (!$fila) {
        error_json('Sesión inválida o vencida, vuelve a entrar', 401);
    }
    if ((int) $fila['activo'] !== 1) {
        error_json('Tu cuenta está desactivada', 403);
    }
    $perfil = $fila;
    return $perfil;
}

// -----------------------------------------------------------------------------
// Guardias
// -----------------------------------------------------------------------------

/**
 * El método HTTP efectivo de la petición.
 *
 * Comprobado contra el servidor del ITAM el 2026-09-25: el proxy inverso que
 * está delante de Apache **bloquea PUT, PATCH y DELETE** con un 405 propio
 * (devuelve HTML de nginx, no JSON), así que esas peticiones ni siquiera llegan
 * a PHP. Solo pasan GET y POST.
 *
 * Por eso el frontend manda esos tres métodos como POST con la cabecera
 * X-HTTP-Method-Override, y aquí se vuelve a resolver. Es el tunelado clásico
 * para atravesar intermediarios restrictivos.
 *
 * El override SOLO se admite sobre POST: sobre GET permitiría convertir un
 * enlace en una escritura. Y solo para esos tres verbos, nunca para inventar
 * uno nuevo.
 */
function metodo_http(): string
{
    static $metodo = null;
    if ($metodo !== null) {
        return $metodo;
    }

    $real = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : 'GET';
    $metodo = $real;

    if ($real === 'POST' && isset($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) {
        $pedido = strtoupper(trim((string) $_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']));
        if (in_array($pedido, ['PUT', 'PATCH', 'DELETE'], true)) {
            $metodo = $pedido;
        }
    }

    return $metodo;
}

function exigir_metodo(string ...$permitidos): void
{
    if (!in_array(metodo_http(), $permitidos, true)) {
        header('Allow: ' . implode(', ', $permitidos));
        error_json('Método no permitido', 405);
    }
}

function exigir_rol(string ...$roles): void
{
    if (!in_array(mi_rol(), $roles, true)) {
        error_json('No tienes permiso para esta acción', 403);
    }
}

/**
 * Los roles que administran el cuestionario: su propio departamento o todos.
 * Es la lista que va en exigir_rol() de panel, reabrir, materias y
 * configuracion — tenerla en un solo lugar evita que al agregar un rol se
 * olvide uno de los cuatro.
 */
const ROLES_GESTION = ['jefe_departamento', 'jefe_division', 'admin'];

/**
 * ¿Quien llama ve y edita TODOS los departamentos?
 *
 * jefe_division porque la division academica esta arriba de los departamentos
 * (DACE agrupa Matematicas, Actuaria y Estadistica), y admin porque administra
 * el sistema. Son cosas distintas con el mismo alcance, y por eso la pregunta
 * se hace por comportamiento y no comparando contra un rol concreto.
 */
function ve_todos_los_departamentos(): bool
{
    return in_array(mi_rol(), ['admin', 'jefe_division'], true);
}

/**
 * Alcance sobre un departamento. jefe_division y admin pueden en cualquiera;
 * jefe_departamento solo en el suyo.
 *
 * Es la guardia de roster_departamento_select,
 * jefe_preferencia_reapertura, materia_escritura_departamento,
 * materia_cuestionario_escritura y departamento_config_escritura.
 */
function exigir_jefe_de(?int $departamentoId): void
{
    if (ve_todos_los_departamentos()) {
        return;
    }
    if (mi_rol() === 'jefe_departamento'
        && $departamentoId !== null
        && $departamentoId === mi_departamento()) {
        return;
    }
    error_json('No tienes permiso sobre ese departamento', 403);
}

/**
 * El departamento sobre el que trabaja quien llama: el suyo, o el que pida por
 * ?departamento_id= si es admin. Corta con 403 si no tiene permiso.
 */
function departamento_objetivo(): int
{
    $pedido = filter_input(INPUT_GET, 'departamento_id', FILTER_VALIDATE_INT);
    $depto  = ($pedido === false || $pedido === null) ? mi_departamento() : (int) $pedido;
    if ($depto === null) {
        error_json('Falta departamento_id', 400);
    }
    exigir_jefe_de($depto);
    return $depto;
}

/** El departamento al que pertenece una materia, o null si no existe. */
function departamento_de_materia(int $materiaId): ?int
{
    $st = db()->prepare('SELECT departamento_id FROM materia WHERE id = ?');
    $st->execute([$materiaId]);
    $v = $st->fetchColumn();
    return $v === false ? null : (int) $v;
}
