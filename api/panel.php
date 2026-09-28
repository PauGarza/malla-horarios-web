<?php
// =============================================================================
// GET ?semestre_id=N                 -> { filas[] }
// GET ?semestre_id=N&profesor_id=M   -> { profesor, cuestionario, preferencia,
//                                         materias[], disponibilidad[] }
//
// Sin profesor_id: el panel de "quién ya contestó", el roster con su
// preferencia de ese semestre pegada. Reemplaza los 3 GET de
// PanelPreferencias.jsx y el Map que los unía en el cliente.
//
// Con profesor_id: el formulario YA CONTESTADO de un profesor del
// departamento, en solo lectura. Es la vista que el Jefe abre desde el panel, y
// necesita el MISMO catálogo que vio quien lo llenó — por eso lo arma
// lib/catalogo.php y no una consulta propia.
//
// Políticas que reemplaza:
//   roster_departamento_select              -> admin ve todo; jefe, su depto
//   departamento_preferencia_select         -> el JOIN nunca sale del depto
//   departamento_preferencia_materia_select -> igual
//   departamento_disponibilidad_select      -> igual
//   REVOKE/GRANT por columna en profesor    -> lista explícita, sin password_hash
//
// Hoy esta pantalla pide /profesor SIN filtrar por departamento y confía en que
// RLS la acote. Aquí el WHERE es explícito: si la guardia falla, falla cerrado.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';

exigir_metodo('GET');
exigir_rol(...ROLES_GESTION);

$pdo        = db();
$semestreId = param_id('semestre_id');
$veTodos    = ve_todos_los_departamentos();

// -----------------------------------------------------------------------------
// Detalle de un profesor
// -----------------------------------------------------------------------------

$profesorId = filter_input(INPUT_GET, 'profesor_id', FILTER_VALIDATE_INT);
if ($profesorId !== false && $profesorId !== null) {
    $st = $pdo->prepare(
        'SELECT id, nombre, departamento_id, tipo_contrato, modo_materias_elegibles, estado_especial
           FROM profesor WHERE id = ?'
    );
    $st->execute([(int) $profesorId]);
    $objetivo = $st->fetch();
    if (!$objetivo) {
        error_json('No existe ese profesor', 404);
    }
    // La guardia va ANTES de leer nada suyo: un jefe solo abre formularios de
    // su propio departamento.
    exigir_jefe_de($objetivo['departamento_id'] === null ? null : (int) $objetivo['departamento_id']);

    $cuestionario = cuestionario_de(
        $pdo,
        (int) $objetivo['id'],
        $objetivo['departamento_id'] === null ? null : (int) $objetivo['departamento_id'],
        (string) $objetivo['modo_materias_elegibles'],
        $semestreId
    );

    responder(array_merge(
        [
            'profesor' => [
                'id'                      => (int) $objetivo['id'],
                'nombre'                  => $objetivo['nombre'],
                'departamento_id'         => $objetivo['departamento_id'] === null ? null : (int) $objetivo['departamento_id'],
                'tipo_contrato'           => $objetivo['tipo_contrato'],
                'modo_materias_elegibles' => $objetivo['modo_materias_elegibles'],
                'estado_especial'         => $objetivo['estado_especial'],
            ],
            'cuestionario' => $cuestionario,
        ],
        preferencia_de($pdo, (int) $objetivo['id'], $semestreId)
    ));
}

// tipo_contrato IS NOT NULL y activo = 1 dejan fuera las cuentas que no dan
// clases (admin/servicios escolares/nómina), las de prueba y a quien ya se
// jubiló: el panel es "quién falta por contestar" y esa gente no cuenta.
$sql =
    'SELECT p.id, p.nombre, p.departamento_id, p.tipo_contrato,
            p.modo_materias_elegibles, p.estado_especial,
            pref.id AS preferencia_id, pref.estado, pref.enviado_at
       FROM profesor p
       LEFT JOIN preferencia pref
              ON pref.profesor_id = p.id AND pref.semestre_id = ?
      WHERE p.tipo_contrato IS NOT NULL AND p.activo = 1';

$args = [$semestreId];
if (!$veTodos) {
    $depto = mi_departamento();
    if ($depto === null) {
        // Un jefe_departamento sin departamento no debería existir (lo impide
        // chk_profesor_depto), pero si pasa, no ve a nadie en vez de ver a todos.
        error_json('Tu cuenta no tiene departamento asignado', 403);
    }
    $sql .= ' AND p.departamento_id = ?';
    $args[] = $depto;
}
$sql .= ' ORDER BY p.nombre';

$st = $pdo->prepare($sql);
$st->execute($args);

$filas = [];
foreach ($st->fetchAll() as $f) {
    $filas[] = [
        'profesorId'     => (int) $f['id'],
        'nombre'         => $f['nombre'],
        'departamentoId' => $f['departamento_id'] === null ? null : (int) $f['departamento_id'],
        'estadoEspecial' => $f['estado_especial'],
        // El formulario en solo lectura se arma alrededor de este objeto, así
        // que lleva justo lo que ese componente lee.
        'profesor' => [
            'id'                      => (int) $f['id'],
            'nombre'                  => $f['nombre'],
            'departamento_id'         => $f['departamento_id'] === null ? null : (int) $f['departamento_id'],
            'tipo_contrato'           => $f['tipo_contrato'],
            'modo_materias_elegibles' => $f['modo_materias_elegibles'],
        ],
        'preferenciaId' => $f['preferencia_id'] === null ? null : (int) $f['preferencia_id'],
        'estado'        => $f['estado'] === null ? 'no_iniciado' : $f['estado'],
        'enviadoAt'     => $f['enviado_at'],
    ];
}

responder(['filas' => $filas]);
