<?php
// =============================================================================
// Descarga del paquete para el motor de asignación (autoplanear-entrada/2).
//
//   GET ?semestre_id=N&departamentos=1,2,3&salones=0|1
//          -> el paquete de §3 de malla-horarios/docs/convencion-datos-motor.md
//   GET ?recurso=salones&semestre_id=N&departamentos=1,2,3
//          -> { salones }: cuántos salones activos tienen disponibilidad para
//             esos departamentos (para la casilla "Incluir salones")
//
// El alcance es un departamento o los tres (§1). salones=0 manda salones: []
// (modo sin salones, D44): el motor asigna profesor y horario y deja el salón
// en null. Es lo que se usa mientras no se carguen los salones del semestre.
//
// Cada descarga se registra en motor_descarga con su huella (SHA-256 del
// paquete sin generado_at ni generado_por). Al subir el resultado,
// motor-salida.php rearma el paquete y compara: si la huella cambió, algo se
// movió desde la descarga y el resultado está desfasado (§4.1).
//
// Autorización: solo admin por ahora (D43). Abrirlo a jefatura es cambiar
// exigir_rol a ROLES_GESTION y llamar exigir_jefe_de() con cada departamento.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';
require_once __DIR__ . '/lib/motor.php';

exigir_metodo('GET');
exigir_rol('admin');

$pdo        = db();
$semestreId = param_id('semestre_id');
$deptos     = motor_departamentos($pdo, (string) filter_input(INPUT_GET, 'departamentos'));
exigir_semestre_activo($pdo, $semestreId);

if (filter_input(INPUT_GET, 'recurso') === 'salones') {
    $st = $pdo->prepare(
        'SELECT COUNT(DISTINCT s.id)
           FROM salon s JOIN salon_disponibilidad_departamento sdd ON sdd.salon_id = s.id
          WHERE s.activo = 1 AND sdd.semestre_id = ? AND sdd.departamento_id IN (' . motor_marcas($deptos) . ')'
    );
    $st->execute(array_merge([$semestreId], $deptos));
    responder(['salones' => (int) $st->fetchColumn()]);
}

$conSalones = filter_input(INPUT_GET, 'salones') === '1';

$st = $pdo->prepare('SELECT id, tipo, anio FROM semestre WHERE id = ?');
$st->execute([$semestreId]);
$semestre = $st->fetch();

$yo = mi_perfil();
$generadoAt = motor_ahora();

try {
    $rej = motor_rejilla($pdo);
    $entrada = motor_armar_entrada(
        $pdo, $rej, $semestre, $deptos, $conSalones, $generadoAt,
        ['id' => (int) $yo['id'], 'nombre' => $yo['nombre']]
    );
    // Dos descargas en el mismo segundo con el mismo alcance son el mismo
    // paquete: se queda la última.
    $pdo->prepare(
        'INSERT INTO motor_descarga
                (semestre_id, departamentos, con_salones, generado_at, huella, generado_por, descargado_at)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE con_salones = VALUES(con_salones), huella = VALUES(huella),
                                 generado_por = VALUES(generado_por), descargado_at = VALUES(descargado_at)'
    )->execute([
        $semestreId, implode(',', $deptos), $conSalones ? 1 : 0, $generadoAt,
        motor_huella($entrada), mi_id(), ahora_utc(),
    ]);
} catch (Throwable $e) {
    fallo_interno('motor-entrada.php', $e, 'No se pudo armar el paquete para el motor');
}

responder(motor_entrada_json($entrada));
