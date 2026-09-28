<?php
// =============================================================================
// Armado del catálogo del cuestionario.
//
// Vive aparte porque lo necesitan DOS endpoints con la misma lógica y distinta
// autorización:
//   - cuestionario.php: el catálogo del profesor que llama (propia_elegibilidad)
//   - panel.php?profesor_id=N: el de otro profesor de su departamento, en solo
//     lectura (departamento_preferencia_select y parientes)
//
// Duplicar esto sería la manera de que las dos vistas se desincronicen y que el
// Jefe vea un formulario distinto del que llenó el profesor.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';

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
 * El cuestionario tal como lo ve un profesor: config del departamento y
 * catálogo ya filtrado, con alias pegados y ordenado.
 *
 * Reproduce paso por paso lo que hacía FormularioPreferencias.jsx en el
 * cliente. El ORDEN de los pasos importa y está anotado donde importa.
 */
function cuestionario_de(PDO $pdo, int $profesorId, ?int $deptoId, string $modo, int $semestreId): array
{
    // Config del departamento. Sin fila = defaults de la propia tabla
    // (fail-open): abierto, y el mínimo de D18 de GUIA-DECISIONES.md.
    $config = null;
    if ($deptoId !== null) {
        $st = $pdo->prepare(
            'SELECT mostrar_seleccion_materias, horas_minimas_verde
               FROM departamento_semestre_config
              WHERE departamento_id = ? AND semestre_id = ?'
        );
        $st->execute([$deptoId, $semestreId]);
        $fila = $st->fetch();
        $config = $fila === false ? null : $fila;
    }

    $horasMinimasVerde = $config === null ? 10.0 : (float) $config['horas_minimas_verde'];
    $mostrarSeleccion  = $config === null ? true : ((int) $config['mostrar_seleccion_materias'] === 1);
    $mostrarMaterias   = $deptoId !== null && $modo !== 'ninguna' && $mostrarSeleccion;

    if (!$mostrarMaterias) {
        return [
            'mostrar_materias'    => false,
            'horas_minimas_verde' => $horasMinimasVerde,
            'materias'            => [],
        ];
    }

    // El catálogo sale de materia_cuestionario, NO de estimacion_demanda: qué
    // materias se ofrecen lo decide el Jefe de Departamento y no puede depender
    // de que Servicios Escolares ya haya publicado su estimación de demanda,
    // que para un semestre próximo todavía no existe.
    $st = $pdo->prepare(
        'SELECT m.id, m.clave, m.nombre,
                mc.seccion, mc.alias_de_id, mc.etiqueta, mc.orden
           FROM materia m
           LEFT JOIN materia_cuestionario mc
                  ON mc.materia_id = m.id AND mc.semestre_id = ?
          WHERE m.departamento_id = ? AND m.activa = 1'
    );
    $st->execute([$semestreId, $deptoId]);
    $filas = $st->fetchAll();

    // Las materias ocultas que son el nombre viejo de otra se muestran como
    // "(antes ...)" en la fila de esa otra, no como fila propia.
    $st = $pdo->prepare(
        'SELECT mc.materia_id, mc.alias_de_id, mc.etiqueta, m.nombre
           FROM materia_cuestionario mc
           JOIN materia m ON m.id = mc.materia_id
          WHERE mc.semestre_id = ? AND mc.seccion = \'oculta\' AND mc.alias_de_id IS NOT NULL'
    );
    $st->execute([$semestreId]);
    $aliasPorVisible = [];
    foreach ($st->fetchAll() as $a) {
        $nombre = $a['etiqueta'] !== null ? $a['etiqueta'] : $a['nombre'];
        if ($nombre === null || $nombre === '') {
            continue;
        }
        $visible = (int) $a['alias_de_id'];
        if (!isset($aliasPorVisible[$visible])) {
            $aliasPorVisible[$visible] = [];
        }
        $aliasPorVisible[$visible][] = $nombre;
    }

    $materias = [];
    foreach ($filas as $f) {
        // Una materia sin fila de config se trata como catalogo_general
        // (fail-open): es preferible que sobre una materia a que el profesor se
        // quede con el cuestionario vacío.
        $seccion = $f['seccion'] === null ? 'catalogo_general' : $f['seccion'];
        if ($seccion === 'oculta') {
            continue;
        }
        $id = (int) $f['id'];
        $materias[] = [
            'id'             => $id,
            'clave'          => $f['clave'],
            'nombre'         => $f['nombre'],
            'seccion'        => $seccion,
            'nombreMostrado' => $f['etiqueta'] !== null ? $f['etiqueta'] : $f['nombre'],
            'alias'          => isset($aliasPorVisible[$id]) ? $aliasPorVisible[$id] : [],
            'orden'          => $f['orden'] === null ? null : (int) $f['orden'],
        ];
    }

    // El filtro por lista personalizada va DESPUÉS de descartar las ocultas:
    // profesor_materia_elegible no tiene columna de semestre, así que una
    // materia que el Jefe ocultó este semestre podría reaparecer por seguir en
    // la lista personalizada de alguien.
    if ($modo === 'personalizada') {
        $st = $pdo->prepare('SELECT materia_id FROM profesor_materia_elegible WHERE profesor_id = ?');
        $st->execute([$profesorId]);
        $elegibles = array_flip(array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)));
        $materias = array_values(array_filter($materias, static function ($m) use ($elegibles) {
            return isset($elegibles[$m['id']]);
        }));
    }

    // Por `orden`, con los NULL al final, y a igualdad por nombre mostrado.
    // Se ordena en PHP y no en SQL porque `nombreMostrado` es etiqueta-o-nombre
    // y el filtro de lista personalizada ya corrió; en el ORDER BY habría que
    // repetir esa lógica.
    usort($materias, static function ($a, $b) {
        if ($a['orden'] !== $b['orden']) {
            if ($a['orden'] === null) return 1;
            if ($b['orden'] === null) return -1;
            return $a['orden'] - $b['orden'];
        }
        return strcasecmp(sin_acentos($a['nombreMostrado']), sin_acentos($b['nombreMostrado']));
    });

    return [
        'mostrar_materias'    => true,
        'horas_minimas_verde' => $horasMinimasVerde,
        'materias'            => $materias,
    ];
}

/** La preferencia de un profesor con sus materias y su disponibilidad. */
function preferencia_de(PDO $pdo, int $profesorId, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT id, num_cursos_max, otro_curso, horarios_otro_depto,
                observaciones_cursos, observaciones_horarios, estado, enviado_at
           FROM preferencia WHERE profesor_id = ? AND semestre_id = ?'
    );
    $st->execute([$profesorId, $semestreId]);
    $pref = $st->fetch();
    if ($pref === false) {
        return ['preferencia' => null, 'materias' => [], 'disponibilidad' => []];
    }

    $m = $pdo->prepare('SELECT materia_id, nivel FROM preferencia_materia WHERE preferencia_id = ?');
    $m->execute([$pref['id']]);
    $d = $pdo->prepare('SELECT dia, franja_id, nivel FROM disponibilidad WHERE preferencia_id = ?');
    $d->execute([$pref['id']]);

    return [
        'preferencia'    => $pref,
        'materias'       => $m->fetchAll(),
        'disponibilidad' => $d->fetchAll(),
    ];
}
