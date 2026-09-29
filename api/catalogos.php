<?php
// =============================================================================
// GET -> { perfil, departamentos, franjas, semestre, formulario_publicado }
//
// Lo que toda pantalla necesita al arrancar, en una sola petición. Reemplaza:
//   - AuthContext.cargarPerfil: /profesor?...&id=eq.X  y  /departamento
//   - /semestre?order=id.desc&limit=1   (lo pedían 3 pantallas por separado)
//   - /franja_horaria?order=orden.asc   (FormularioPreferencias)
//
// Políticas que reemplaza:
//   propio_perfil_select            -> WHERE id = mi_id(), en mi_perfil()
//   catalogo_lectura_autenticados   -> basta con que sesion() no haya cortado
//   REVOKE/GRANT por columna        -> mi_perfil() lista columnas explícitas,
//                                      nunca SELECT * sobre profesor
//
// Aquí muere el filtro `&id=eq.${miId}` que AuthContext.jsx hacía "además de
// RLS": era un parche a un bug real del 2026-09-21, donde la primera fila que
// regresaba podía ser la de un colega si quien entraba era Jefe. Sin
// profesorIdDelToken en el cliente, el bug no tiene dónde volver a aparecer.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';
require_once __DIR__ . '/lib/semestre.php';

exigir_metodo('GET');

$pdo = db();
$perfil = mi_perfil();

$departamentos = $pdo->query('SELECT id, nombre FROM departamento ORDER BY id')->fetchAll();

$franjas = $pdo->query(
    'SELECT id, hora_inicio, hora_fin, orden FROM franja_horaria ORDER BY orden'
)->fetchAll();

// El semestre en el que se trabaja: el ACTIVO (semestre.estado, desde
// 2026-09-29). Antes era el de id más alto, porque no había columna que
// marcara cuál estaba abierto. Lo cambian admin y jefa de división desde la
// vista de Semestres (api/semestres.php).
//
// `etiqueta` se calcula al leer y no es columna: MariaDB 5.5 tiene columnas
// calculadas con otra sintaxis y restricciones, y no vale arriesgar el
// esquema por un dato derivado de las otras dos columnas.
$semestre = semestre_activo($pdo);

// Para que el inicio diga "aún no disponible" sin tener que pedir el
// formulario completo.
$formularioPublicado = $semestre !== null && $perfil['departamento_id'] !== null
    && config_formulario($pdo, (int) $perfil['departamento_id'], (int) $semestre['id'])['publicado'];

responder([
    'perfil' => [
        'id'                      => (int) $perfil['id'],
        'cu'                      => $perfil['cu'],
        'nombre'                  => $perfil['nombre'],
        'rol'                     => $perfil['rol'],
        'departamento_id'         => $perfil['departamento_id'] === null ? null : (int) $perfil['departamento_id'],
        'tipo_contrato'           => $perfil['tipo_contrato'],
        'password_predeterminada' => (int) $perfil['password_predeterminada'] === 1,
        'estado_especial'         => $perfil['estado_especial'],
    ],
    'departamentos' => $departamentos,
    'franjas'       => $franjas,
    // null si la base todavía no tiene ningún semestre: la pantalla decide qué
    // decir, el endpoint no inventa uno.
    'semestre'      => $semestre,
    'formulario_publicado' => $formularioPublicado,
]);
