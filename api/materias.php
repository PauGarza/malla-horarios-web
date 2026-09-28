<?php
// =============================================================================
// Catálogo de materias de un departamento (vista de Jefe de Departamento/admin).
//
//   GET                       -> { materias[], co_oferta{} }
//   POST                      -> { materia }            crea una materia
//   PATCH  ?id=N              -> { materia }            edita una materia
//   PUT    ?recurso=co_oferta -> { ok, omitidos[] }     aplica altas y bajas
//
// Políticas que reemplaza:
//   catalogo_lectura_autenticados   -> lectura, basta estar autenticado
//   materia_escritura_departamento  -> exigir_jefe_de(departamento de la materia)
//   materia_co_oferta_escritura     -> exigir_jefe_de(departamento de materia_id)
//
// departamento_id no es editable a propósito: mover una materia a otro
// departamento la sacaría del alcance de quien la edita y el guardado quedaría
// a medias. Es la misma razón por la que el frontend lo deja fuera de CAMPOS.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

exigir_metodo('GET', 'POST', 'PATCH', 'PUT');
exigir_rol(...ROLES_GESTION);

$pdo    = db();
$metodo = metodo_http();

const COLUMNAS_MATERIA =
    'id, clave, nombre, creditos, anual, tipo_salon_requerido, activa, departamento_id';

/** Devuelve la materia ya con los tipos que espera el frontend. */
function materia_por_id(PDO $pdo, int $id): ?array
{
    $st = $pdo->prepare('SELECT ' . COLUMNAS_MATERIA . ' FROM materia WHERE id = ?');
    $st->execute([$id]);
    $f = $st->fetch();
    return $f === false ? null : materia_salida($f);
}

function materia_salida(array $f): array
{
    return [
        'id'                   => (int) $f['id'],
        'clave'                => $f['clave'],
        'nombre'               => $f['nombre'],
        'creditos'             => (int) $f['creditos'],
        'anual'                => (int) $f['anual'] === 1,
        'tipo_salon_requerido' => $f['tipo_salon_requerido'],
        'activa'               => (int) $f['activa'] === 1,
        'departamento_id'      => (int) $f['departamento_id'],
    ];
}

/**
 * Valida y normaliza los campos editables. `$parcial` deja pasar un subconjunto
 * (PATCH manda solo lo que cambió).
 */
function campos_materia(array $body, bool $parcial): array
{
    $campos = [];

    if (isset($body['clave']) || !$parcial) {
        $clave = trim((string) (isset($body['clave']) ? $body['clave'] : ''));
        if ($clave === '') {
            error_json('Falta la clave', 400, 'clave_vacia');
        }
        $campos['clave'] = $clave;
    }
    if (isset($body['nombre']) || !$parcial) {
        $nombre = trim((string) (isset($body['nombre']) ? $body['nombre'] : ''));
        if ($nombre === '') {
            error_json('Falta el nombre', 400, 'nombre_vacio');
        }
        $campos['nombre'] = $nombre;
    }
    if (isset($body['creditos']) || !$parcial) {
        $creditos = filter_var(isset($body['creditos']) ? $body['creditos'] : null, FILTER_VALIDATE_INT);
        // Se valida aquí y no solo con el CHECK porque en MySQL < 8.0.16 los
        // CHECK se ignoran en silencio (ver bd/mysql/README.md).
        if ($creditos === false || $creditos === null || $creditos <= 0) {
            error_json('Los créditos deben ser un entero mayor que 0', 400, 'creditos_invalidos');
        }
        $campos['creditos'] = $creditos;
    }
    if (array_key_exists('anual', $body) || !$parcial) {
        $campos['anual'] = empty($body['anual']) ? 0 : 1;
    }
    if (array_key_exists('tipo_salon_requerido', $body) || !$parcial) {
        $campos['tipo_salon_requerido'] = texto_opcional($body, 'tipo_salon_requerido');
    }
    if (array_key_exists('activa', $body) || !$parcial) {
        $campos['activa'] = empty($body['activa']) ? 0 : 1;
    }

    return $campos;
}

/**
 * ¿La excepción es el choque de materia.clave?
 *
 * materia.clave es única en TODO el sistema, no solo dentro del departamento,
 * así que la validación del cliente (que solo ve las materias de su depto) no
 * puede atrapar el choque contra una clave de Actuaría o Estadística. Se
 * traduce a un código estable en vez de dejar que el frontend busque el nombre
 * del índice dentro del mensaje: hoy busca 'materia_clave_key' (Postgres) y
 * MySQL diría "Duplicate entry ... for key 'materia.clave'".
 */
function es_clave_duplicada(Throwable $e): bool
{
    return $e instanceof PDOException
        && isset($e->errorInfo[1])
        && (int) $e->errorInfo[1] === 1062;
}

// -----------------------------------------------------------------------------
// GET: catálogo del departamento + co-oferta
// -----------------------------------------------------------------------------

if ($metodo === 'GET') {
    $deptoId = departamento_objetivo();

    $st = $pdo->prepare(
        'SELECT ' . COLUMNAS_MATERIA . ' FROM materia WHERE departamento_id = ? ORDER BY clave'
    );
    $st->execute([$deptoId]);
    $materias = array_map('materia_salida', $st->fetchAll());

    // Hoy el frontend pide TODA la tabla materia_co_oferta y la filtra en JS
    // contra las materias de su departamento. Aquí el filtro va en el WHERE:
    // el endpoint nunca devuelve pares que no le tocan.
    $st = $pdo->prepare(
        'SELECT co.materia_id, co.co_ofertada_id
           FROM materia_co_oferta co
           JOIN materia m ON m.id = co.materia_id
          WHERE m.departamento_id = ?'
    );
    $st->execute([$deptoId]);

    $coOferta = [];
    foreach ($st->fetchAll() as $p) {
        $a = (string) (int) $p['materia_id'];
        if (!isset($coOferta[$a])) {
            $coOferta[$a] = [];
        }
        $coOferta[$a][] = (int) $p['co_ofertada_id'];
    }

    responder([
        'materias' => $materias,
        // (object) para que un catálogo sin co-oferta llegue como {} y no como
        // [], que en JS no se puede indexar por id.
        'co_oferta' => (object) $coOferta,
    ]);
}

// -----------------------------------------------------------------------------
// PUT ?recurso=co_oferta: altas y bajas de pares, en una transacción
// -----------------------------------------------------------------------------

if ($metodo === 'PUT') {
    if (filter_input(INPUT_GET, 'recurso') !== 'co_oferta') {
        error_json('Recurso no soportado', 400);
    }

    $body    = cuerpo_json();
    $agregar = isset($body['agregar']) && is_array($body['agregar']) ? $body['agregar'] : [];
    $quitar  = isset($body['quitar'])  && is_array($body['quitar'])  ? $body['quitar']  : [];

    // La relación se guarda en las dos direcciones, pero cada Jefe solo puede
    // escribir la SUYA: materia_co_oferta_escritura se condiciona solo sobre
    // materia_id (el "dueño" de la fila) porque existe un par real que cruza
    // departamentos (MAT-22600 con ACT-11310) y exigir que ambas materias sean
    // del mismo departamento lo haría imposible de registrar.
    //
    // Así que las direcciones fuera del alcance de quien llama no son un error:
    // se omiten y se reportan, para que la pantalla pueda decir que la otra
    // mitad del par la tiene que declarar el Jefe del otro departamento. Es el
    // caso que hoy simplemente tronaría contra RLS a medio guardado.
    $omitidos = [];
    $puedeEscribir = function (int $materiaId) use (&$omitidos): bool {
        if (ve_todos_los_departamentos()) {
            return true;
        }
        $depto = departamento_de_materia($materiaId);
        if ($depto !== null && $depto === mi_departamento()) {
            return true;
        }
        $omitidos[] = $materiaId;
        return false;
    };

    $pdo->beginTransaction();
    try {
        $del = $pdo->prepare('DELETE FROM materia_co_oferta WHERE materia_id = ? AND co_ofertada_id = ?');
        foreach ($quitar as $par) {
            if (!is_array($par) || count($par) !== 2) {
                $pdo->rollBack();
                error_json('Par de co-oferta inválido', 400);
            }
            $a = (int) $par[0];
            $b = (int) $par[1];
            if ($puedeEscribir($a)) {
                $del->execute([$a, $b]);
            }
        }

        // INSERT IGNORE en vez de Prefer: resolution=merge-duplicates: la fila
        // no tiene más columnas que la propia llave, así que "ya existe" y "se
        // actualizó" son lo mismo.
        $ins = $pdo->prepare('INSERT IGNORE INTO materia_co_oferta (materia_id, co_ofertada_id) VALUES (?, ?)');
        foreach ($agregar as $par) {
            if (!is_array($par) || count($par) !== 2) {
                $pdo->rollBack();
                error_json('Par de co-oferta inválido', 400);
            }
            $a = (int) $par[0];
            $b = (int) $par[1];
            if ($a === $b) {
                $pdo->rollBack();
                error_json('Una materia no puede ser co-oferta de sí misma', 400);
            }
            if ($puedeEscribir($a)) {
                $ins->execute([$a, $b]);
            }
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fallo_interno('materias.php co_oferta', $e, 'No se pudieron guardar las equivalencias');
    }

    responder(['ok' => true, 'omitidos' => array_values(array_unique($omitidos))]);
}

// -----------------------------------------------------------------------------
// POST: crear
// -----------------------------------------------------------------------------

if ($metodo === 'POST') {
    $body    = cuerpo_json();
    $deptoId = isset($body['departamento_id'])
        ? (int) $body['departamento_id']
        : (int) departamento_objetivo();
    exigir_jefe_de($deptoId);

    $campos = campos_materia($body, false);

    try {
        $pdo->prepare(
            'INSERT INTO materia (clave, nombre, creditos, departamento_id, anual, tipo_salon_requerido, activa)
             VALUES (?,?,?,?,?,?,?)'
        )->execute([
            $campos['clave'], $campos['nombre'], $campos['creditos'], $deptoId,
            $campos['anual'], $campos['tipo_salon_requerido'], $campos['activa'],
        ]);
    } catch (Throwable $e) {
        if (es_clave_duplicada($e)) {
            error_json(
                'La clave ' . $campos['clave'] . ' ya existe en el sistema (puede ser de otro departamento). Usa otra.',
                409,
                'clave_duplicada'
            );
        }
        fallo_interno('materias.php POST', $e, 'No se pudo crear la materia');
    }

    $creada = materia_por_id($pdo, (int) $pdo->lastInsertId());
    responder(['materia' => $creada], 201);
}

// -----------------------------------------------------------------------------
// PATCH ?id=N: editar
// -----------------------------------------------------------------------------

$materiaId = param_id('id');
$deptoDeLaMateria = departamento_de_materia($materiaId);
if ($deptoDeLaMateria === null) {
    error_json('No existe esa materia', 404);
}
exigir_jefe_de($deptoDeLaMateria);

$campos = campos_materia(cuerpo_json(), true);
if ($campos === []) {
    // Nada que cambiar no es un error: la pantalla manda solo el diff y puede
    // llegar vacío si alguien guardó dos veces seguidas.
    responder(['materia' => materia_por_id($pdo, $materiaId)]);
}

$asignaciones = [];
$valores = [];
foreach ($campos as $columna => $valor) {
    // Las llaves de $campos salen de campos_materia(), nunca del cuerpo: no hay
    // forma de que un nombre de columna llegue desde el navegador.
    $asignaciones[] = "$columna = ?";
    $valores[] = $valor;
}
$valores[] = $materiaId;

try {
    $pdo->prepare('UPDATE materia SET ' . implode(', ', $asignaciones) . ' WHERE id = ?')
        ->execute($valores);
} catch (Throwable $e) {
    if (es_clave_duplicada($e)) {
        error_json(
            'La clave ' . (isset($campos['clave']) ? $campos['clave'] : '') . ' ya existe en el sistema (puede ser de otro departamento). Usa otra.',
            409,
            'clave_duplicada'
        );
    }
    fallo_interno('materias.php PATCH', $e, 'No se pudo guardar la materia');
}

responder(['materia' => materia_por_id($pdo, $materiaId)]);
