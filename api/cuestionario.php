<?php
// =============================================================================
// GET ?semestre_id=N
//   -> { publicado: false, secciones: [] }               si no está publicado
//   -> { publicado, texto_introduccion, horas_minimas_verde, secciones[] }
//
// El formulario del profesor que llama, ya resuelto por el servidor: las
// secciones de su departamento que le aplican por tipo de contrato, cada
// sección de materias con sus materias (sin ocultas, con alias pegados y
// ordenadas). Mientras la jefatura no lo publique, no devuelve nada.
//
// Desde 2026-09-28 todos los profesores de un departamento ven el mismo
// formulario: ya no hay lista personalizada por profesor. Lo que la jefatura
// decide por persona (bloqueo_profesor_materia) NO se lee aquí a propósito: el
// profesor nunca debe verlo.
//
// Políticas que reemplaza:
//   catalogo_lectura_autenticados  -> basta con estar autenticado
//
// El armado está en lib/catalogo.php porque preferencia.php valida el envío
// contra el mismo formulario y panel.php lo muestra igual en solo lectura.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/auth.php';
require_once __DIR__ . '/lib/catalogo.php';

exigir_metodo('GET');

responder(cuestionario_de(db(), mi_perfil(), param_id('semestre_id')));
