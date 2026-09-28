<?php
// =============================================================================
// GET ?semestre_id=N -> { mostrar_materias, horas_minimas_verde, materias[] }
//
// El catálogo de materias del cuestionario del profesor que llama, ya resuelto
// por el servidor: filtrado por su departamento, sin las ocultas, con los alias
// pegados a la materia visible, acotado a su lista personalizada si la tiene, y
// ordenado.
//
// Reemplaza 4 llamados del load de FormularioPreferencias.jsx:
//   /departamento_semestre_config?departamento_id=eq.X&semestre_id=eq.Y
//   /materia?departamento_id=eq.X&activa=eq.true
//   /materia_cuestionario?semestre_id=eq.Y
//   /profesor_materia_elegible?profesor_id=eq.Z
//
// Políticas que reemplaza:
//   catalogo_lectura_autenticados  -> basta con estar autenticado
//   propia_elegibilidad            -> WHERE profesor_id = mi_id()
//
// El armado está en lib/catalogo.php porque panel.php lo usa igual para la
// vista de solo lectura del Jefe: si estuviera duplicado, las dos vistas se
// desincronizarían.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';

exigir_metodo('GET');

$semestreId = param_id('semestre_id');
$perfil     = mi_perfil();

responder(cuestionario_de(
    db(),
    (int) $perfil['id'],
    $perfil['departamento_id'] === null ? null : (int) $perfil['departamento_id'],
    (string) $perfil['modo_materias_elegibles'],
    $semestreId
));
