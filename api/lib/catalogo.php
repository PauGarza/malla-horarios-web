<?php
// =============================================================================
// El formulario del cuestionario: cómo se arma, para quién, y cómo se valida.
//
// Desde 2026-09-28 el formulario de un depto/semestre es una lista ORDENADA de
// secciones (cuestionario_seccion) que la jefatura edita: número de cursos,
// secciones de materias (verde/amarillo/rojo), la rejilla de disponibilidad y
// preguntas abiertas. Ya no hay personalización por profesor: todos los de un
// departamento ven el mismo formulario, salvo lo que decide la AUDIENCIA de
// cada sección según su tipo de contrato.
//
// Vive aparte porque lo usan cuatro endpoints con distinta autorización:
//   - cuestionario.php  el formulario del profesor que llama
//   - preferencia.php   la validación del envío, con el MISMO formulario
//   - panel.php         el formulario de otro profesor, en solo lectura
//   - configuracion.php / respuestas.php   la vista completa, sin filtrar
//
// Duplicar esto sería la manera de que el profesor vea un formulario y el
// servidor valide otro.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';

/** Lo que dice el formulario arriba de todo si la jefatura no lo cambió. */
const TEXTO_INTRODUCCION_DEFAULT =
    "Marca cada materia según si puedes impartirla: verde (sí, con gusto), amarillo (sí puedo, "
    . "aunque no es mi primera opción), rojo (no puedo — por ejemplo, no podría preparar el material).\n\n"
    . "El rojo es para cuando realmente no puedes, no para lo que preferirías no dar: entre más materias "
    . "queden en rojo, más difícil es armar la malla del departamento. Todas empiezan en amarillo.";

const TIPOS_SECCION  = ['num_cursos', 'materias', 'disponibilidad', 'abierta'];
const AUDIENCIAS     = ['todos', 'tiempo_completo_medio', 'asignatura'];
const LARGO_RESPUESTA = 5000;

/** Para ordenar acentos junto a su letra sin depender de la locale del servidor. */
function sin_acentos(string $s): string
{
    return strtr(
        $s,
        ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n',
         'Á' => 'A', 'É' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ú' => 'U', 'Ü' => 'U', 'Ñ' => 'N']
    );
}

/**
 * La plantilla con la que arranca un depto/semestre sin formulario: reproduce
 * el formulario de dos secciones que ya validó la jefatura. La misma plantilla
 * está en bd/mysql/migracion-2026-09-28-formulario-editable.sql; si cambia
 * aquí, que cambie allá.
 */
function secciones_por_defecto(): array
{
    return [
        ['num_cursos', '¿Cuántos cursos puedes impartir este semestre?', null, 'todos', null, 0],
        ['materias', 'Cursos de cálculo — cobertura departamental',
            'Cursos de cálculo que, por ser departamentales, necesitan que varios profesores de tiempo '
            . 'completo o medio tiempo los impartan.',
            'tiempo_completo_medio', 2, 1],
        ['materias', 'Catálogo de materias', null, 'todos', 5, 0],
        ['disponibilidad', 'Disponibilidad de horarios',
            'Haz clic para cambiar el color de una franja, o mantén presionado y arrastra para pintar '
            . 'varias de un jalón.',
            'todos', null, 0],
        ['abierta', '¿Ya solicitaste cursos en otro departamento? ¿En qué horarios?',
            'Ej. Martes 10:00-11:30 en Actuaría', 'asignatura', null, 0],
        ['abierta', 'Observaciones sobre la asignación de cursos', null, 'todos', null, 0],
        ['abierta', 'Observaciones sobre disponibilidad de horarios', null, 'todos', null, 0],
    ];
}

/** ¿El depto/semestre ya tiene formulario (alguna sección, aunque esté borrada)? */
function tiene_formulario(PDO $pdo, int $deptoId, int $semestreId): bool
{
    $st = $pdo->prepare(
        'SELECT COUNT(*) FROM cuestionario_seccion WHERE departamento_id = ? AND semestre_id = ?'
    );
    $st->execute([$deptoId, $semestreId]);
    return (int) $st->fetchColumn() > 0;
}

/**
 * Copia el formulario de un departamento de un semestre a otro: secciones
 * activas, en qué sección va cada materia (con sus nombres, alias y orden), y
 * de la config solo el texto de introducción y las horas mínimas. Queda SIN
 * publicar: la jefatura lo revisa y lo publica cuando esté listo.
 *
 * No abre transacción: la maneja quien llama (asegurar_formulario o la
 * apertura de semestre en api/semestres.php, que copia los 3 departamentos
 * de una vez).
 */
function copiar_formulario(PDO $pdo, int $deptoId, int $desde, int $hacia): void
{
    $st = $pdo->prepare(
        'SELECT id, tipo, titulo, descripcion, audiencia, minimo_verdes,
                cobertura_departamental, obligatoria, orden
           FROM cuestionario_seccion
          WHERE departamento_id = ? AND semestre_id = ? AND activa = 1
          ORDER BY orden, id'
    );
    $st->execute([$deptoId, $desde]);
    $ins = $pdo->prepare(
        'INSERT INTO cuestionario_seccion
                (departamento_id, semestre_id, tipo, titulo, descripcion, audiencia,
                 minimo_verdes, cobertura_departamental, obligatoria, orden)
         VALUES (?,?,?,?,?,?,?,?,?,?)'
    );
    $nuevoId = [];
    foreach ($st->fetchAll() as $s) {
        $ins->execute([
            $deptoId, $hacia, $s['tipo'], $s['titulo'], $s['descripcion'], $s['audiencia'],
            $s['minimo_verdes'], $s['cobertura_departamental'], $s['obligatoria'], $s['orden'],
        ]);
        $nuevoId[(int) $s['id']] = (int) $pdo->lastInsertId();
    }

    $st = $pdo->prepare(
        'SELECT mc.materia_id, mc.seccion_id, mc.alias_de_id, mc.etiqueta, mc.orden, mc.revisado
           FROM materia_cuestionario mc
           JOIN materia m ON m.id = mc.materia_id
          WHERE mc.semestre_id = ? AND m.departamento_id = ?'
    );
    $st->execute([$desde, $deptoId]);
    $ins = $pdo->prepare(
        'INSERT IGNORE INTO materia_cuestionario
                (materia_id, semestre_id, seccion_id, alias_de_id, etiqueta, orden, revisado)
         VALUES (?,?,?,?,?,?,?)'
    );
    foreach ($st->fetchAll() as $m) {
        // Una materia que apuntaba a una sección borrada se queda oculta.
        $seccion = $m['seccion_id'] !== null && isset($nuevoId[(int) $m['seccion_id']])
            ? $nuevoId[(int) $m['seccion_id']]
            : null;
        $ins->execute([
            (int) $m['materia_id'], $hacia, $seccion,
            $seccion === null ? $m['alias_de_id'] : null,
            $m['etiqueta'], $m['orden'], $m['revisado'],
        ]);
    }

    $pdo->prepare(
        'INSERT IGNORE INTO departamento_semestre_config
                (departamento_id, semestre_id, horas_minimas_verde, texto_introduccion, publicado)
         SELECT departamento_id, ?, horas_minimas_verde, texto_introduccion, 0
           FROM departamento_semestre_config
          WHERE departamento_id = ? AND semestre_id = ?'
    )->execute([$hacia, $deptoId, $desde]);
}

/**
 * El semestre más reciente (anterior a $semestreId) en el que ese
 * departamento tuvo formulario, o null.
 */
function semestre_anterior_con_formulario(PDO $pdo, int $deptoId, int $semestreId): ?int
{
    $st = $pdo->prepare(
        'SELECT MAX(semestre_id) FROM cuestionario_seccion
          WHERE departamento_id = ? AND semestre_id <> ? AND activa = 1'
    );
    $st->execute([$deptoId, $semestreId]);
    $v = $st->fetchColumn();
    return ($v === false || $v === null) ? null : (int) $v;
}

/**
 * Si el depto/semestre todavía no tiene formulario, lo arma: copia el del
 * semestre anterior si existe (2026-09-29: cada semestre arranca con lo que
 * se usó la vez pasada), y si no, siembra la plantilla. Solo la llaman
 * endpoints de jefatura sobre el semestre activo.
 */
function asegurar_formulario(PDO $pdo, int $deptoId, int $semestreId): void
{
    if (tiene_formulario($pdo, $deptoId, $semestreId)) {
        return;
    }

    $pdo->beginTransaction();
    try {
        $anterior = semestre_anterior_con_formulario($pdo, $deptoId, $semestreId);
        if ($anterior !== null) {
            copiar_formulario($pdo, $deptoId, $anterior, $semestreId);
        } else {
            $ins = $pdo->prepare(
                'INSERT INTO cuestionario_seccion
                        (departamento_id, semestre_id, tipo, titulo, descripcion, audiencia,
                         minimo_verdes, cobertura_departamental, obligatoria, orden)
                 VALUES (?,?,?,?,?,?,?,?,0,?)'
            );
            $orden = 1;
            foreach (secciones_por_defecto() as $s) {
                $ins->execute([$deptoId, $semestreId, $s[0], $s[1], $s[2], $s[3], $s[4], $s[5], $orden++]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/** Config del depto/semestre. Sin fila = defaults y SIN publicar. */
function config_formulario(PDO $pdo, int $deptoId, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT horas_minimas_verde, texto_introduccion, publicado, publicado_at
           FROM departamento_semestre_config
          WHERE departamento_id = ? AND semestre_id = ?'
    );
    $st->execute([$deptoId, $semestreId]);
    $c = $st->fetch();

    return [
        'publicado'           => $c !== false && (int) $c['publicado'] === 1,
        'publicado_at'        => $c === false ? null : $c['publicado_at'],
        'horas_minimas_verde' => $c === false ? 10.0 : (float) $c['horas_minimas_verde'],
        'texto_introduccion'  => ($c === false || $c['texto_introduccion'] === null)
            ? TEXTO_INTRODUCCION_DEFAULT
            : $c['texto_introduccion'],
    ];
}

/** Secciones activas, en orden, con los tipos ya normalizados para JSON. */
function secciones_activas(PDO $pdo, int $deptoId, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT id, tipo, titulo, descripcion, audiencia, minimo_verdes,
                cobertura_departamental, obligatoria, orden
           FROM cuestionario_seccion
          WHERE departamento_id = ? AND semestre_id = ? AND activa = 1
          ORDER BY orden, id'
    );
    $st->execute([$deptoId, $semestreId]);

    $secciones = [];
    foreach ($st->fetchAll() as $s) {
        $seccion = [
            'id'                      => (int) $s['id'],
            'tipo'                    => $s['tipo'],
            'titulo'                  => $s['titulo'],
            'descripcion'             => $s['descripcion'],
            'audiencia'               => $s['audiencia'],
            'minimo_verdes'           => $s['minimo_verdes'] === null ? null : (int) $s['minimo_verdes'],
            'cobertura_departamental' => (int) $s['cobertura_departamental'] === 1,
            'obligatoria'             => (int) $s['obligatoria'] === 1,
        ];
        if ($s['tipo'] === 'materias') {
            $seccion['materias'] = [];
        }
        $secciones[] = $seccion;
    }
    return $secciones;
}

/**
 * Reparte las materias activas del departamento entre las secciones de
 * materias. Devuelve [secciones con sus materias, materias ocultas].
 *
 * - Fila con seccion_id NULL -> oculta.
 * - SIN fila -> a la primera sección de materias para todos (fail-open: es
 *   preferible que sobre una materia a que a alguien le falte). Así una
 *   materia recién dada de alta en el catálogo aparece sola.
 * - Fila que apunta a una sección borrada -> oculta.
 */
function repartir_materias(PDO $pdo, int $deptoId, int $semestreId, array $secciones): array
{
    $st = $pdo->prepare(
        'SELECT m.id, m.clave, m.nombre,
                mc.materia_id IS NOT NULL AS tiene_fila,
                mc.seccion_id, mc.alias_de_id, mc.etiqueta, mc.orden, mc.revisado,
                ed.grupos_sugeridos
           FROM materia m
           LEFT JOIN materia_cuestionario mc
                  ON mc.materia_id = m.id AND mc.semestre_id = ?
           LEFT JOIN estimacion_demanda ed
                  ON ed.materia_id = m.id AND ed.semestre_id = ?
          WHERE m.departamento_id = ? AND m.activa = 1'
    );
    $st->execute([$semestreId, $semestreId, $deptoId]);
    $filas = $st->fetchAll();

    $indicePorSeccion = [];
    $destinoSinFila   = null;
    foreach ($secciones as $i => $s) {
        if ($s['tipo'] !== 'materias') {
            continue;
        }
        $indicePorSeccion[$s['id']] = $i;
        if ($destinoSinFila === null && $s['audiencia'] === 'todos') {
            $destinoSinFila = $i;
        }
    }
    if ($destinoSinFila === null && $indicePorSeccion !== []) {
        $destinoSinFila = reset($indicePorSeccion);
    }

    // Una oculta que es el nombre viejo de otra se muestra como "(antes …)".
    $aliasPorVisible = [];
    foreach ($filas as $f) {
        if ($f['alias_de_id'] === null) {
            continue;
        }
        $nombre = $f['etiqueta'] !== null ? $f['etiqueta'] : $f['nombre'];
        $aliasPorVisible[(int) $f['alias_de_id']][] = $nombre;
    }

    $ocultas = [];
    foreach ($filas as $f) {
        $id = (int) $f['id'];
        $materia = [
            'id'             => $id,
            'clave'          => $f['clave'],
            'nombre'         => $f['nombre'],
            'etiqueta'       => $f['etiqueta'],
            'nombreMostrado' => $f['etiqueta'] !== null ? $f['etiqueta'] : $f['nombre'],
            'alias'          => isset($aliasPorVisible[$id]) ? $aliasPorVisible[$id] : [],
            'alias_de_id'    => $f['alias_de_id'] === null ? null : (int) $f['alias_de_id'],
            'orden'          => $f['orden'] === null ? null : (int) $f['orden'],
            'revisado'       => (int) $f['revisado'] === 1,
            // De la estimación de demanda de Servicios Escolares, si ya se
            // cargó. null = sin demanda cargada para esa materia.
            'grupos_sugeridos' => $f['grupos_sugeridos'] === null ? null : (int) $f['grupos_sugeridos'],
        ];

        if ((int) $f['tiene_fila'] !== 1) {
            $destino = $destinoSinFila;
        } elseif ($f['seccion_id'] !== null && isset($indicePorSeccion[(int) $f['seccion_id']])) {
            $destino = $indicePorSeccion[(int) $f['seccion_id']];
        } else {
            $destino = null;
        }

        if ($destino === null) {
            $ocultas[] = $materia;
        } else {
            $secciones[$destino]['materias'][] = $materia;
        }
    }

    foreach ($secciones as $i => $s) {
        if ($s['tipo'] === 'materias') {
            $secciones[$i]['materias'] = ordenar_materias($s['materias']);
        }
    }
    usort($ocultas, static function ($a, $b) {
        return strcmp($a['clave'], $b['clave']);
    });

    return [$secciones, $ocultas];
}

/** Por `orden`, con los NULL al final, y a igualdad por nombre mostrado. */
function ordenar_materias(array $materias): array
{
    usort($materias, static function ($a, $b) {
        if ($a['orden'] !== $b['orden']) {
            if ($a['orden'] === null) return 1;
            if ($b['orden'] === null) return -1;
            return $a['orden'] - $b['orden'];
        }
        return strcasecmp(sin_acentos($a['nombreMostrado']), sin_acentos($b['nombreMostrado']));
    });
    return $materias;
}

/** El formulario entero, sin filtrar por audiencia. Para el editor y respuestas. */
function formulario_completo(PDO $pdo, int $deptoId, int $semestreId): array
{
    $secciones = secciones_activas($pdo, $deptoId, $semestreId);
    list($secciones, $ocultas) = repartir_materias($pdo, $deptoId, $semestreId, $secciones);

    return array_merge(config_formulario($pdo, $deptoId, $semestreId), [
        'secciones' => $secciones,
        'ocultas'   => $ocultas,
    ]);
}

function audiencia_aplica(string $audiencia, ?string $tipoContrato): bool
{
    if ($audiencia === 'todos') {
        return true;
    }
    if ($audiencia === 'tiempo_completo_medio') {
        return in_array($tipoContrato, ['tiempo_completo', 'medio_tiempo'], true);
    }
    return $tipoContrato === 'asignatura';
}

/**
 * El formulario tal como lo ve UN profesor.
 *
 * Las secciones cuya audiencia no le aplica desaparecen, salvo sus materias:
 * esas se agregan al final de su primera sección de materias visible y cuentan
 * para su mínimo. Es lo que ya pasaba antes con las de cobertura departamental
 * para asignatura, que las veía mezcladas en el catálogo.
 *
 * Cada materia lleva `cobertura_departamental` de la sección donde la puso la
 * jefatura, no de donde termina mostrándose: es un dato para el motor.
 *
 * $exigirPublicado = false solo para la vista de solo lectura del jefe.
 */
function cuestionario_de(PDO $pdo, array $profesor, int $semestreId, bool $exigirPublicado = true): array
{
    $deptoId = $profesor['departamento_id'] === null ? null : (int) $profesor['departamento_id'];
    if ($deptoId === null) {
        return ['publicado' => false, 'secciones' => []];
    }

    $config = config_formulario($pdo, $deptoId, $semestreId);
    if ($exigirPublicado && !$config['publicado']) {
        return ['publicado' => false, 'secciones' => []];
    }

    $tipo = $profesor['tipo_contrato'];
    $completo = formulario_completo($pdo, $deptoId, $semestreId);

    $visibles  = [];
    $huerfanas = [];
    $primeraMaterias = null;
    foreach ($completo['secciones'] as $s) {
        if ($s['tipo'] === 'materias') {
            foreach ($s['materias'] as $i => $m) {
                $s['materias'][$i]['cobertura_departamental'] = $s['cobertura_departamental'];
                // La demanda es para la jefatura; el profesor no la necesita.
                unset($s['materias'][$i]['grupos_sugeridos']);
            }
        }
        if (!audiencia_aplica($s['audiencia'], $tipo)) {
            if ($s['tipo'] === 'materias') {
                $huerfanas = array_merge($huerfanas, $s['materias']);
            }
            continue;
        }
        if ($s['tipo'] === 'materias' && $primeraMaterias === null) {
            $primeraMaterias = count($visibles);
        }
        $visibles[] = $s;
    }
    if ($primeraMaterias !== null && $huerfanas !== []) {
        $visibles[$primeraMaterias]['materias'] =
            array_merge($visibles[$primeraMaterias]['materias'], $huerfanas);
    }

    // Una sección de materias vacía no le sirve de nada al profesor.
    $visibles = array_values(array_filter($visibles, static function ($s) {
        return $s['tipo'] !== 'materias' || $s['materias'] !== [];
    }));

    return [
        'publicado'           => $config['publicado'],
        'texto_introduccion'  => $config['texto_introduccion'],
        'horas_minimas_verde' => $config['horas_minimas_verde'],
        'secciones'           => $visibles,
    ];
}

/**
 * Lo que le falta a una preferencia para poder enviarse, contra el formulario
 * que ve ese profesor. Vacío = se puede enviar. Es la misma regla que muestra
 * la pantalla; aquí es la que manda.
 *
 * $niveles:    materia_id => nivel
 * $respuestas: seccion_id => texto
 */
function faltantes_para_enviar(array $cuestionario, array $niveles, array $respuestas, float $horasVerde): array
{
    $faltantes = [];
    foreach ($cuestionario['secciones'] as $s) {
        if ($s['tipo'] === 'materias' && $s['minimo_verdes'] !== null) {
            $minimo = min($s['minimo_verdes'], count($s['materias']));
            $verdes = 0;
            foreach ($s['materias'] as $m) {
                if (isset($niveles[$m['id']]) && $niveles[$m['id']] === 'verde') {
                    $verdes++;
                }
            }
            if ($verdes < $minimo) {
                $faltantes[] = "$minimo materias en verde en \"{$s['titulo']}\" (llevas $verdes)";
            }
        }
        if ($s['tipo'] === 'abierta' && $s['obligatoria']
            && (!isset($respuestas[$s['id']]) || trim($respuestas[$s['id']]) === '')) {
            $faltantes[] = "responder \"{$s['titulo']}\"";
        }
    }
    $minHoras = (float) $cuestionario['horas_minimas_verde'];
    if ($horasVerde < $minHoras) {
        $faltantes[] = "$minHoras hrs en verde de disponibilidad (llevas $horasVerde)";
    }
    return $faltantes;
}

/** La preferencia de un profesor con sus materias, disponibilidad y respuestas. */
function preferencia_de(PDO $pdo, int $profesorId, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT id, num_cursos_max, estado, enviado_at
           FROM preferencia WHERE profesor_id = ? AND semestre_id = ?'
    );
    $st->execute([$profesorId, $semestreId]);
    $pref = $st->fetch();
    if ($pref === false) {
        return ['preferencia' => null, 'materias' => [], 'disponibilidad' => [], 'respuestas' => []];
    }

    $m = $pdo->prepare('SELECT materia_id, nivel FROM preferencia_materia WHERE preferencia_id = ?');
    $m->execute([$pref['id']]);
    $d = $pdo->prepare('SELECT dia, franja_id, nivel FROM disponibilidad WHERE preferencia_id = ?');
    $d->execute([$pref['id']]);
    $r = $pdo->prepare('SELECT seccion_id, texto FROM preferencia_respuesta WHERE preferencia_id = ?');
    $r->execute([$pref['id']]);

    return [
        'preferencia'    => $pref,
        'materias'       => $m->fetchAll(),
        'disponibilidad' => $d->fetchAll(),
        'respuestas'     => $r->fetchAll(),
    ];
}
