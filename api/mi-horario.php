<?php
// =============================================================================
// "Mi horario" en el perfil (2026-11-03).
//
//   GET -> { activa: false }
//        | { activa: true, clases, avisado_at }   clases null = aún no se le avisa
//
// Es lo único de horarios que puede pedir un profesor: la vista la enciende la
// jefatura de su departamento, para todos menos los que desmarque
// (api/aviso-horario.php), y solo devuelve lo último que
// se le avisó, desde la bitácora. Nunca lee la malla: un ajuste a medias de la
// jefatura no debe aparecer aquí, ni algo distinto de lo que recibió por correo.
// El profesor sale del token, nunca del cuerpo ni de la URL.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET');

$pdo   = db();
$id    = mi_id();
$depto = mi_departamento();

$semestre = semestre_activo($pdo);
if ($semestre === null || $depto === null) {
    responder(['activa' => false]);
}
$semestreId = (int) $semestre['id'];

$st = $pdo->prepare('SELECT perfil_activo, perfil_excluidos FROM aviso_horario WHERE semestre_id = ? AND departamento_id = ?');
$st->execute([$semestreId, $depto]);
$vista = $st->fetch();
if (!$vista || (int) $vista['perfil_activo'] !== 1) {
    responder(['activa' => false]);
}
// La jefatura puede desmarcar a alguien: para esa persona la vista no existe.
$excluidos = $vista['perfil_excluidos'] === null ? [] : json_decode((string) $vista['perfil_excluidos'], true);
if (is_array($excluidos) && in_array($id, $excluidos, true)) {
    responder(['activa' => false]);
}

$st = $pdo->prepare(
    "SELECT clases, creado_at FROM aviso_horario_envio
      WHERE semestre_id = ? AND profesor_id = ? AND estado IN ('enviado', 'marcado')
      ORDER BY id DESC LIMIT 1"
);
$st->execute([$semestreId, $id]);
$ultimo = $st->fetch();
if (!$ultimo) {
    responder(['activa' => true, 'clases' => null, 'avisado_at' => null]);
}

$avisado = new DateTime((string) $ultimo['creado_at'], new DateTimeZone('UTC'));
$avisado->setTimezone(new DateTimeZone('America/Mexico_City'));
responder([
    'activa'     => true,
    'clases'     => json_decode((string) $ultimo['clases'], true),
    'avisado_at' => $avisado->format('Y-m-d\TH:i:sP'),
]);
