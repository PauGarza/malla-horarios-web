<?php
// =============================================================================
// La frontera con el motor de asignación (D39).
//
// El motor se desarrolla aparte y no toca la base: recibe un JSON de entrada
// que se descarga de aquí (api/motor-entrada.php) y devuelve un JSON de salida
// que se sube de regreso (api/motor-salida.php). El formato exacto vive en
// malla-horarios/docs/convencion-datos-motor.md (versión 2); las secciones que
// se citan aquí (§3.6, §5, ...) son de ese documento.
//
// Este archivo tiene las tres piezas que comparten los dos endpoints:
//
//   motor_armar_entrada()   el paquete autoplanear-entrada/2 (§3)
//   motor_validar_salida()  las reglas duras y blandas de §5, portadas de
//                           malla-horarios/optV0/optv0/validar.py
//   motor_aplicar()         escribe la salida en grupo / imparte / ...
//
// Tres decisiones que la convención no fijaba (D43, D44):
//   - grupos_fijos son los grupos del alcance ya publicados. Los no publicados
//     del alcance no se mandan: la siguiente subida los reemplaza.
//   - Los salones ocupados por grupos de fuera del alcance se RESTAN de
//     salones[].disponible, igual que las horas del profesor van en ocupado.
//   - Modo sin salones: la descarga puede ir con salones: [] y la salida con
//     salon_id null. El grupo queda 'en_asignacion' hasta que haya salones.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const MOTOR_ENTRADA = 'autoplanear-entrada/2';
const MOTOR_SALIDA  = 'autoplanear-salida/2';
const MOTOR_DIAS    = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
const MOTOR_ZONA    = 'America/Mexico_City';
// D49 (2026-10-23): ningún grupo con menos alumnos esperados (Suma de Escolares, claves equivalentes sumadas)
const MOTOR_ALUMNOS_MINIMOS = 15;

// §3.2. Hoy los decide la jefatura y no tienen tabla: van aquí para que el
// motor no los tenga escritos en su código.
const MOTOR_REGLAS = [
    'max_horas_asignatura'      => 10,
    'sin_respuesta_cuenta_como' => 'rojo',   // D37
    'bloques_por_credito'       => 1,        // D36
    'minutos_por_bloque'        => 30,
];

const MOTOR_NOMBRE_TIPO = ['primavera' => 'Primavera', 'verano' => 'Verano', 'otono' => 'Otoño'];

/** Cuántos mensajes de un mismo tipo se mandan al navegador (el total va aparte). */
const MOTOR_MAX_MENSAJES = 50;

// -----------------------------------------------------------------------------
// Ayudantes
// -----------------------------------------------------------------------------

function motor_marcas(array $valores): string
{
    return implode(',', array_fill(0, count($valores), '?'));
}

function motor_es_lista($a): bool
{
    return is_array($a) && ($a === [] || array_keys($a) === range(0, count($a) - 1));
}

/** Ahora, en hora de la Ciudad de México, como va en generado_at. */
function motor_ahora(): string
{
    return (new DateTime('now', new DateTimeZone(MOTOR_ZONA)))->format('Y-m-d\TH:i:sP');
}

/** Un DATETIME de la base (UTC) en hora de la Ciudad de México, ISO 8601. */
function motor_hora_local(?string $utc): ?string
{
    if ($utc === null) {
        return null;
    }
    $d = new DateTime($utc, new DateTimeZone('UTC'));
    $d->setTimezone(new DateTimeZone(MOTOR_ZONA));
    return $d->format('Y-m-d\TH:i:sP');
}

/**
 * Los departamentos de un alcance ("1,2,3" o [1,2,3]), ordenados y sin
 * repetir. Corta con 400 si alguno no existe.
 */
function motor_departamentos(PDO $pdo, $valor): array
{
    if (is_string($valor)) {
        $partes = explode(',', $valor);
    } elseif (is_array($valor)) {
        $partes = $valor;
    } else {
        error_json('Faltan los departamentos', 400);
    }
    $ids = [];
    foreach ($partes as $p) {
        $id = is_int($p) ? $p : filter_var(trim((string) $p), FILTER_VALIDATE_INT);
        if ($id === false || $id < 1) {
            error_json('Los departamentos no son válidos', 400);
        }
        $ids[$id] = true;
    }
    $ids = array_keys($ids);
    sort($ids);
    if ($ids === []) {
        error_json('Faltan los departamentos', 400);
    }
    $st = $pdo->prepare('SELECT COUNT(*) FROM departamento WHERE id IN (' . motor_marcas($ids) . ')');
    $st->execute($ids);
    if ((int) $st->fetchColumn() !== count($ids)) {
        error_json('Alguno de esos departamentos no existe', 400);
    }
    return $ids;
}

// -----------------------------------------------------------------------------
// La rejilla y las sesiones
//
// Una hora se nombra por su inicio ("07:30"), nunca por franja_id ni por
// índice (§1). Una sesión es un bloque continuo: { dia, inicio, bloques }.
// -----------------------------------------------------------------------------

function motor_rejilla(PDO $pdo): array
{
    $lista = [];
    $filas = $pdo->query(
        'SELECT id, hora_inicio, hora_fin, orden, dias, departamento_id FROM franja_horaria ORDER BY orden'
    )->fetchAll();
    foreach ($filas as $f) {
        $lista[] = [
            'id'              => (int) $f['id'],
            'inicio'          => substr((string) $f['hora_inicio'], 0, 5),
            'fin'             => substr((string) $f['hora_fin'], 0, 5),
            'orden'           => (int) $f['orden'],
            'dias'            => ($f['dias'] === null || $f['dias'] === '') ? null : explode(',', (string) $f['dias']),
            'departamento_id' => $f['departamento_id'] === null ? null : (int) $f['departamento_id'],
        ];
    }
    $porInicio = [];
    $porId     = [];
    $siguiente = [];
    $porOrden  = [];
    foreach ($lista as $i => $f) {
        $porInicio[$f['inicio']] = $f;
        $porId[$f['id']]         = $f;
        $porOrden[$f['orden']]   = $f;
        if (isset($lista[$i + 1])) {
            $siguiente[$f['inicio']] = $lista[$i + 1];
        }
    }
    return [
        'lista'      => $lista,
        'por_inicio' => $porInicio,
        'por_id'     => $porId,
        'por_orden'  => $porOrden,
        'siguiente'  => $siguiente,
    ];
}

/** ¿Esa franja existe ese día y para ese departamento? (D31, D32) */
function motor_franja_vale(array $f, string $dia, ?int $depto): bool
{
    if ($f['dias'] !== null && !in_array($dia, $f['dias'], true)) {
        return false;
    }
    return $f['departamento_id'] === null || $f['departamento_id'] === $depto;
}

/**
 * Bloques de 30 min -> sesiones contiguas. Dos bloques son de la misma sesión
 * si el fin de uno es el inicio del otro (así la comida corta la sesión) y, si
 * los bloques traen salon_id, si es el mismo salón.
 *
 * @param array $bloques lista de ['dia' => , 'franja_id' => , 'salon_id' => (opcional)]
 * @return array lista de ['dia', 'inicio', 'bloques'] (+ 'salon_id' si venía)
 */
function motor_sesiones(array $rej, array $bloques): array
{
    $porDia = [];
    foreach ($bloques as $b) {
        if (isset($rej['por_id'][$b['franja_id']])) {
            $porDia[$b['dia']][$b['franja_id']] = $b;
        }
    }
    $sesiones = [];
    foreach (MOTOR_DIAS as $dia) {
        if (empty($porDia[$dia])) {
            continue;
        }
        $lista = array_values($porDia[$dia]);
        usort($lista, function ($a, $b) use ($rej) {
            return $rej['por_id'][$a['franja_id']]['orden'] <=> $rej['por_id'][$b['franja_id']]['orden'];
        });
        $actual = null;
        $finPrevio = null;
        $salonPrevio = null;
        foreach ($lista as $b) {
            $f = $rej['por_id'][$b['franja_id']];
            $conSalon = array_key_exists('salon_id', $b);
            $salon = $conSalon ? $b['salon_id'] : null;
            if ($actual !== null && $finPrevio === $f['inicio'] && $salon === $salonPrevio) {
                $actual['bloques']++;
            } else {
                if ($actual !== null) {
                    $sesiones[] = $actual;
                }
                $actual = ['dia' => $dia, 'inicio' => $f['inicio'], 'bloques' => 1];
                if ($conSalon) {
                    $actual['salon_id'] = $salon;
                }
            }
            $finPrevio = $f['fin'];
            $salonPrevio = $salon;
        }
        $sesiones[] = $actual;
    }
    return $sesiones;
}

/**
 * Como motor_sesiones(), pero con el salón al estilo de §4.2: el más usado va
 * como salon_id del grupo, y solo las sesiones en otro salón lo llevan dentro.
 *
 * @return array [salon_id del grupo, sesiones]
 */
function motor_sesiones_con_salon(array $rej, array $bloques): array
{
    $sesiones = motor_sesiones($rej, $bloques);
    $usos = [];
    foreach ($sesiones as $s) {
        if ($s['salon_id'] !== null) {
            $usos[$s['salon_id']] = ($usos[$s['salon_id']] ?? 0) + $s['bloques'];
        }
    }
    arsort($usos);
    $principal = $usos === [] ? null : (int) array_key_first($usos);
    foreach ($sesiones as &$s) {
        if ($s['salon_id'] === $principal) {
            unset($s['salon_id']);
        }
    }
    unset($s);
    return [$principal, $sesiones];
}

/**
 * Los bloques [dia, inicio] de una sesión, o null si la sesión está mal
 * formada, sale de la rejilla o cruza un hueco (la comida).
 */
function motor_bloques_de_sesion(array $rej, $ses): ?array
{
    if (!is_array($ses) || !isset($ses['dia'], $ses['inicio'], $ses['bloques'])) {
        return null;
    }
    if (!in_array($ses['dia'], MOTOR_DIAS, true) || !is_string($ses['inicio'])
        || !is_int($ses['bloques']) || $ses['bloques'] < 1 || $ses['bloques'] > 40) {
        return null;
    }
    $h = $ses['inicio'];
    $out = [];
    for ($k = 0; $k < $ses['bloques']; $k++) {
        if (!isset($rej['por_inicio'][$h])) {
            return null;
        }
        $out[] = [$ses['dia'], $h];
        if ($k + 1 < $ses['bloques']) {
            $sig = $rej['siguiente'][$h] ?? null;
            if ($sig === null || $rej['por_inicio'][$h]['fin'] !== $sig['inicio']) {
                return null;
            }
            $h = $sig['inicio'];
        }
    }
    return $out;
}

function motor_txt_sesion($s): string
{
    if (!is_array($s)) {
        return json_encode($s, JSON_UNESCAPED_UNICODE);
    }
    return ($s['dia'] ?? '?') . ' ' . ($s['inicio'] ?? '?') . ' × ' . ($s['bloques'] ?? '?');
}

// -----------------------------------------------------------------------------
// Lo que ya existe en grupo / imparte del semestre, agrupado por clase física
//
// Un grupo espejo son varias filas de grupo (una por clave) ligadas por
// imparte_co_oferta. Para el motor es UNA clase, así que se juntan.
// -----------------------------------------------------------------------------

function motor_clases(PDO $pdo, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT g.id, g.materia_id, g.numero, g.cupo_maximo, g.estado, g.publicado,
                m.clave, m.departamento_id, d.nombre AS departamento, i.id AS imparte_id
           FROM grupo g
           JOIN materia m      ON m.id = g.materia_id
           JOIN departamento d ON d.id = m.departamento_id
           LEFT JOIN imparte i ON i.grupo_id = g.id
          WHERE g.semestre_id = ?
          ORDER BY m.clave, g.numero, g.id'
    );
    $st->execute([$semestreId]);
    $grupos = [];
    $grupoDeImparte = [];
    foreach ($st->fetchAll() as $g) {
        $id = (int) $g['id'];
        $grupos[$id] = [
            'id'              => $id,
            'materia_id'      => (int) $g['materia_id'],
            'clave'           => $g['clave'],
            'numero'          => $g['numero'],
            'cupo_maximo'     => $g['cupo_maximo'] === null ? null : (int) $g['cupo_maximo'],
            'estado'          => $g['estado'],
            'publicado'       => (int) $g['publicado'] === 1,
            'departamento_id' => (int) $g['departamento_id'],
            'departamento'    => $g['departamento'],
            'imparte_id'      => $g['imparte_id'] === null ? null : (int) $g['imparte_id'],
            'porcentaje'      => null,
        ];
        if ($g['imparte_id'] !== null) {
            $grupoDeImparte[(int) $g['imparte_id']] = $id;
        }
    }
    if ($grupos === []) {
        return [];
    }

    // Union-find sobre los vínculos de co-oferta.
    $padre = [];
    foreach ($grupos as $id => $_) {
        $padre[$id] = $id;
    }
    $raiz = function (int $x) use (&$padre): int {
        while ($padre[$x] !== $x) {
            $padre[$x] = $padre[$padre[$x]];
            $x = $padre[$x];
        }
        return $x;
    };

    $deSemestre = 'JOIN imparte i ON i.id = t.imparte_id JOIN grupo g ON g.id = i.grupo_id WHERE g.semestre_id = ?';

    $st = $pdo->prepare("SELECT t.imparte_id, t.imparte_relacionado_id, t.porcentaje_responsabilidad
                           FROM imparte_co_oferta t $deSemestre");
    $st->execute([$semestreId]);
    foreach ($st->fetchAll() as $c) {
        $a = $grupoDeImparte[(int) $c['imparte_id']] ?? null;
        $b = $grupoDeImparte[(int) $c['imparte_relacionado_id']] ?? null;
        if ($a === null || $b === null) {
            continue;
        }
        $grupos[$a]['porcentaje'] = (float) $c['porcentaje_responsabilidad'];
        $ra = $raiz($a);
        $rb = $raiz($b);
        if ($ra !== $rb) {
            $padre[$rb] = $ra;
        }
    }

    // "Profesor por asignar" (2026-10-23) no se cuenta: la clase queda sin
    // profesor, que es lo que significa (§4.2, profesores vacío).
    $profesores = [];
    $st = $pdo->prepare(
        "SELECT t.imparte_id, t.profesor_id FROM imparte_profesor t
           JOIN profesor pa ON pa.id = t.profesor_id AND pa.por_asignar = 0
         $deSemestre ORDER BY t.profesor_id"
    );
    $st->execute([$semestreId]);
    foreach ($st->fetchAll() as $p) {
        $profesores[(int) $p['imparte_id']][] = (int) $p['profesor_id'];
    }

    $horario = [];
    $st = $pdo->prepare("SELECT t.imparte_id, t.dia, t.franja_id, t.salon_id FROM imparte_horario t $deSemestre");
    $st->execute([$semestreId]);
    foreach ($st->fetchAll() as $h) {
        $horario[(int) $h['imparte_id']][] = [
            'dia'       => $h['dia'],
            'franja_id' => (int) $h['franja_id'],
            'salon_id'  => $h['salon_id'] === null ? null : (int) $h['salon_id'],
        ];
    }

    $clases = [];
    foreach ($grupos as $id => $g) {
        $r = $raiz($id);
        if (!isset($clases[$r])) {
            $clases[$r] = ['grupos' => [], 'profesores' => [], 'bloques' => []];
        }
        $clases[$r]['grupos'][] = $g;
        $iid = $g['imparte_id'];
        foreach ($iid === null ? [] : ($profesores[$iid] ?? []) as $p) {
            if (!in_array($p, $clases[$r]['profesores'], true)) {
                $clases[$r]['profesores'][] = $p;
            }
        }
        foreach ($iid === null ? [] : ($horario[$iid] ?? []) as $b) {
            $llave = $b['dia'] . '|' . $b['franja_id'];
            if (!isset($clases[$r]['bloques'][$llave])) {
                $clases[$r]['bloques'][$llave] = $b;
            }
        }
    }
    foreach ($clases as &$c) {
        $c['bloques'] = array_values($c['bloques']);
        sort($c['profesores']);
        // La clave principal primero: la de más responsabilidad.
        usort($c['grupos'], function ($a, $b) {
            return [-($a['porcentaje'] ?? 100), $a['id']] <=> [-($b['porcentaje'] ?? 100), $b['id']];
        });
    }
    unset($c);
    return array_values($clases);
}

/**
 * Reparte las clases del semestre según el alcance:
 *   fijos      tienen una clave del alcance y ya se publicaron: no se mueven.
 *   reemplazo  tienen una clave del alcance y no se publicaron: la siguiente
 *              subida las borra (con sus espejos de otros departamentos).
 *   externas   ninguna clave del alcance: ocupan profesor y salón (§3.6 ocupado).
 * Las clases canceladas no ocupan nada.
 */
function motor_clasificar(array $clases, array $deptos): array
{
    $r = ['fijos' => [], 'reemplazo' => [], 'externas' => []];
    foreach ($clases as $c) {
        $enAlcance = false;
        $publicada = false;
        $cancelada = true;
        foreach ($c['grupos'] as $g) {
            $enAlcance = $enAlcance || in_array($g['departamento_id'], $deptos, true);
            $publicada = $publicada || $g['publicado'];
            $cancelada = $cancelada && $g['estado'] === 'cancelado';
        }
        if ($enAlcance && !$publicada) {
            $r['reemplazo'][] = $c;
        } elseif ($cancelada) {
            continue;
        } elseif ($enAlcance) {
            $r['fijos'][] = $c;
        } else {
            $r['externas'][] = $c;
        }
    }
    return $r;
}

/** Una clase de la base en el formato de un grupo de la salida (§4.2), para grupos_fijos. */
function motor_grupo_de_clase(array $rej, array $clase): array
{
    $principal = $clase['grupos'][0];
    $varias = count($clase['grupos']) > 1;
    $materias = [];
    foreach ($clase['grupos'] as $g) {
        $m = ['materia_id' => $g['materia_id'], 'clave' => $g['clave'], 'numero' => $g['numero']];
        if ($varias && $g['porcentaje'] !== null) {
            $m['porcentaje'] = $g['porcentaje'];
        }
        $materias[] = $m;
    }
    list($salon, $sesiones) = motor_sesiones_con_salon($rej, $clase['bloques']);
    return [
        'ref'                => 'fijo-' . $principal['id'],
        'grupo_id'           => $principal['id'],
        'asignacion_fija_id' => null,
        'materias'           => $materias,
        'profesores'         => $clase['profesores'],
        'salon_id'           => $salon,
        'sesiones'           => $sesiones,
        'cupo_maximo'        => $principal['cupo_maximo'],
    ];
}

// -----------------------------------------------------------------------------
// §3 — El paquete de entrada
// -----------------------------------------------------------------------------

/**
 * Arma el paquete autoplanear-entrada/2. Devuelve arreglos de PHP; para
 * mandarlo, pasarlo por motor_entrada_json() (los mapas vacíos tienen que
 * salir como {} y no como []).
 *
 * Todo va con ORDER BY: la huella (motor_huella) depende de que dos
 * descargas con los mismos datos salgan idénticas.
 */
function motor_armar_entrada(
    PDO $pdo,
    array $rej,
    array $semestre,
    array $deptos,
    bool $conSalones,
    string $generadoAt,
    array $generadoPor
): array {
    $semestreId = (int) $semestre['id'];
    $enDeptos = motor_marcas($deptos);

    // --- departamentos ---
    $st = $pdo->prepare("SELECT id, nombre, clave_prefijo FROM departamento WHERE id IN ($enDeptos) ORDER BY id");
    $st->execute($deptos);
    $departamentos = [];
    $nombreDepto = [];
    foreach ($st->fetchAll() as $d) {
        $departamentos[] = ['id' => (int) $d['id'], 'nombre' => $d['nombre'], 'clave_prefijo' => $d['clave_prefijo']];
        $nombreDepto[(int) $d['id']] = $d['nombre'];
    }

    // --- lo que ya existe en grupo/imparte ---
    $clases = motor_clasificar(motor_clases($pdo, $semestreId), $deptos);

    // --- materias (§3.4) ---
    // Las activas del alcance con demanda cargada, las de las asignaciones
    // fijas y de los grupos publicados (aunque no tengan demanda), y sus
    // co-ofertas aunque sean de otro departamento. Las de fuera del alcance van sin demanda: el motor no les
    // abre grupos propios, solo las usa como espejo.
    $coOferta = [];
    foreach ($pdo->query('SELECT materia_id, co_ofertada_id FROM materia_co_oferta')->fetchAll() as $c) {
        $a = (int) $c['materia_id'];
        $b = (int) $c['co_ofertada_id'];
        $coOferta[$a][$b] = true;
        $coOferta[$b][$a] = true;
    }

    $st = $pdo->prepare(
        "SELECT ed.materia_id FROM estimacion_demanda ed JOIN materia m ON m.id = ed.materia_id
          WHERE ed.semestre_id = ? AND m.activa = 1 AND m.departamento_id IN ($enDeptos)"
    );
    $st->execute(array_merge([$semestreId], $deptos));
    $ids = [];
    foreach ($st->fetchAll() as $f) {
        $ids[(int) $f['materia_id']] = true;
    }
    $st = $pdo->prepare(
        "SELECT materia_id FROM asignacion_fija
          WHERE semestre_id = ? AND tipo = 'materia' AND departamento_id IN ($enDeptos)"
    );
    $st->execute(array_merge([$semestreId], $deptos));
    $forzadas = [];
    foreach ($st->fetchAll() as $f) {
        $forzadas[(int) $f['materia_id']] = true;
    }
    foreach ($clases['fijos'] as $c) {
        foreach ($c['grupos'] as $g) {
            $forzadas[$g['materia_id']] = true;
        }
    }
    $ids += $forzadas;
    foreach (array_keys($ids) as $id) {
        foreach (array_keys($coOferta[$id] ?? []) as $par) {
            $ids[$par] = $ids[$par] ?? true;
        }
    }

    $materias = [];
    if ($ids !== []) {
        $lista = array_keys($ids);
        $st = $pdo->prepare(
            'SELECT m.id, m.clave, m.nombre, m.departamento_id, m.creditos, m.anual, m.tipo_salon_requerido, m.activa,
                    ed.grupos_sugeridos, ed.grupos_periodo_anterior, ed.alumnos_total, ed.demanda_ajustada,
                    ed.capacidad_planeacion
               FROM materia m
               LEFT JOIN estimacion_demanda ed ON ed.materia_id = m.id AND ed.semestre_id = ?
              WHERE m.id IN (' . motor_marcas($lista) . ')
              ORDER BY m.clave'
        );
        $st->execute(array_merge([$semestreId], $lista));
        $filas = $st->fetchAll();

        // §3.4. Todas las versiones de cada plan: cuáles cuentan (la vigente, la
        // anterior...) lo decide el motor, con clave ('ACT-H') y vigente.
        $planes = [];
        $st = $pdo->prepare(
            'SELECT pem.materia_id, pe.clave, pe.nombre, pe.activo, pem.semestre_plan
               FROM plan_estudio_materia pem JOIN plan_estudio pe ON pe.id = pem.plan_estudio_id
              WHERE pem.materia_id IN (' . motor_marcas($lista) . ')
              ORDER BY pem.materia_id, pe.clave, pe.nombre'
        );
        $st->execute($lista);
        foreach ($st->fetchAll() as $p) {
            $planes[(int) $p['materia_id']][] = [
                'plan'          => $p['nombre'],
                'clave'         => $p['clave'],
                'vigente'       => (int) $p['activo'] === 1,
                'semestre_plan' => (int) $p['semestre_plan'],
            ];
        }

        // Un espejo de otro departamento que ya no está activo no se manda.
        $incluidas = [];
        foreach ($filas as $m) {
            $propia = in_array((int) $m['departamento_id'], $deptos, true);
            if ($propia || (int) $m['activa'] === 1 || isset($forzadas[(int) $m['id']])) {
                $incluidas[(int) $m['id']] = true;
            }
        }
        foreach ($filas as $m) {
            $id = (int) $m['id'];
            if (!isset($incluidas[$id])) {
                continue;
            }
            $propia = in_array((int) $m['departamento_id'], $deptos, true);
            $pares = array_values(array_filter(
                array_keys($coOferta[$id] ?? []),
                function ($p) use ($incluidas) { return isset($incluidas[$p]); }
            ));
            sort($pares);
            $materias[] = [
                'id'                   => $id,
                'clave'                => $m['clave'],
                'nombre'               => $m['nombre'],
                'departamento_id'      => (int) $m['departamento_id'],
                'creditos'             => (int) $m['creditos'],
                'anual'                => (int) $m['anual'] === 1,
                'tipo_salon_requerido' => $m['tipo_salon_requerido'],
                'co_oferta'            => $pares,
                'planes'               => $planes[$id] ?? [],
                'demanda'              => ($propia && $m['grupos_sugeridos'] !== null) ? [
                    'grupos_sugeridos'        => (int) $m['grupos_sugeridos'],
                    'grupos_periodo_anterior' => (int) $m['grupos_periodo_anterior'],
                    'alumnos_total'           => (int) $m['alumnos_total'],
                    'demanda_ajustada'        => $m['demanda_ajustada'] === null ? null : (float) $m['demanda_ajustada'],
                    'capacidad_planeacion'    => $m['capacidad_planeacion'] === null ? null : (int) $m['capacidad_planeacion'],
                ] : null,
            ];
        }
    }
    $enPaquete = [];
    foreach ($materias as $m) {
        $enPaquete[$m['id']] = true;
    }

    // --- salones (§3.5) ---
    $salones = [];
    if ($conSalones) {
        $ocupados = [];
        foreach ($clases['externas'] as $c) {
            foreach ($c['bloques'] as $b) {
                if ($b['salon_id'] !== null) {
                    $ocupados[$b['salon_id'] . '|' . $b['dia'] . '|' . $b['franja_id']] = true;
                }
            }
        }
        $st = $pdo->prepare(
            "SELECT s.id, s.nombre, s.edificio, s.capacidad, s.tipo, sdd.departamento_id, sdd.dia, sdd.franja_id
               FROM salon s
               JOIN salon_disponibilidad_departamento sdd ON sdd.salon_id = s.id
               JOIN franja_horaria f ON f.id = sdd.franja_id
              WHERE s.activo = 1 AND sdd.semestre_id = ? AND sdd.departamento_id IN ($enDeptos)
              ORDER BY s.nombre, s.id, sdd.departamento_id,
                       FIELD(sdd.dia, 'lunes','martes','miercoles','jueves','viernes'), f.orden"
        );
        $st->execute(array_merge([$semestreId], $deptos));
        foreach ($st->fetchAll() as $f) {
            $id = (int) $f['id'];
            if (!isset($salones[$id])) {
                $salones[$id] = [
                    'id'         => $id,
                    'nombre'     => $f['nombre'],
                    'edificio'   => $f['edificio'],
                    'capacidad'  => (int) $f['capacidad'],
                    'tipo'       => $f['tipo'],
                    'disponible' => [],
                ];
            }
            if (isset($ocupados[$id . '|' . $f['dia'] . '|' . (int) $f['franja_id']])) {
                continue;
            }
            $salones[$id]['disponible'][(int) $f['departamento_id']][$f['dia']][] =
                $rej['por_id'][(int) $f['franja_id']]['inicio'];
        }
        $salones = array_values($salones);
    }

    // --- profesores (§3.6) ---
    $st = $pdo->prepare(
        "SELECT p.id, p.cu, p.nombre, p.departamento_id, p.tipo_contrato, p.estado_especial,
                pref.estado, pref.enviado_at, pref.num_cursos_max, anc.num_cursos AS ajuste
           FROM profesor p
           LEFT JOIN preferencia pref     ON pref.profesor_id = p.id AND pref.semestre_id = ?
           LEFT JOIN ajuste_num_cursos anc ON anc.profesor_id = p.id AND anc.semestre_id = ?
          WHERE p.activo = 1 AND p.tipo_contrato IS NOT NULL AND p.departamento_id IN ($enDeptos)
          ORDER BY p.nombre, p.id"
    );
    $st->execute(array_merge([$semestreId, $semestreId], $deptos));
    $profesores = [];
    foreach ($st->fetchAll() as $p) {
        $ajuste = $p['ajuste'] === null ? null : (int) $p['ajuste'];
        $propio = $p['num_cursos_max'] === null ? null : (int) $p['num_cursos_max'];
        if ($p['estado'] === null && $ajuste === null) {
            $preferencia = null;
        } else {
            // §3.9.2: num_cursos_max ya es el que manda.
            $preferencia = [
                'estado'            => $p['estado'] === null ? 'no_iniciado' : $p['estado'],
                'enviado_at'        => motor_hora_local($p['enviado_at']),
                'num_cursos_max'    => $ajuste !== null ? $ajuste : $propio,
                'num_cursos_origen' => $ajuste !== null ? 'jefatura' : ($propio !== null ? 'profesor' : null),
            ];
        }
        $profesores[(int) $p['id']] = [
            'id'                      => (int) $p['id'],
            'cu'                      => $p['cu'],
            'nombre'                  => $p['nombre'],
            'departamento_id'         => (int) $p['departamento_id'],
            'tipo_contrato'           => $p['tipo_contrato'],
            'estado_especial'         => $p['estado_especial'],
            'preferencia'             => $preferencia,
            'disponibilidad'          => [],
            'materias'                => [],
            'cobertura_departamental' => [],
            'bloqueos'                => [],
            'verdes_jefatura'         => [],
            'ocupado'                 => [],
            'maestria'                => [],
        ];
    }

    // Disponibilidad: lo que marcó, y encima las horas de maestría en rojo
    // (§3.9.1). Solo en el paquete: la base no se toca. Las de maestría van
    // además en profesores[].maestria (2026-10-21): una asignación directa sin
    // horario puede caer en rojo del profesor (la jefatura manda), pero nunca
    // encima de su maestría, y el motor necesita distinguirlas.
    $celdas = [];
    $st = $pdo->prepare(
        "SELECT pref.profesor_id, d.dia, d.franja_id, d.nivel
           FROM preferencia pref
           JOIN profesor p ON p.id = pref.profesor_id
           JOIN disponibilidad d ON d.preferencia_id = pref.id
          WHERE pref.semestre_id = ? AND p.departamento_id IN ($enDeptos)"
    );
    $st->execute(array_merge([$semestreId], $deptos));
    foreach ($st->fetchAll() as $c) {
        $celdas[(int) $c['profesor_id']][$c['dia']][(int) $c['franja_id']] = $c['nivel'];
    }
    $st = $pdo->prepare(
        "SELECT af.profesor_id, afh.dia, afh.franja_id
           FROM asignacion_fija af JOIN asignacion_fija_horario afh ON afh.asignacion_fija_id = af.id
          WHERE af.semestre_id = ? AND af.tipo = 'maestria'"
    );
    $st->execute([$semestreId]);
    $maestria = [];
    foreach ($st->fetchAll() as $c) {
        $celdas[(int) $c['profesor_id']][$c['dia']][(int) $c['franja_id']] = 'rojo';
        $maestria[(int) $c['profesor_id']][$c['dia']][(int) $c['franja_id']] = true;
    }
    foreach ($profesores as $id => &$p) {
        foreach (MOTOR_DIAS as $dia) {
            foreach ($rej['lista'] as $f) {
                if (isset($celdas[$id][$dia][$f['id']])) {
                    $p['disponibilidad'][$dia][$f['inicio']] = $celdas[$id][$dia][$f['id']];
                }
                if (isset($maestria[$id][$dia][$f['id']])) {
                    $p['maestria'][$dia][] = $f['inicio'];
                }
            }
        }
    }
    unset($p);

    $st = $pdo->prepare(
        "SELECT pref.profesor_id, pm.materia_id, pm.nivel, pm.cobertura_departamental
           FROM preferencia pref
           JOIN profesor p ON p.id = pref.profesor_id
           JOIN preferencia_materia pm ON pm.preferencia_id = pref.id
          WHERE pref.semestre_id = ? AND p.departamento_id IN ($enDeptos)
          ORDER BY pref.profesor_id, pm.materia_id"
    );
    $st->execute(array_merge([$semestreId], $deptos));
    foreach ($st->fetchAll() as $m) {
        $pid = (int) $m['profesor_id'];
        $mid = (int) $m['materia_id'];
        if (!isset($profesores[$pid]) || !isset($enPaquete[$mid])) {
            continue;
        }
        $profesores[$pid]['materias'][$mid] = $m['nivel'];
        if ((int) $m['cobertura_departamental'] === 1) {
            $profesores[$pid]['cobertura_departamental'][] = $mid;
        }
    }

    $st = $pdo->prepare('SELECT profesor_id, materia_id FROM bloqueo_profesor_materia WHERE semestre_id = ? ORDER BY profesor_id, materia_id');
    $st->execute([$semestreId]);
    foreach ($st->fetchAll() as $b) {
        $pid = (int) $b['profesor_id'];
        $mid = (int) $b['materia_id'];
        if (isset($profesores[$pid]) && isset($enPaquete[$mid])) {
            $profesores[$pid]['bloqueos'][] = $mid;
        }
    }

    // Verdes de jefatura (2026-10-21): mandan sobre lo que contestó el
    // profesor, así que en materias quedan como 'verde' y el algoritmo no
    // tiene que distinguirlos. verdes_jefatura dice cuáles fueron, solo para
    // leer el paquete. Van antes de la co-oferta para que la clave oculta
    // herede el verde igual que una marca del profesor.
    $st = $pdo->prepare('SELECT profesor_id, materia_id FROM verde_profesor_materia WHERE semestre_id = ? ORDER BY profesor_id, materia_id');
    $st->execute([$semestreId]);
    foreach ($st->fetchAll() as $v) {
        $pid = (int) $v['profesor_id'];
        $mid = (int) $v['materia_id'];
        if (isset($profesores[$pid]) && isset($enPaquete[$mid])) {
            $profesores[$pid]['materias'][$mid] = 'verde';
            $profesores[$pid]['verdes_jefatura'][] = $mid;
        }
    }

    // Co-oferta con una clave oculta: las claves de un par SON la misma clase,
    // y si la jefatura muestra solo una en el cuestionario (EST-13102 visible,
    // EST-13101 oculta) la demanda puede estar en la que nadie pudo marcar.
    // La clave OCULTA hereda de su co-oferta la marca (si sus co-ofertas traen
    // colores distintos, la más restrictiva) y los bloqueos. Las visibles no se
    // tocan: en Matemáticas la co-oferta es una red de pares, no grupos
    // cerrados, y la jefatura bloquea clave por clave a propósito. Solo en el
    // paquete: la base no se toca.
    $st = $pdo->prepare('SELECT materia_id FROM materia_cuestionario WHERE semestre_id = ? AND seccion_id IS NULL');
    $st->execute([$semestreId]);
    $ocultas = [];
    foreach ($st->fetchAll() as $f) {
        $ocultas[(int) $f['materia_id']] = true;
    }
    $rango = ['verde' => 0, 'amarillo' => 1, 'rojo' => 2];
    foreach ($profesores as &$p) {
        $marcadas = $p['materias'];
        $cobertura = array_flip($p['cobertura_departamental']);
        foreach ($marcadas as $mid => $nivel) {
            foreach (array_keys($coOferta[$mid] ?? []) as $par) {
                if (!isset($ocultas[$par]) || !isset($enPaquete[$par]) || isset($marcadas[$par])) {
                    continue;
                }
                $actual = $p['materias'][$par] ?? null;
                if ($actual === null || $rango[$nivel] > $rango[$actual]) {
                    $p['materias'][$par] = $nivel;
                }
                if (isset($cobertura[$mid]) && !in_array($par, $p['cobertura_departamental'], true)) {
                    $p['cobertura_departamental'][] = $par;
                }
            }
        }
        foreach ($p['bloqueos'] as $mid) {
            foreach (array_keys($coOferta[$mid] ?? []) as $par) {
                if (isset($ocultas[$par]) && isset($enPaquete[$par]) && !in_array($par, $p['bloqueos'], true)) {
                    $p['bloqueos'][] = $par;
                }
            }
        }
        ksort($p['materias']);
        sort($p['cobertura_departamental']);
        sort($p['bloqueos']);
    }
    unset($p);

    // ocupado: clases de fuera del alcance.
    foreach ($clases['externas'] as $c) {
        $g = $c['grupos'][0];
        $motivo = "{$g['clave']} · {$g['numero']} ({$g['departamento']})";
        $bloques = array_map(function ($b) {
            return ['dia' => $b['dia'], 'franja_id' => $b['franja_id']];
        }, $c['bloques']);
        foreach ($c['profesores'] as $pid) {
            if (!isset($profesores[$pid])) {
                continue;
            }
            foreach (motor_sesiones($rej, $bloques) as $s) {
                $profesores[$pid]['ocupado'][] = $s + ['motivo' => $motivo];
            }
        }
    }
    $ordenDia = array_flip(MOTOR_DIAS);
    foreach ($profesores as &$p) {
        usort($p['ocupado'], function ($a, $b) use ($ordenDia) {
            return [$ordenDia[$a['dia']], $a['inicio'], $a['motivo']] <=> [$ordenDia[$b['dia']], $b['inicio'], $b['motivo']];
        });
    }
    unset($p);

    // --- grupos_fijos (§3.7) ---
    // Solo con los profesores que vienen en profesores[] (§3.7): un profesor
    // sin cuenta (Actuaría, D45) o un co-titular de un departamento de fuera
    // del alcance no está en el paquete y el motor no puede asignarle nada.
    $gruposFijos = [];
    foreach ($clases['fijos'] as $c) {
        $g = motor_grupo_de_clase($rej, $c);
        $g['profesores'] = array_values(array_filter($g['profesores'], function ($pid) use ($profesores) {
            return isset($profesores[$pid]);
        }));
        $gruposFijos[] = $g;
    }

    // --- asignaciones_fijas (§3.9.3), solo tipo materia ---
    // Con "Profesor por asignar" (2026-10-23) va profesor_id null: el grupo
    // se abre sin profesor.
    $st = $pdo->prepare(
        "SELECT af.id, af.materia_id, IF(pa.por_asignar = 1, NULL, af.profesor_id) AS profesor_id,
                afh.dia, afh.franja_id
           FROM asignacion_fija af
           JOIN profesor pa ON pa.id = af.profesor_id
           LEFT JOIN asignacion_fija_horario afh ON afh.asignacion_fija_id = af.id
          WHERE af.semestre_id = ? AND af.tipo = 'materia' AND af.departamento_id IN ($enDeptos)
          ORDER BY af.id"
    );
    $st->execute(array_merge([$semestreId], $deptos));
    $porAsignacion = [];
    foreach ($st->fetchAll() as $f) {
        $id = (int) $f['id'];
        if (!isset($porAsignacion[$id])) {
            $porAsignacion[$id] = [
                'id' => $id, 'materia_id' => (int) $f['materia_id'],
                'profesor_id' => $f['profesor_id'] === null ? null : (int) $f['profesor_id'], 'bloques' => [],
            ];
        }
        if ($f['dia'] !== null) {
            $porAsignacion[$id]['bloques'][] = ['dia' => $f['dia'], 'franja_id' => (int) $f['franja_id']];
        }
    }
    $asignaciones = [];
    foreach ($porAsignacion as $a) {
        $asignaciones[] = [
            'id'          => $a['id'],
            'materia_id'  => $a['materia_id'],
            'profesor_id' => $a['profesor_id'],
            'sesiones'    => motor_sesiones($rej, $a['bloques']),
        ];
    }

    // --- historial (§3.8): semestres cerrados. Hoy vacío: nadie ha escrito imparte todavía. ---
    $st = $pdo->prepare(
        "SELECT CONCAT(s.tipo, '-', s.anio) AS semestre, ip.profesor_id, g.materia_id, COUNT(*) AS grupos
           FROM imparte_profesor ip
           JOIN profesor pa ON pa.id = ip.profesor_id AND pa.por_asignar = 0
           JOIN imparte i  ON i.id = ip.imparte_id
           JOIN grupo g    ON g.id = i.grupo_id
           JOIN semestre s ON s.id = g.semestre_id
           JOIN materia m  ON m.id = g.materia_id
          WHERE s.estado = 'cerrado' AND m.departamento_id IN ($enDeptos)
          GROUP BY s.id, s.tipo, s.anio, ip.profesor_id, g.materia_id
          ORDER BY s.anio DESC, s.id DESC, ip.profesor_id, g.materia_id"
    );
    $st->execute($deptos);
    $historial = [];
    foreach ($st->fetchAll() as $h) {
        $historial[] = [
            'semestre'    => $h['semestre'],
            'profesor_id' => (int) $h['profesor_id'],
            'materia_id'  => (int) $h['materia_id'],
            'grupos'      => (int) $h['grupos'],
        ];
    }

    return [
        'convencion'   => MOTOR_ENTRADA,
        'generado_at'  => $generadoAt,
        'generado_por' => $generadoPor,
        'semestre'     => [
            'id'       => $semestreId,
            'tipo'     => $semestre['tipo'],
            'anio'     => (int) $semestre['anio'],
            'etiqueta' => (MOTOR_NOMBRE_TIPO[$semestre['tipo']] ?? $semestre['tipo']) . ' ' . (int) $semestre['anio'],
        ],
        'alcance'            => ['departamentos' => $deptos],
        'reglas'             => MOTOR_REGLAS,
        'rejilla'            => [
            'dias'    => MOTOR_DIAS,
            'franjas' => array_map(function ($f) {
                return [
                    'inicio' => $f['inicio'], 'fin' => $f['fin'], 'orden' => $f['orden'],
                    'dias' => $f['dias'], 'departamento_id' => $f['departamento_id'],
                ];
            }, $rej['lista']),
        ],
        'departamentos'      => $departamentos,
        'materias'           => $materias,
        'salones'            => $salones,
        'profesores'         => array_values($profesores),
        'grupos_fijos'       => $gruposFijos,
        'asignaciones_fijas' => $asignaciones,
        'historial'          => $historial,
    ];
}

/** El paquete listo para json_encode: los mapas salen como {} aunque estén vacíos. */
function motor_entrada_json(array $ent): array
{
    foreach ($ent['salones'] as &$s) {
        $s['disponible'] = (object) $s['disponible'];
    }
    unset($s);
    foreach ($ent['profesores'] as &$p) {
        $p['disponibilidad'] = (object) $p['disponibilidad'];
        $p['materias'] = (object) $p['materias'];
    }
    unset($p);
    return $ent;
}

/** SHA-256 del paquete sin lo que cambia en cada descarga aunque los datos sean los mismos. */
function motor_huella(array $ent): string
{
    unset($ent['generado_at'], $ent['generado_por']);
    return hash('sha256', (string) json_encode(motor_entrada_json($ent), JSON_UNESCAPED_UNICODE));
}

// -----------------------------------------------------------------------------
// §5 — Validar la salida
//
// Portado de malla-horarios/optV0/optv0/validar.py y llevado a la versión 2:
// regla 9 (asignaciones fijas), la excepción de la regla 7 para las sesiones
// que fijó la jefatura, num_cursos_max = 0 como tope real, y salon_id null
// permitido. Se valida contra la entrada armada AHORA, no contra la que se
// descargó: lo que se va a escribir tiene que valer hoy.
// -----------------------------------------------------------------------------

function motor_agrupar(array $porTipo): array
{
    $out = [];
    foreach ($porTipo as $tipo => $mensajes) {
        $out[] = [
            'tipo'     => $tipo,
            'total'    => count($mensajes),
            'mensajes' => array_slice($mensajes, 0, MOTOR_MAX_MENSAJES),
        ];
    }
    return $out;
}

/**
 * @return array {
 *   errores: [{tipo, total, mensajes}]   reglas duras: si hay, no se escribe nada
 *   avisos:  [{tipo, total, mensajes}]   reglas blandas que detectó el sistema
 *   avisos_motor: [...]                  los que trajo la salida (§4.4), tal cual
 *   sin_asignar: [...]                   los de la salida, limpios
 *   resumen: {...}
 *   plan: [...]                          los grupos nuevos, ya normalizados, para motor_aplicar()
 * }
 */
/**
 * Las clases compartidas de la co-oferta, como las arma el motor (decisión del 2026-10-21; igual que
 * estrellas_co_oferta() de malla-horarios/optV1/optv1/convencion.py y que la vista de malla).
 *
 * En Matemáticas la co-oferta es una red de pares, así que no se junta por componentes: de mayor a
 * menor demanda, una clave se pega a la clave principal de más demanda entre sus co-ofertas; si
 * ninguna co-oferta suya es principal, ella lo es. Una estrella de varias claves pide
 * demanda ajustada sumada / capacidad_planeacion de la principal clases, al entero más cercano y al
 * menos 1, como redondea Escolares cada clave (salvo que ninguna de sus claves tenga grupos
 * sugeridos: 0), y cada clase lleva todas sus claves. Una clave sola pide sus grupos_sugeridos. Con
 * demanda ajustada, nunca más de suma / MOTOR_ALUMNOS_MINIMOS clases (D49, 2026-10-23).
 *
 * @param array $materias  las de la entrada (§3.4)
 * @param array $conGrupos ids de las materias que abren grupos
 * @return array [principal_de [materia_id => principal], clases [principal => n]]
 */
function motor_estrellas_co_oferta(array $materias, array $conGrupos): array
{
    $mat = [];
    foreach ($materias as $m) {
        $mat[$m['id']] = $m;
    }
    $ids = [];
    $sug = [];
    $aj = [];
    foreach (array_unique($conGrupos) as $x) {
        if (!isset($mat[$x])) {
            continue;
        }
        $d = $mat[$x]['demanda'] ?? [];
        $ids[] = $x;
        $sug[$x] = (int) ($d['grupos_sugeridos'] ?? 0);
        $aj[$x] = isset($d['demanda_ajustada']) ? (float) $d['demanda_ajustada'] : null;
    }
    $orden = function ($x) use ($aj, $mat): array {
        return [-($aj[$x] ?? 0.0), $mat[$x]['clave']];
    };
    usort($ids, function ($a, $b) use ($aj, $sug, $mat) {
        return [-($aj[$a] ?? 0.0), -$sug[$a], $mat[$a]['clave']] <=> [-($aj[$b] ?? 0.0), -$sug[$b], $mat[$b]['clave']];
    });
    $principal = [];
    foreach ($ids as $x) {
        $mejor = null;
        foreach ($mat[$x]['co_oferta'] ?? [] as $o) {
            if (($principal[$o] ?? null) === $o && ($mejor === null || ($orden($o) <=> $orden($mejor)) < 0)) {
                $mejor = $o;
            }
        }
        $principal[$x] = $mejor ?? $x;
    }
    $miembros = [];
    foreach ($principal as $x => $p) {
        $miembros[$p][] = $x;
    }
    $clases = [];
    foreach ($miembros as $p => $ms) {
        $algunSug = false;
        $conAj = false;
        $suma = 0.0;
        $maxSug = 0;
        foreach ($ms as $x) {
            $algunSug = $algunSug || $sug[$x] > 0;
            $conAj = $conAj || $aj[$x] !== null;
            $suma += $aj[$x] ?? 0.0;
            $maxSug = max($maxSug, $sug[$x]);
        }
        if (count($ms) === 1) {
            $n = $sug[$p];
        } elseif (!$algunSug) {
            $n = 0;
        } elseif (!$conAj) {
            $n = $maxSug;
        } else {
            $cap = (int) ($mat[$p]['demanda']['capacidad_planeacion'] ?? 0);
            $n = max(1, (int) floor(round($suma, 6) / ($cap > 0 ? $cap : 30) + 0.5));
        }
        // D49: nunca tantas clases que alguna quede con menos de MOTOR_ALUMNOS_MINIMOS esperados
        if ($conAj) {
            $n = min($n, (int) floor(round($suma, 6) / MOTOR_ALUMNOS_MINIMOS));
        }
        $clases[$p] = $n;
    }
    return [$principal, $clases];
}

function motor_validar_salida(array $rej, array $ent, $sal): array
{
    $errores = [];
    $avisos = [];
    $err = function (string $tipo, string $msg) use (&$errores) {
        $errores[$tipo][] = $msg;
    };
    $avi = function (string $tipo, string $msg) use (&$avisos) {
        $avisos[$tipo][] = $msg;
    };

    $reglas  = $ent['reglas'];
    $bpc     = $reglas['bloques_por_credito'];
    $mins    = $reglas['minutos_por_bloque'];
    $sinResp = $reglas['sin_respuesta_cuenta_como'];
    $alcance = $ent['alcance']['departamentos'];

    $nombreDepto = [];
    foreach ($ent['departamentos'] as $d) {
        $nombreDepto[$d['id']] = $d['nombre'];
    }
    $mats = [];
    foreach ($ent['materias'] as $m) {
        $mats[$m['id']] = $m;
    }
    $profs = [];
    foreach ($ent['profesores'] as $p) {
        $profs[$p['id']] = $p;
    }
    $salones = [];
    foreach ($ent['salones'] as $s) {
        $salones[$s['id']] = $s;
    }
    $nombre = function (?int $p) use ($profs): string {
        if ($p === null) {
            return 'Profesor por asignar';
        }
        return isset($profs[$p]) ? $profs[$p]['nombre'] : "profesor $p";
    };
    $afs = [];
    foreach ($ent['asignaciones_fijas'] as $a) {
        $llaves = [];
        foreach ($a['sesiones'] as $s) {
            foreach (motor_bloques_de_sesion($rej, $s) ?? [] as $b) {
                $llaves[] = $b[0] . '|' . $b[1];
            }
        }
        sort($llaves);
        $afs[$a['id']] = $a + ['llaves' => $llaves];
    }
    $etqAf = function (int $id) use ($afs, $mats, $nombre): string {
        $a = $afs[$id];
        $clave = isset($mats[$a['materia_id']]) ? $mats[$a['materia_id']]['clave'] : 'materia ' . $a['materia_id'];
        return "la asignación directa #$id ($clave con " . $nombre($a['profesor_id']) . ')';
    };

    $resumen = [
        'clases' => 0, 'grupos' => 0, 'sin_profesor' => 0, 'sin_horario' => 0, 'sin_salon' => 0,
        'sin_asignar' => 0, 'grupos_fijos' => count($ent['grupos_fijos']), 'devueltos' => 0,
        'asignaciones_fijas' => count($afs),
        'bloques' => ['verde' => 0, 'amarillo' => 0, 'fijados_en_rojo' => 0],
    ];
    $vacio = function () use (&$errores, &$avisos, &$resumen) {
        return [
            'errores' => motor_agrupar($errores), 'avisos' => motor_agrupar($avisos), 'avisos_motor' => [],
            'sin_asignar' => [], 'resumen' => $resumen, 'plan' => [],
        ];
    };

    // --- 1. convención (el semestre lo revisa el endpoint antes de armar $ent) ---
    if (!is_array($sal) || motor_es_lista($sal)) {
        $err('estructura', 'El archivo no es un objeto JSON.');
        return $vacio();
    }
    $conv = $sal['convencion'] ?? null;
    if ($conv !== MOTOR_SALIDA) {
        $err('convencion', $conv === 'autoplanear-salida/1'
            ? 'El archivo es de la convención 1 (autoplanear-salida/1). Autoplanear ya solo acepta la 2: hay que actualizar el motor (optV0/README.md, "Pasar a la convención 2").'
            : 'convencion = ' . json_encode($conv, JSON_UNESCAPED_UNICODE) . ', se esperaba "' . MOTOR_SALIDA . '".');
    }

    // --- estructura de §4.2 ---
    $grupos = $sal['grupos'] ?? null;
    if (!motor_es_lista($grupos)) {
        $err('estructura', 'Falta la lista "grupos".');
        $grupos = [];
    }
    $fijosPorId = [];
    foreach ($ent['grupos_fijos'] as $g) {
        $fijosPorId[$g['grupo_id']] = true;
    }
    $todos = [];
    foreach ($ent['grupos_fijos'] as $g) {
        $todos[] = ['fijo', $g];
    }
    $refs = [];
    foreach ($grupos as $i => $g) {
        $n = $i + 1;
        if (!is_array($g) || motor_es_lista($g)) {
            $err('estructura', "El grupo #$n no es un objeto.");
            continue;
        }
        $ref = $g['ref'] ?? null;
        if ((!is_string($ref) && !is_int($ref)) || $ref === '') {
            $err('estructura', "El grupo #$n no tiene \"ref\".");
            continue;
        }
        $ref = (string) $ref;
        if (isset($refs[$ref])) {
            $err('estructura', "La ref \"$ref\" se repite.");
        }
        $refs[$ref] = true;
        $faltan = [];
        foreach (['materias', 'profesores', 'salon_id', 'sesiones'] as $k) {
            if (!array_key_exists($k, $g)) {
                $faltan[] = $k;
            }
        }
        if ($faltan !== []) {
            $err('estructura', "$ref: le falta " . implode(', ', $faltan) . '.');
            continue;
        }
        if (!motor_es_lista($g['materias']) || $g['materias'] === []
            || !motor_es_lista($g['profesores']) || !motor_es_lista($g['sesiones'])) {
            $err('estructura', "$ref: materias (al menos una), profesores y sesiones tienen que ser listas.");
            continue;
        }
        $gid = $g['grupo_id'] ?? null;
        if ($gid !== null) {
            if (!is_int($gid) || !isset($fijosPorId[$gid])) {
                $err('ids', "$ref: grupo_id " . json_encode($gid) . ' no es un grupo fijo de la descarga.');
            } else {
                $resumen['devueltos']++;   // se devuelve sin cambios: cuenta el de la base
            }
            continue;
        }
        $g['ref'] = $ref;
        $todos[] = ['salida', $g];
    }

    // --- recorrido: 2 a 9 ---
    $ocupProf = [];
    $horas = [];
    foreach ($profs as $p) {
        $horas[$p['id']] = 0.0;
        foreach ($p['ocupado'] as $o) {
            foreach (motor_bloques_de_sesion($rej, $o) ?? [] as $b) {
                $ocupProf["{$p['id']}|{$b[0]}|{$b[1]}"][] = "una clase en otro departamento ({$o['motivo']})";
            }
            $horas[$p['id']] += $o['bloques'] * $mins / 60;
        }
    }
    $ocupSalon = [];
    $carga = [];
    $abiertos = [];
    $afUsadas = [];
    $diaProf = [];
    $plan = [];

    foreach ($todos as $t) {
        list($origen, $g) = $t;
        $esSalida = $origen === 'salida';
        $ref = $esSalida ? $g['ref'] : 'grupo publicado ' . $g['grupo_id'];

        // 2. materias
        $mIds = [];
        $numeros = [];
        $porcentajes = [];
        $bien = true;
        foreach ($g['materias'] as $mm) {
            $mid = is_array($mm) ? ($mm['materia_id'] ?? null) : null;
            if (!is_int($mid) || !isset($mats[$mid])) {
                $err('ids', "$ref: la materia " . json_encode($mid) . ' no está en la descarga.');
                $bien = false;
                continue;
            }
            if (in_array($mid, $mIds, true)) {
                $err('estructura', "$ref: {$mats[$mid]['clave']} viene dos veces.");
                $bien = false;
                continue;
            }
            $mIds[] = $mid;
            $numeros[] = $mm['numero'] ?? null;
            $pct = $mm['porcentaje'] ?? null;
            $porcentajes[] = ((is_int($pct) || is_float($pct)) && $pct >= 0 && $pct <= 100) ? (float) $pct : null;
        }
        if (!$bien || $mIds === []) {
            continue;
        }
        $etq = $ref . ' (' . implode(' / ', array_map(function ($id) use ($mats) {
            return $mats[$id]['clave'];
        }, $mIds)) . ')';

        $depto = null;
        foreach ($mIds as $mid) {
            if (in_array($mats[$mid]['departamento_id'], $alcance, true)) {
                $depto = $mats[$mid]['departamento_id'];
                break;
            }
        }
        if ($depto === null) {
            $err('alcance', "$etq: ninguna de sus materias es de los departamentos de la descarga.");
            continue;
        }
        if (count($mIds) > 1) {
            // Una clase compartida es una estrella: una clave de la que todas las demás son co-oferta
            // directa (motor_estrellas_co_oferta). Si ninguna lo es, se reporta contra la primera.
            $base = $mIds[0];
            foreach ($mIds as $centro) {
                if (array_diff($mIds, [$centro], $mats[$centro]['co_oferta']) === []) {
                    $base = $centro;
                    break;
                }
            }
            foreach (array_diff($mIds, [$base]) as $mid) {
                if (!in_array($mid, $mats[$base]['co_oferta'], true)) {
                    $err('co_oferta', "$etq: {$mats[$mid]['clave']} no es co-oferta de {$mats[$base]['clave']}, no pueden ser la misma clase.");
                }
            }
        }

        // 2. profesores y salón
        $pIds = [];
        foreach ($g['profesores'] as $p) {
            if (!is_int($p) || !isset($profs[$p])) {
                // En un grupo publicado (p. ej. un co-titular de otro
                // departamento) no es error del motor: solo no se cuenta.
                if ($esSalida) {
                    $err('ids', "$etq: el profesor " . json_encode($p) . ' no está en la descarga.');
                }
                continue;
            }
            if (!in_array($p, $pIds, true)) {
                $pIds[] = $p;
            }
        }
        $salonG = $g['salon_id'];
        // Un grupo publicado con un salón que no vino (descarga sin salones)
        // tampoco es error del motor.
        if ($salonG !== null && (!is_int($salonG) || !isset($salones[$salonG]))) {
            if ($esSalida) {
                $err('ids', "$etq: el salón " . json_encode($salonG) . ' no está en la descarga' . ($salones === [] ? ' (se descargó sin salones).' : '.'));
            }
            $salonG = null;
        }

        // 9. asignación fija
        $afId = $esSalida ? ($g['asignacion_fija_id'] ?? null) : null;
        if ($afId !== null && (!is_int($afId) || !isset($afs[$afId]))) {
            $err('asignacion_fija', "$etq: asignacion_fija_id " . json_encode($afId) . ' no está en la descarga.');
            $afId = null;
        }
        if ($afId !== null) {
            $afUsadas[$afId][] = $etq;
        }
        $afConHorario = $afId !== null && $afs[$afId]['llaves'] !== [];
        $enRojo = 0;    // bloques en rojo de una asignación sin horario (aviso, no error)

        // 3. sesiones
        $bloques = [];
        foreach ($g['sesiones'] as $s) {
            $bl = motor_bloques_de_sesion($rej, $s);
            if ($bl === null) {
                $err('sesiones', "$etq: la sesión " . motor_txt_sesion($s) . ' está mal formada, sale de la rejilla o cruza la comida.');
                continue;
            }
            $rid = array_key_exists('salon_id', $s) ? $s['salon_id'] : $salonG;
            if ($rid !== null && (!is_int($rid) || !isset($salones[$rid]))) {
                if ($esSalida) {
                    $err('ids', "$etq: el salón " . json_encode($rid) . ' no está en la descarga.');
                }
                $rid = null;
            }
            foreach ($bl as $b) {
                list($d, $h) = $b;
                if (isset($bloques["$d|$h"])) {
                    $err('sesiones', "$etq: dos sesiones se enciman el $d a las $h.");
                    continue;
                }
                // Un grupo publicado ya está decidido y puede caer fuera de la
                // rejilla de su departamento (Actuaría de 20:30 a 22:00, D45):
                // solo ocupa. La regla es para lo que propone el motor.
                if ($esSalida && !motor_franja_vale($rej['por_inicio'][$h], $d, $depto)) {
                    $err('sesiones', "$etq: la franja de las $h no existe el $d para " . ($nombreDepto[$depto] ?? "el departamento $depto") . '.');
                }
                $bloques["$d|$h"] = [$d, $h, $rid];
            }
        }
        $total = count($bloques);

        foreach ($bloques as $b) {
            list($d, $h, $rid) = $b;
            // 5. y 6. salón
            if ($rid !== null) {
                $ocupSalon["$rid|$d|$h"][] = $etq;
                if ($esSalida) {
                    $disp = $salones[$rid]['disponible'][$depto][$d] ?? [];
                    if (!in_array($h, $disp, true)) {
                        $err('salon_no_autorizado', "$etq: el salón {$salones[$rid]['nombre']} no está disponible para " . ($nombreDepto[$depto] ?? '') . " el $d a las $h.");
                    }
                }
            }
            // 4. y 7. profesor
            foreach ($pIds as $p) {
                $ocupProf["$p|$d|$h"][] = $etq;
                $diaProf["$p|$d"][] = $rej['por_inicio'][$h]['orden'];
                if (!$esSalida) {
                    continue;
                }
                $nivel = $profs[$p]['disponibilidad'][$d][$h] ?? null;
                if (in_array($h, $profs[$p]['maestria'][$d] ?? [], true)) {
                    // Las horas de maestría no las pisa nadie, ni una asignación directa (§3.9.1).
                    $err('disponibilidad', "$etq: " . $nombre($p) . " da su materia de maestría el $d a las $h.");
                } elseif ($nivel === 'rojo' || ($nivel === null && $sinResp === 'rojo')) {
                    if ($afId !== null) {
                        // La jefatura manda sobre la disponibilidad (§3.9.3), con o sin horario fijado.
                        $resumen['bloques']['fijados_en_rojo']++;
                        $enRojo += $afConHorario ? 0 : 1;
                    } else {
                        $err('disponibilidad', "$etq: " . $nombre($p) . " no puede el $d a las $h (" . ($nivel ?? 'sin respuesta') . ').');
                    }
                } elseif ($nivel === 'amarillo' || $nivel === null) {
                    $resumen['bloques']['amarillo']++;
                } else {
                    $resumen['bloques']['verde']++;
                }
            }
        }

        foreach ($pIds as $p) {
            // Un grupo publicado sin ninguna clave del departamento del
            // profesor no es uno de los cursos que pidió en su formulario
            // (Rojas Nandayapa en ACT-25354, D45): solo ocupa horas, igual
            // que en ocupado cuando la descarga no incluye ese departamento.
            $propio = $esSalida;
            foreach ($mIds as $mid) {
                $propio = $propio || $mats[$mid]['departamento_id'] === $profs[$p]['departamento_id'];
            }
            if ($propio) {
                $carga[$p] = ($carga[$p] ?? 0) + 1;
            }
            $horas[$p] += $total * $mins / 60;
        }
        if (!$esSalida) {
            continue;
        }
        if ($enRojo > 0) {
            $avi('asignacion_en_rojo', "$etq cumple " . $etqAf($afId) . " con $enRojo bloques que el profesor no marcó"
                . ' como disponibles: la jefatura la fijó sin horario y no le cabía en sus horas.');
        }

        $resumen['clases']++;
        $resumen['grupos'] += count($mIds);
        if ($pIds === []) {
            $resumen['sin_profesor']++;
        }
        if ($total === 0) {
            $resumen['sin_horario']++;
        } else {
            foreach ($bloques as $b) {
                if ($b[2] === null) {
                    $resumen['sin_salon']++;
                    break;
                }
            }
        }

        // 6. tipo y capacidad
        $cupo = $g['cupo_maximo'] ?? null;
        if ($cupo !== null && (!is_int($cupo) || $cupo < 1)) {
            $err('estructura', "$etq: cupo_maximo tiene que ser un entero positivo.");
            $cupo = null;
        }
        $tipos = [];
        foreach ($mIds as $mid) {
            if ($mats[$mid]['tipo_salon_requerido'] !== null) {
                $tipos[$mats[$mid]['tipo_salon_requerido']] = true;
            }
        }
        $rids = [];
        foreach ($bloques as $b) {
            if ($b[2] !== null) {
                $rids[$b[2]] = true;
            }
        }
        foreach (array_keys($rids) as $r) {
            if ($tipos !== [] && (count($tipos) > 1 || !isset($tipos[(string) $salones[$r]['tipo']]))) {
                $err('salon_tipo', "$etq: el salón {$salones[$r]['nombre']} no es del tipo " . implode(' / ', array_keys($tipos)) . '.');
            }
            if ($cupo !== null && $salones[$r]['capacidad'] < $cupo) {
                $err('salon_capacidad', "$etq: el salón {$salones[$r]['nombre']} es de {$salones[$r]['capacidad']} lugares y el cupo es $cupo.");
            }
        }

        // 7. bloqueos
        foreach ($pIds as $p) {
            foreach ($mIds as $mid) {
                if (in_array($mid, $profs[$p]['bloqueos'], true)) {
                    $err('bloqueo', "$etq: " . $nombre($p) . " tiene bloqueada {$mats[$mid]['clave']}.");
                }
            }
        }

        // blanda: bloques vs créditos
        foreach ($mIds as $mid) {
            $abiertos[$mid] = ($abiertos[$mid] ?? 0) + 1;
            $esperado = $mats[$mid]['creditos'] * $bpc;
            if ($total > 0 && $esperado !== $total) {
                $avi('creditos_distintos', "$etq: {$mats[$mid]['clave']} es de {$mats[$mid]['creditos']} créditos y el horario tiene $total bloques.");
            }
        }

        // 9. la asignación que cumple
        if ($afId !== null) {
            $a = $afs[$afId];
            // Con "Profesor por asignar" (profesor_id null) cualquiera sirve: sin
            // profesor, o con el que la jefatura le puso después en la malla.
            $conSuProfesor = $a['profesor_id'] === null || in_array($a['profesor_id'], $pIds, true);
            if (!in_array($a['materia_id'], $mIds, true) || !$conSuProfesor) {
                $err('asignacion_fija', "$etq dice cumplir " . $etqAf($afId) . ' pero no trae esa materia con ese profesor.');
            }
            if ($afConHorario) {
                $mias = array_keys($bloques);
                sort($mias);
                if ($mias !== $a['llaves']) {
                    $err('asignacion_fija', "$etq no está en el horario que fijó " . $etqAf($afId) . '.');
                }
            }
        }

        $materiasPlan = [];
        foreach ($mIds as $k => $mid) {
            $materiasPlan[] = ['materia_id' => $mid, 'numero' => $numeros[$k], 'porcentaje' => $porcentajes[$k]];
        }
        $plan[] = [
            'ref'                => $ref,
            'departamento_id'    => $depto,
            'materias'           => $materiasPlan,
            'profesores'         => $pIds,
            'bloques'            => array_values($bloques),
            'cupo_maximo'        => $cupo,
            'asignacion_fija_id' => $afId,
        ];
    }

    // 4. y 5. choques, uno por par de clases y no uno por bloque.
    $vistos = [];
    foreach ($ocupProf as $k => $quienes) {
        if (count($quienes) < 2) {
            continue;
        }
        list($p, $d, $h) = explode('|', $k);
        $par = $p . '|' . implode('|', $quienes);
        if (isset($vistos[$par])) {
            continue;
        }
        $vistos[$par] = true;
        $err('choque_profesor', $nombre((int) $p) . " tiene a la vez (desde el $d a las $h): " . implode(' y ', $quienes) . '.');
    }
    foreach ($ocupSalon as $k => $quienes) {
        if (count($quienes) < 2) {
            continue;
        }
        list($r, $d, $h) = explode('|', $k);
        $par = 's' . $r . '|' . implode('|', $quienes);
        if (isset($vistos[$par])) {
            continue;
        }
        $vistos[$par] = true;
        $err('choque_salon', "El salón {$salones[(int) $r]['nombre']} tiene a la vez (desde el $d a las $h): " . implode(' y ', $quienes) . '.');
    }

    // 9. cada asignación en exactamente un grupo
    foreach ($afs as $id => $_) {
        $n = count($afUsadas[$id] ?? []);
        if ($n === 0) {
            $err('asignacion_fija', ucfirst($etqAf($id)) . ' no aparece en ningún grupo.');
        } elseif ($n > 1) {
            $err('asignacion_fija', ucfirst($etqAf($id)) . " aparece en $n grupos: " . implode(', ', $afUsadas[$id]) . '.');
        }
    }

    // 8. tope de asignatura (con ocupado y grupos publicados)
    foreach ($horas as $p => $hrs) {
        if ($profs[$p]['tipo_contrato'] === 'asignatura' && $hrs > $reglas['max_horas_asignatura']) {
            $err('tope_asignatura', $nombre($p) . " (asignatura) quedaría con $hrs h a la semana; el tope es {$reglas['max_horas_asignatura']} h.");
        }
    }

    // sin_asignar (§4.3)
    $sinAsignar = $sal['sin_asignar'] ?? [];
    if (!motor_es_lista($sinAsignar)) {
        $err('estructura', '"sin_asignar" tiene que ser una lista.');
        $sinAsignar = [];
    }
    $faltan = [];
    $sinAsignarLimpio = [];
    foreach ($sinAsignar as $x) {
        $mid = is_array($x) ? ($x['materia_id'] ?? null) : null;
        $n = is_array($x) ? ($x['grupos_faltantes'] ?? null) : null;
        if (!is_int($mid) || !isset($mats[$mid]) || !is_int($n) || $n < 1) {
            $err('estructura', 'sin_asignar: ' . json_encode($x, JSON_UNESCAPED_UNICODE) . ' necesita materia_id de la descarga y grupos_faltantes ≥ 1.');
            continue;
        }
        $faltan[$mid] = ($faltan[$mid] ?? 0) + $n;
        $sinAsignarLimpio[] = [
            'materia_id' => $mid, 'clave' => $mats[$mid]['clave'], 'grupos_faltantes' => $n,
            'motivo' => isset($x['motivo']) && is_string($x['motivo']) ? $x['motivo'] : null,
        ];
    }
    $resumen['sin_asignar'] = array_sum($faltan);

    // blandas: grupos vs sugeridos, cursos, medias horas sueltas
    $fijosPorMateria = [];
    foreach ($ent['grupos_fijos'] as $g) {
        foreach ($g['materias'] as $mm) {
            $fijosPorMateria[$mm['materia_id']] = ($fijosPorMateria[$mm['materia_id']] ?? 0) + 1;
        }
    }
    $afPorMateria = [];
    foreach ($afs as $a) {
        $afPorMateria[$a['materia_id']] = ($afPorMateria[$a['materia_id']] ?? 0) + 1;
    }
    // Lo que pide la demanda de cada clave es lo de su estrella de co-oferta: una clave espejo va en
    // todas las clases de su principal (motor_estrellas_co_oferta).
    $conGrupos = array_keys($afPorMateria);
    foreach ($mats as $m) {
        if (($m['demanda']['grupos_sugeridos'] ?? null) !== null) {
            $conGrupos[] = $m['id'];
        }
    }
    list($principalDe, $clasesEstrella) = motor_estrellas_co_oferta(array_values($mats), $conGrupos);
    foreach ($mats as $m) {
        if (($m['demanda']['grupos_sugeridos'] ?? null) === null) {
            continue;
        }
        $sug = $clasesEstrella[$principalDe[$m['id']]] ?? 0;
        $fijos = $fijosPorMateria[$m['id']] ?? 0;
        $n = ($abiertos[$m['id']] ?? 0) + $fijos;
        // Más asignaciones directas que las que pide la demanda es decisión de la jefatura (§3.9.3).
        $tope = max($sug, ($afPorMateria[$m['id']] ?? 0) + $fijos);
        if ($n > $tope) {
            $avi('grupos_de_mas', "{$m['clave']}: $n grupos y la demanda pide $sug.");
        } elseif ($n + ($faltan[$m['id']] ?? 0) < $sug) {
            $avi('grupos_de_menos', "{$m['clave']}: $n grupos de $sug que pide la demanda, y la diferencia no viene en sin_asignar.");
        }
    }
    foreach ($carga as $p => $n) {
        $tope = $profs[$p]['preferencia']['num_cursos_max'] ?? null;
        if ($tope !== null && $n > $tope) {
            $avi('excede_num_cursos', $nombre($p) . " queda con $n cursos y su número de cursos es $tope.");
        }
    }
    foreach ($diaProf as $k => $ordenes) {
        list($p, $d) = explode('|', $k);
        $o = array_values(array_unique($ordenes));
        sort($o);
        for ($i = 0; $i + 1 < count($o); $i++) {
            $medio = $rej['por_orden'][$o[$i] + 1] ?? null;
            if ($o[$i + 1] - $o[$i] === 2 && $medio !== null && motor_franja_vale($medio, $d, null)
                && $rej['por_orden'][$o[$i]]['fin'] === $medio['inicio'] && $medio['fin'] === $rej['por_orden'][$o[$i + 1]]['inicio']) {
                $avi('media_hora_suelta', $nombre((int) $p) . " tiene media hora suelta el $d a las {$medio['inicio']}.");
            }
        }
    }

    // §4.4: los avisos del motor van tal cual, solo se descartan los mal formados.
    $avisosMotor = [];
    foreach (motor_es_lista($sal['avisos'] ?? null) ? $sal['avisos'] : [] as $a) {
        if (is_array($a) && isset($a['tipo']) && is_string($a['tipo'])) {
            $avisosMotor[] = $a;
        }
    }

    return [
        'errores'      => motor_agrupar($errores),
        'avisos'       => motor_agrupar($avisos),
        'avisos_motor' => $avisosMotor,
        'sin_asignar'  => $sinAsignarLimpio,
        'resumen'      => $resumen,
        'plan'         => $plan,
    ];
}

// -----------------------------------------------------------------------------
// Escribir la salida
// -----------------------------------------------------------------------------

/** Un número de grupo libre para esa materia: el que pidió el motor si se puede. */
function motor_numero_libre(array &$usados, int $materiaId, $pedido): string
{
    if (is_int($pedido)) {
        $pedido = (string) $pedido;
    }
    if (is_string($pedido) && preg_match('/^\d{1,3}$/', $pedido)) {
        $num = str_pad($pedido, 3, '0', STR_PAD_LEFT);
        if ($num !== '000' && !isset($usados[$materiaId][$num])) {
            $usados[$materiaId][$num] = true;
            return $num;
        }
    }
    for ($i = 1; $i <= 999; $i++) {
        $num = sprintf('%03d', $i);
        if (!isset($usados[$materiaId][$num])) {
            $usados[$materiaId][$num] = true;
            return $num;
        }
    }
    throw new RuntimeException('No quedan números de grupo libres');
}

/**
 * Borra las clases a reemplazar y escribe el plan de motor_validar_salida().
 * Corre DENTRO de una transacción que abre quien llama. Un error de trigger
 * (SQLSTATE 45000) sale como RuntimeException con la ref del grupo.
 *
 * @return array [grupos_creados, grupos_reemplazados]
 */
function motor_aplicar(PDO $pdo, array $rej, array $ent, array $plan, array $reemplazo): array
{
    $semestreId = $ent['semestre']['id'];
    $mats = [];
    foreach ($ent['materias'] as $m) {
        $mats[$m['id']] = $m;
    }

    // 1. Lo que la subida anterior dejó sin publicar (§5 "Al volver a subir").
    $grupoIds = [];
    $imparteIds = [];
    foreach ($reemplazo as $c) {
        foreach ($c['grupos'] as $g) {
            $grupoIds[] = $g['id'];
            if ($g['imparte_id'] !== null) {
                $imparteIds[] = $g['imparte_id'];
            }
        }
    }
    if ($imparteIds !== []) {
        $m = motor_marcas($imparteIds);
        $pdo->prepare("DELETE FROM imparte_co_oferta WHERE imparte_id IN ($m) OR imparte_relacionado_id IN ($m)")
            ->execute(array_merge($imparteIds, $imparteIds));
        // imparte_profesor e imparte_horario se van por ON DELETE CASCADE.
        $pdo->prepare("DELETE FROM imparte WHERE id IN ($m)")->execute($imparteIds);
    }
    if ($grupoIds !== []) {
        $m = motor_marcas($grupoIds);
        $pdo->prepare("UPDATE grupo SET continua_de_id = NULL WHERE continua_de_id IN ($m)")->execute($grupoIds);
        $pdo->prepare("DELETE FROM grupo WHERE id IN ($m)")->execute($grupoIds);
    }

    // 2. Los grupos nuevos.
    $usados = [];
    $st = $pdo->prepare('SELECT materia_id, numero FROM grupo WHERE semestre_id = ?');
    $st->execute([$semestreId]);
    foreach ($st->fetchAll() as $g) {
        $usados[(int) $g['materia_id']][$g['numero']] = true;
    }

    $insGrupo = $pdo->prepare(
        'INSERT INTO grupo (crn, materia_id, semestre_id, numero, cupo_maximo, estado, publicado)
         VALUES (NULL, ?, ?, ?, ?, ?, 0)'
    );
    $insImparte  = $pdo->prepare('INSERT INTO imparte (grupo_id, created_at) VALUES (?, ?)');
    $insProfesor = $pdo->prepare('INSERT INTO imparte_profesor (imparte_id, profesor_id) VALUES (?, ?)');
    $insCoOferta = $pdo->prepare(
        'INSERT INTO imparte_co_oferta (imparte_id, imparte_relacionado_id, porcentaje_responsabilidad) VALUES (?, ?, ?)'
    );
    $insHorario = $pdo->prepare('INSERT INTO imparte_horario (imparte_id, dia, franja_id, salon_id) VALUES (?, ?, ?, ?)');

    // Un grupo sin profesor (§4.2) se guarda con el "Profesor por asignar" de
    // su departamento (2026-10-23), y sigue 'en_asignacion'.
    $porAsignar = profesores_por_asignar();

    $ahora = ahora_utc();
    $creados = 0;
    foreach ($plan as $c) {
        try {
            $profesores = $c['profesores'];
            if ($profesores === []) {
                if (!isset($porAsignar[$c['departamento_id']])) {
                    throw new RuntimeException(
                        "{$c['ref']}: va sin profesor y su departamento no tiene \"Profesor por asignar\" (falta migracion-2026-10-23-profesor-por-asignar.sql)"
                    );
                }
                $profesores = [$porAsignar[$c['departamento_id']]];
            }
            $completo = $c['profesores'] !== [] && $c['bloques'] !== [];
            foreach ($c['bloques'] as $b) {
                $completo = $completo && $b[2] !== null;
            }
            $estado = $completo ? 'asignado' : 'en_asignacion';

            $impartes = [];
            foreach ($c['materias'] as $k => $mm) {
                $mid = $mm['materia_id'];
                $cupo = $c['cupo_maximo'] ?? ($mats[$mid]['demanda']['capacidad_planeacion'] ?? null);
                $insGrupo->execute([$mid, $semestreId, motor_numero_libre($usados, $mid, $mm['numero']), $cupo, $estado]);
                $insImparte->execute([(int) $pdo->lastInsertId(), $ahora]);
                $iid = (int) $pdo->lastInsertId();
                foreach ($profesores as $p) {
                    $insProfesor->execute([$iid, $p]);
                }
                $impartes[] = [$iid, $mm['porcentaje'] ?? ($k === 0 ? 100.0 : 0.0)];
                $creados++;
            }
            // El vínculo de espejo va ANTES que el horario: el trigger lo usa
            // para no tomar la otra clave como traslape.
            for ($i = 0; $i < count($impartes); $i++) {
                for ($j = $i + 1; $j < count($impartes); $j++) {
                    $insCoOferta->execute([$impartes[$i][0], $impartes[$j][0], $impartes[$i][1]]);
                    $insCoOferta->execute([$impartes[$j][0], $impartes[$i][0], $impartes[$j][1]]);
                }
            }
            foreach ($impartes as $imp) {
                foreach ($c['bloques'] as $b) {
                    $insHorario->execute([$imp[0], $b[0], $rej['por_inicio'][$b[1]]['id'], $b[2]]);
                }
            }
        } catch (PDOException $e) {
            if (($e->errorInfo[0] ?? '') === '45000') {
                throw new RuntimeException("{$c['ref']}: " . ($e->errorInfo[2] ?? 'la base lo rechazó'));
            }
            throw $e;
        }
    }

    return [$creados, count($grupoIds)];
}
