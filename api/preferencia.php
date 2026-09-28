<?php
// =============================================================================
// GET ?semestre_id=N  -> { preferencia, materias[], disponibilidad[] }
// PUT ?semestre_id=N  -> { id, estado }
//
// La propia preferencia del profesor que llama. Es el endpoint que guarda lo
// que capturan los profesores y el que arregla un problema real del diseño
// actual: hoy el frontend hace DELETE de preferencia_materia y luego INSERT
// masivo en DOS peticiones HTTP separadas (más otras dos para disponibilidad).
// Si la segunda falla, el profesor se queda con sus respuestas borradas. Aquí
// es una transacción.
//
// Políticas que reemplaza:
//   propia_preferencia_select      -> WHERE profesor_id = mi_id()
//   propia_preferencia_insert      -> profesor_id se escribe con mi_id(),
//                                     nunca con lo que venga en el cuerpo
//   propia_preferencia_update      -> exige estado = 'borrador'
//   propia_preferencia_materia     -> preferencia_id derivado de mi_id()
//   propia_disponibilidad          -> igual
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';

exigir_metodo('GET', 'PUT');

$pdo        = db();
$yo         = mi_id();
$semestreId = param_id('semestre_id');

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

if (metodo_http() === 'GET') {
    responder(preferencia_de($pdo, $yo, $semestreId));
}

// -----------------------------------------------------------------------------
// PUT: guardar borrador o enviar
// -----------------------------------------------------------------------------

$body   = cuerpo_json();
$estado = isset($body['estado']) ? (string) $body['estado'] : 'borrador';
if (!in_array($estado, ['borrador', 'enviado'], true)) {
    error_json('Estado inválido', 400);
}

$numCursos = filter_var(isset($body['num_cursos_max']) ? $body['num_cursos_max'] : null, FILTER_VALIDATE_INT);
// Se valida aquí y no solo con el CHECK porque en MySQL < 8.0.16 los CHECK se
// ignoran en silencio (ver bd/mysql/README.md) y este es el único camino por el
// que ese valor entra a la base.
if ($numCursos === false || $numCursos === null || $numCursos < 1 || $numCursos > 6) {
    error_json('El número de cursos debe estar entre 1 y 6', 400, 'cursos_invalidos');
}

$niveles = ['verde', 'amarillo', 'rojo'];
$dias    = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];

$pdo->beginTransaction();
try {
    // FOR UPDATE: dos pestañas del mismo profesor guardando a la vez no deben
    // acabar en dos filas de preferencia para el mismo semestre.
    $st = $pdo->prepare(
        'SELECT id, estado FROM preferencia WHERE profesor_id = ? AND semestre_id = ? FOR UPDATE'
    );
    $st->execute([$yo, $semestreId]);
    $existente = $st->fetch();

    // propia_preferencia_update exigía estado = 'borrador': una vez enviada, el
    // profesor ya no edita por su cuenta. Reabrirla es tarea del Jefe
    // (reabrir.php). Se revisa aquí porque es LA regla de esta pantalla.
    if ($existente && $existente['estado'] === 'enviado') {
        $pdo->rollBack();
        error_json(
            'Tus preferencias ya fueron enviadas. Pide a tu Jefe de Departamento que reabra el formulario.',
            409,
            'ya_enviada'
        );
    }

    $campos = [
        $numCursos,
        texto_opcional($body, 'otro_curso'),
        texto_opcional($body, 'horarios_otro_depto'),
        texto_opcional($body, 'observaciones_cursos'),
        texto_opcional($body, 'observaciones_horarios'),
        $estado,
        $estado === 'enviado' ? ahora_utc() : null,
    ];

    if ($existente) {
        $prefId = (int) $existente['id'];
        $pdo->prepare(
            'UPDATE preferencia SET num_cursos_max=?, otro_curso=?, horarios_otro_depto=?,
                    observaciones_cursos=?, observaciones_horarios=?, estado=?, enviado_at=?
              WHERE id = ? AND profesor_id = ?'
        )->execute(array_merge($campos, [$prefId, $yo]));
    } else {
        // profesor_id de mi_id(), NUNCA del cuerpo (propia_preferencia_insert).
        $pdo->prepare(
            'INSERT INTO preferencia (profesor_id, semestre_id, num_cursos_max, otro_curso,
                    horarios_otro_depto, observaciones_cursos, observaciones_horarios, estado, enviado_at)
             VALUES (?,?,?,?,?,?,?,?,?)'
        )->execute(array_merge([$yo, $semestreId], $campos));
        $prefId = (int) $pdo->lastInsertId();
    }

    // Borrar + reinsertar, pero DENTRO de la transacción: si el insert falla, el
    // delete se deshace. Hoy son dos peticiones HTTP y no hay nada que deshacer.
    $pdo->prepare('DELETE FROM preferencia_materia WHERE preferencia_id = ?')->execute([$prefId]);
    if (!empty($body['materias']) && is_array($body['materias'])) {
        $ins = $pdo->prepare(
            'INSERT INTO preferencia_materia (preferencia_id, materia_id, nivel, cobertura_departamental)
             VALUES (?,?,?,?)'
        );
        foreach ($body['materias'] as $m) {
            $materiaId = is_array($m)
                ? filter_var(isset($m['materia_id']) ? $m['materia_id'] : null, FILTER_VALIDATE_INT)
                : false;
            $nivel = is_array($m) && isset($m['nivel']) ? (string) $m['nivel'] : '';
            if ($materiaId === false || $materiaId === null || !in_array($nivel, $niveles, true)) {
                $pdo->rollBack();
                error_json('Hay una materia con datos inválidos', 400);
            }
            $ins->execute([
                $prefId,
                $materiaId,
                $nivel,
                empty($m['cobertura_departamental']) ? 0 : 1,
            ]);
        }
    }

    $pdo->prepare('DELETE FROM disponibilidad WHERE preferencia_id = ?')->execute([$prefId]);
    if (!empty($body['disponibilidad']) && is_array($body['disponibilidad'])) {
        $ins = $pdo->prepare(
            'INSERT INTO disponibilidad (preferencia_id, dia, franja_id, nivel) VALUES (?,?,?,?)'
        );
        foreach ($body['disponibilidad'] as $d) {
            if (!is_array($d)) {
                $pdo->rollBack();
                error_json('Hay una celda de disponibilidad con datos inválidos', 400);
            }
            $dia      = isset($d['dia']) ? (string) $d['dia'] : '';
            $franjaId = filter_var(isset($d['franja_id']) ? $d['franja_id'] : null, FILTER_VALIDATE_INT);
            $nivel    = isset($d['nivel']) ? (string) $d['nivel'] : '';
            if (!in_array($dia, $dias, true) || $franjaId === false || $franjaId === null
                || !in_array($nivel, $niveles, true)) {
                $pdo->rollBack();
                error_json('Hay una celda de disponibilidad con datos inválidos', 400);
            }
            $ins->execute([$prefId, $dia, $franjaId, $nivel]);
        }
    }

    $pdo->commit();
    responder(['id' => $prefId, 'estado' => $estado]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fallo_interno('preferencia.php', $e, 'No se pudo guardar');
}
