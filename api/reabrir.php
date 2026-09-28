<?php
// =============================================================================
// POST { preferencia_id } -> { ok: true }
//
// Corto a propósito: es el endpoint que reemplaza una política MÁS un trigger.
//
//   jefe_preferencia_reapertura   -> exigir_jefe_de(depto del profesor dueño)
//   trg_limitar_reapertura_jefe   -> se borra
//
// El trigger existía porque la política RLS era necesariamente más amplia que
// su intención (dejaba al Jefe editar también las respuestas) y había que
// acotarla a estado/enviado_at. Este UPDATE no puede tocar las respuestas: no
// las menciona. No hay nada que acotar.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';

exigir_metodo('POST');
exigir_rol(...ROLES_GESTION);

$body   = cuerpo_json();
$prefId = filter_var(isset($body['preferencia_id']) ? $body['preferencia_id'] : null, FILTER_VALIDATE_INT);
if ($prefId === false || $prefId === null || $prefId < 1) {
    error_json('Falta preferencia_id', 400);
}

// Que la preferencia sea de un profesor del departamento de quien reabre.
$st = db()->prepare(
    'SELECT p.departamento_id FROM preferencia pref
       JOIN profesor p ON p.id = pref.profesor_id
      WHERE pref.id = ?'
);
$st->execute([$prefId]);
$depto = $st->fetchColumn();
if ($depto === false) {
    error_json('No existe esa preferencia', 404);
}
exigir_jefe_de($depto === null ? null : (int) $depto);

db()->prepare("UPDATE preferencia SET estado = 'borrador', enviado_at = NULL WHERE id = ?")
    ->execute([$prefId]);

responder(['ok' => true]);
