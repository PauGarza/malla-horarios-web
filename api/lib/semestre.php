<?php
// =============================================================================
// El semestre activo.
//
// Desde 2026-09-29 hay exactamente UN semestre activo: el que se está
// planeando. Los cerrados quedan de consulta. Antes el "actual" era el de id
// más alto y nada impedía escribir en uno viejo.
//
// Toda escritura que cuelga de un semestre pasa por exigir_semestre_activo():
// preferencias, formulario, publicación, bloqueos, reabrir y demanda. Leer
// semestres cerrados sigue permitido: es el histórico.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';

/** El semestre activo, o null si la base no tiene ninguno. */
function semestre_activo(PDO $pdo): ?array
{
    $fila = $pdo->query(
        'SELECT id, tipo, anio, CONCAT(tipo, \'-\', anio) AS etiqueta, estado, abierto_at
           FROM semestre WHERE estado = \'activo\' ORDER BY id DESC LIMIT 1'
    )->fetch();
    return $fila === false ? null : $fila;
}

/** Corta con 409 si ese semestre no es el activo. */
function exigir_semestre_activo(PDO $pdo, int $semestreId): void
{
    $st = $pdo->prepare('SELECT estado FROM semestre WHERE id = ?');
    $st->execute([$semestreId]);
    $estado = $st->fetchColumn();
    if ($estado === false) {
        error_json('No existe ese semestre', 404);
    }
    if ($estado !== 'activo') {
        error_json(
            'Ese semestre ya está cerrado: solo se puede consultar. Se trabaja sobre el semestre activo.',
            409,
            'semestre_cerrado'
        );
    }
}
