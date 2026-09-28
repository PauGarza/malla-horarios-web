<?php
// =============================================================================
// GET -> { perfil, departamentos, franjas, semestre }
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

exigir_metodo('GET');

$pdo = db();
$perfil = mi_perfil();

$departamentos = $pdo->query('SELECT id, nombre FROM departamento ORDER BY id')->fetchAll();

$franjas = $pdo->query(
    'SELECT id, hora_inicio, hora_fin, orden FROM franja_horaria ORDER BY orden'
)->fetchAll();

// El semestre "actual" es el de id más alto, igual que hacían las 3 pantallas
// con order=id.desc&limit=1. No hay columna que marque cuál está abierto; si
// algún día la hay, este es el único lugar que cambia.
//
// `etiqueta` se calcula aquí y no es columna: MariaDB 5.5 tiene columnas
// calculadas con otra sintaxis y con restricciones sobre la expresión, y no
// vale arriesgar el arranque del esquema por un dato derivado de las otras dos
// columnas. Este es el único lugar del sistema que la consulta.
// Un ENUM en contexto de cadena da su etiqueta directamente, así que CONCAT
// basta — el CASE del original de Postgres existía solo porque allá el cast
// enum->text no es IMMUTABLE y una columna generada lo exige.
$semestre = $pdo->query(
    'SELECT id, tipo, anio, CONCAT(tipo, \'-\', anio) AS etiqueta
       FROM semestre ORDER BY id DESC LIMIT 1'
)->fetch();

responder([
    'perfil' => [
        'id'                      => (int) $perfil['id'],
        'cu'                      => $perfil['cu'],
        'nombre'                  => $perfil['nombre'],
        'rol'                     => $perfil['rol'],
        'departamento_id'         => $perfil['departamento_id'] === null ? null : (int) $perfil['departamento_id'],
        'tipo_contrato'           => $perfil['tipo_contrato'],
        'modo_materias_elegibles' => $perfil['modo_materias_elegibles'],
        'password_predeterminada' => (int) $perfil['password_predeterminada'] === 1,
        'estado_especial'         => $perfil['estado_especial'],
    ],
    'departamentos' => $departamentos,
    'franjas'       => $franjas,
    // null si la base todavía no tiene ningún semestre: la pantalla decide qué
    // decir, el endpoint no inventa uno.
    'semestre'      => $semestre === false ? null : $semestre,
]);
