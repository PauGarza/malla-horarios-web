<?php
// =============================================================================
// El aviso de horarios a los profesores (2026-11-03). Lo usan aviso-horario.php
// y mi-horario.php.
//
// Aquí se arma el correo, una sola vez: la vista previa, la prueba y el envío
// real pasan por aviso_armar_correo(), así que lo que ve el jefe es lo que sale.
//
// El cuerpo se guarda como HTML limitado (aviso_limpiar_cuerpo) con los campos
// como texto: "[NOMBRE]". El editor los pinta como cajitas; el HTML guardado no
// sabe nada de eso.
//
// Las clases salen de la malla actual (motor_clases): junta las claves espejo de
// una clase y no cuenta al "Profesor por asignar". NUNCA se lee el salón: hoy la
// base tiene salones de prueba, y Servicios Escolares asigna los reales después.
// =============================================================================

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/correo.php';
require_once __DIR__ . '/motor.php';

const AVISO_CONTRATOS = ['tiempo_completo', 'medio_tiempo', 'asignatura'];
const AVISO_CAMPO_LISTA = '[LISTA DE CLASES]';
const AVISO_CAMPO_PERFIL = '[AVISO DEL PERFIL]';
const AVISO_MAX_COPIAS = 10;
const AVISO_MAX_VERSIONES = 10;
const AVISO_MAX_CUERPO = 100000;

// Las respuestas al aviso le llegan de inicio al jefe de cada departamento, por
// clave_prefijo, y se puede editar en la pantalla (decisión de la usuaria,
// 2026-11-03). Un departamento sin jefe usa la primera dirección de "Copiar a".
// Desde 2026-11-05 el aviso también sale de esta dirección (aviso_correo_remitente).
// Las direcciones viven en 'aviso_jefes' de config.php, que no va al repositorio.
function aviso_jefe(array $departamento): ?string
{
    $jefes = config_o('aviso_jefes', []);
    return $jefes[$departamento['clave_prefijo']] ?? null;
}

// Como TIPO_CONTRATO_LABELS de frontend/src/lib/roles.js.
const AVISO_TIPOS_PROFESOR = [
    'tiempo_completo' => 'Tiempo Completo',
    'medio_tiempo'    => 'Medio Tiempo',
    'asignatura'      => 'Asignatura',
];

const AVISO_DIAS_LARGO = [
    'lunes' => 'lunes', 'martes' => 'martes', 'miercoles' => 'miércoles',
    'jueves' => 'jueves', 'viernes' => 'viernes', 'sabado' => 'sábado',
];
const AVISO_DIAS_CODIGO = [
    'lunes' => 'LU', 'martes' => 'MA', 'miercoles' => 'MI',
    'jueves' => 'JU', 'viernes' => 'VI', 'sabado' => 'SA',
];
const AVISO_DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const AVISO_MESES = [
    1 => 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Los campos que la jefatura arrastra al correo, en el orden de la paleta. */
function aviso_campos(): array
{
    return [
        ['campo' => '[NOMBRE]', 'grupo' => 'datos'],
        ['campo' => '[TIPO DE PROFESOR]', 'grupo' => 'datos'],
        ['campo' => '[DEPARTAMENTO]', 'grupo' => 'datos'],
        ['campo' => '[PERIODO]', 'grupo' => 'datos'],
        ['campo' => '[MESES DEL SEMESTRE]', 'grupo' => 'datos'],
        ['campo' => '[MES DE ENVÍO]', 'grupo' => 'datos'],
        ['campo' => AVISO_CAMPO_LISTA, 'grupo' => 'datos'],
        ['campo' => AVISO_CAMPO_PERFIL, 'grupo' => 'datos'],
        ['campo' => '[FECHA DE INICIO DEL SEMESTRE]', 'grupo' => 'fechas'],
        ['campo' => '[FECHA LÍMITE DE BAJAS]', 'grupo' => 'fechas'],
        ['campo' => '[FECHA DE FIN DEL SEMESTRE]', 'grupo' => 'fechas'],
        ['campo' => '[FECHAS DE EXÁMENES FINALES]', 'grupo' => 'fechas'],
    ];
}

// -----------------------------------------------------------------------------
// Textos
// -----------------------------------------------------------------------------

/** Lo que dice [AVISO DEL PERFIL] en el correo de quien sí ve Mi horario. */
function aviso_frase_perfil(): string
{
    return 'También podrá consultar sus materias y horarios asignados en su perfil del sistema: '
        . config_o('url_publica', 'https://horariosdace.itam.mx');
}

/** Las frases que se agregan a los tres formatos: el salón y el perfil. */
function aviso_frases_agregadas(): string
{
    return '<p>Por el momento no hay salón asignado; Servicios Escolares lo asignará después del 13 de noviembre.</p>'
        . '<p>' . AVISO_CAMPO_PERFIL . '</p>';
}

/**
 * La frase del perfil como campo. Los borradores guardados antes de la cajita la
 * traen como texto, y así no se podría omitir a quien no ve la vista.
 */
function aviso_frase_a_campo(string $cuerpo): string
{
    return str_replace(htmlspecialchars(aviso_frase_perfil(), ENT_QUOTES, 'UTF-8'), AVISO_CAMPO_PERFIL, $cuerpo);
}

/** Los ids de los profesores que la jefatura desmarcó de Mi horario. */
function aviso_leer_excluidos(PDO $pdo, int $semestreId, int $deptoId): array
{
    $st = $pdo->prepare('SELECT perfil_excluidos FROM aviso_horario WHERE semestre_id = ? AND departamento_id = ?');
    $st->execute([$semestreId, $deptoId]);
    $lista = json_decode((string) $st->fetchColumn(), true);
    return is_array($lista) ? array_map('intval', $lista) : [];
}

function aviso_membrete_estadistica(bool $conCorreo): string
{
    return '<p><strong>Instituto Tecnológico Autónomo de México</strong><br>'
        . 'Departamento Académico de Estadística<br>'
        . 'Río Hondo 1, Progreso Tizapán<br>'
        . 'México 01080 Ciudad de México<br>'
        . ($conCorreo ? 'depest@itam.mx<br>' : '')
        . 'http://estadistica.itam.mx<br>'
        . 'Tel: 555628-4084</p>'
        . '<p><strong>M E M O R A N D U M</strong></p>'
        . '<p>[MES DE ENVÍO]</p>'
        . '<p>Para: Profesor de [TIPO DE PROFESOR] del Departamento Académico de [DEPARTAMENTO]</p>'
        . '<p>De: Jefe del Departamento Académico de [DEPARTAMENTO]</p>'
        . '<p>Apreciable [NOMBRE]:</p>';
}

/**
 * Los formatos que mandó cada departamento (decisión de la usuaria, 2026-11-03):
 * los espacios por llenar son campos, y se agregan las dos frases de
 * aviso_frases_agregadas(). Lo único corregido, a petición suya: el singular con
 * varias clases, "durante el semestre" y "terminaremos el semestre el". No cambiar
 * más la redacción aquí sin que lo pida; cada jefe la edita en la pantalla.
 */
function aviso_plantillas(): array
{
    $agregadas = aviso_frases_agregadas();
    $asunto = 'Cursos y horarios asignados – [PERIODO]';

    $bajasYFin = '<li>La <strong>fecha límite de bajas es el [FECHA LÍMITE DE BAJAS]</strong>, terminaremos el semestre el '
        . '[FECHA DE FIN DEL SEMESTRE] para pasar a las semanas de exámenes finales del [FECHAS DE EXÁMENES FINALES].</li>';

    return [
        'matematicas' => [
            'nombre'    => 'Todos los profesores',
            'contratos' => AVISO_CONTRATOS,
            'asunto'    => $asunto,
            'cuerpo'    => '<p>Apreciable [NOMBRE]:</p>'
                . '<p>Le informamos los cursos y horarios que le fueron asignados para el semestre [PERIODO]:</p>'
                . '<p>' . AVISO_CAMPO_LISTA . '</p>'
                . $agregadas
                . '<p>Como es de su conocimiento, la asignación de cursos constituye un proceso complejo que, en ocasiones, '
                . 'requiere ajustes. Dependiendo lo que nos indique Servicio Escolares y las necesidades de nuestro departamento, '
                . 'existe la posibilidad de que sea necesario una modificación de horario, de materia y/o de número de cursos '
                . 'asignados, si fuera el caso nos pondríamos en contacto con usted.</p>'
                . '<p>La fecha de inicio del semestre de [PERIODO] es [FECHA DE INICIO DEL SEMESTRE] y termina el '
                . '[FECHA DE FIN DEL SEMESTRE]. Los exámenes finales están programados del [FECHAS DE EXÁMENES FINALES].</p>'
                . '<p>Además, le recordamos que la apertura de cada curso está sujeta a que haya suficientes alumnos inscritos. '
                . 'Dicha información se sabe unos días antes de iniciar el semestre, si alguno de sus grupos no se abre nos '
                . 'pondremos en contacto con usted.</p>'
                . '<p>Cordialmente,<br>El departamento de [DEPARTAMENTO] del ITAM</p>',
        ],
        'estadistica_tc' => [
            'nombre'    => 'Tiempo completo',
            'contratos' => ['tiempo_completo'],
            'asunto'    => $asunto,
            'cuerpo'    => aviso_membrete_estadistica(true)
                . '<p>Le envío un caluroso saludo esperando se encuentre bien. A continuación, encontrará los horarios de las '
                . 'materias que impartirá durante el semestre [MESES DEL SEMESTRE].</p>'
                . '<p>' . AVISO_CAMPO_LISTA . '</p>'
                . $agregadas
                . '<p><strong>Le recordamos algunas indicaciones respecto al semestre.</strong></p>'
                . '<ul>'
                . '<li><strong>El semestre [PERIODO] dará inicio el día [FECHA DE INICIO DEL SEMESTRE].</strong></li>'
                . '<li>Es importante que tome en consideración que <strong>no habrá cambios de salones</strong>, salvo que '
                . 'Dirección Escolar lo solicite. Por lo tanto, las clases se tendrán que impartir en el salón asignado.</li>'
                . $bajasYFin
                . '<li>Las actas electrónicas deberán ser entregadas en tiempo dentro de las 48 horas establecidas en el '
                . 'reglamento. El cumplimiento de esta entrega, en la fecha correspondiente, permitirá que los alumnos se '
                . 'inscriban al verano o siguiente semestre oportunamente.</li>'
                . '</ul>'
                . '<p>Con un cordial saludo, quedo a sus órdenes.</p>',
        ],
        'estadistica_tp' => [
            'nombre'    => 'Medio tiempo y asignatura',
            'contratos' => ['medio_tiempo', 'asignatura'],
            'asunto'    => $asunto,
            'cuerpo'    => aviso_membrete_estadistica(false)
                . '<p>Le envío un caluroso saludo esperando se encuentre bien. A continuación, encontrará los horarios de las '
                . 'materias que impartirá durante el semestre [MESES DEL SEMESTRE].</p>'
                . '<p>' . AVISO_CAMPO_LISTA . '</p>'
                . $agregadas
                . '<p><strong>Le recuerdo algunas indicaciones respecto al semestre [PERIODO].</strong></p>'
                . '<ul>'
                . '<li><strong>El semestre [PERIODO] dará inicio el día [FECHA DE INICIO DEL SEMESTRE].</strong></li>'
                . '<li>Los cursos de Estadística I, Estadística II, Probabilidad, Inferencia Estadística, Cálculo de '
                . 'Probabilidades I y Cálculo de Probabilidades II están sujetos a una coordinación por parte del Departamento '
                . 'Académico de Estadística. <strong>Los Profesores de los cursos coordinados deben mantener comunicación '
                . 'constante con su respectivo coordinador, así como seguir las especificaciones de cada coordinador con el fin '
                . 'de conservar el mismo nivel de los cursos coordinados.</strong></li>'
                . '<li>En caso de que le surja algún inconveniente que impida su asistencia a clase durante el semestre, es '
                . 'importante que lo notifiquen, en cuanto le sea posible, así como la fecha y hora en que se repondrá dicha '
                . 'clase.</li>'
                . '<li>De acuerdo al nuevo reglamento de alumnos, si algún estudiante solicita asistir de oyente a su clase podrá '
                . 'hacerlo, siempre y cuando tenga su autorización, si usted tiene algún caso le solicitamos lo haga saber por '
                . 'correo electrónico al jefe del Departamento Académico.</li>'
                . $bajasYFin
                . '<li>Las actas electrónicas deberán ser entregadas en tiempo dentro de las <strong>48 horas establecidas en el '
                . 'reglamento</strong>. El cumplimiento de esta entrega, en la fecha correspondiente, permitirá que los alumnos '
                . 'se inscriban al siguiente semestre oportunamente.</li>'
                . '</ul>'
                . '<p>Con un cordial saludo, quedo a tus órdenes.</p>',
        ],
    ];
}

/** Las versiones con las que abre un departamento que no tiene borrador. */
function aviso_llaves_iniciales(string $prefijo): array
{
    return $prefijo === 'EST' ? ['estadistica_tc', 'estadistica_tp'] : ['matematicas'];
}

function aviso_periodo_inicial(array $semestre): string
{
    $nombres = ['primavera' => 'Primavera', 'verano' => 'Verano', 'otono' => 'Otoño'];
    return ($nombres[$semestre['tipo']] ?? (string) $semestre['tipo']) . ' ' . $semestre['anio'];
}

function aviso_meses_iniciales(array $semestre): string
{
    $meses = ['primavera' => 'enero – mayo', 'otono' => 'agosto – diciembre'];
    return $meses[$semestre['tipo']] ?? '';
}

/** El borrador de un departamento que todavía no guarda nada. */
function aviso_borrador_inicial(array $semestre, array $departamento): array
{
    $plantillas = aviso_plantillas();
    $versiones = [];
    foreach (aviso_llaves_iniciales((string) $departamento['clave_prefijo']) as $i => $llave) {
        $versiones[] = ['id' => 'v' . ($i + 1), 'plantilla' => $llave] + $plantillas[$llave];
    }
    return [
        'periodo'     => aviso_periodo_inicial($semestre),
        'meses'       => aviso_meses_iniciales($semestre),
        'copias'      => aviso_jefe($departamento) ?? '',
        'respuestas_a' => aviso_jefe($departamento) ?? '',
        'excluidos'   => [],
        'versiones'   => $versiones,
    ];
}

/**
 * A quién le llegan las respuestas: lo capturado en el borrador o, si está vacío, el
 * jefe del departamento. La llave es respuestas_a y no responder_a a propósito: en
 * esa otra quedó guardado el correo de quien abrió la pantalla en la primera versión.
 */
function aviso_responder_a(array $departamento, array $borrador, array $copias): ?string
{
    $capturado = (string) ($borrador['respuestas_a'] ?? '');
    if ($capturado !== '') {
        return $capturado;
    }
    return aviso_jefe($departamento) ?? ($copias[0] ?? null);
}

/** Las direcciones válidas de "Copiar a", sin cortar por las que estén a medio escribir. */
function aviso_copias_validas(string $texto): array
{
    $copias = [];
    foreach (preg_split('/[\s,;]+/', $texto, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $c) {
        if (filter_var($c, FILTER_VALIDATE_EMAIL) !== false) {
            $copias[] = strtolower($c);
        }
    }
    return $copias;
}

// -----------------------------------------------------------------------------
// Validación del borrador
// -----------------------------------------------------------------------------

/** Lista de correos en un campo abierto. Corta con 400 si alguno no parece correo. */
function aviso_parsear_copias(string $texto): array
{
    $copias = [];
    foreach (preg_split('/[\s,;]+/', $texto, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $c) {
        $c = strtolower($c);
        if (strlen($c) > 191 || filter_var($c, FILTER_VALIDATE_EMAIL) === false) {
            error_json("En \"Copiar a\", \"$c\" no parece un correo", 400, 'copia_invalida');
        }
        $copias[$c] = true;
    }
    if (count($copias) > AVISO_MAX_COPIAS) {
        error_json('En "Copiar a" caben hasta ' . AVISO_MAX_COPIAS . ' direcciones', 400, 'demasiadas_copias');
    }
    return array_keys($copias);
}

/** Solo las etiquetas de formato del editor, sin atributos. */
function aviso_limpiar_cuerpo(string $html): string
{
    $html = strip_tags($html, '<p><br><strong><b><em><i><u><ul><ol><li><div>');
    $html = (string) preg_replace('/<(\/?)(p|br|strong|b|em|i|u|ul|ol|li|div)\b[^>]*>/i', '<$1$2>', $html);
    return trim($html);
}

/**
 * Normaliza lo que manda la pantalla y corta con 400 si no sirve.
 * $estricto = false es para la vista previa: se ve mientras se escribe, y un
 * "Copiar a" a medio escribir no debe impedirla.
 */
function aviso_normalizar_borrador($b, bool $estricto = true): array
{
    if (!is_array($b) || !isset($b['versiones']) || !is_array($b['versiones'])) {
        error_json('Falta el borrador', 400);
    }
    if (count($b['versiones']) < 1 || count($b['versiones']) > AVISO_MAX_VERSIONES) {
        error_json('Tiene que haber de 1 a ' . AVISO_MAX_VERSIONES . ' versiones del correo', 400);
    }

    $vistos = [];
    $versiones = [];
    foreach ($b['versiones'] as $v) {
        if (!is_array($v)) {
            error_json('Una versión del correo no es válida', 400);
        }
        $nombre = trim((string) ($v['nombre'] ?? ''));
        if ($nombre === '' || mb_strlen($nombre) > 80) {
            error_json('Cada versión necesita un nombre de hasta 80 caracteres', 400);
        }
        $contratos = is_array($v['contratos'] ?? null) ? array_values(array_unique($v['contratos'])) : [];
        foreach ($contratos as $c) {
            if (!in_array($c, AVISO_CONTRATOS, true)) {
                error_json('Tipo de profesor no válido', 400);
            }
            if (isset($vistos[$c])) {
                error_json('Un tipo de profesor solo puede estar en una versión', 400, 'tipo_repetido');
            }
            $vistos[$c] = true;
        }
        if ($contratos === []) {
            error_json("La versión \"$nombre\" necesita al menos un tipo de profesor", 400, 'version_sin_tipo');
        }
        $asunto = trim((string) ($v['asunto'] ?? ''));
        if ($asunto === '' || mb_strlen($asunto) > 200) {
            error_json("La versión \"$nombre\" necesita un asunto de hasta 200 caracteres", 400, 'asunto_invalido');
        }
        $cuerpo = (string) ($v['cuerpo'] ?? '');
        if (strlen($cuerpo) > AVISO_MAX_CUERPO) {
            error_json("El texto de la versión \"$nombre\" es demasiado largo", 400);
        }
        $versiones[] = [
            'id'        => substr((string) ($v['id'] ?? ''), 0, 20),
            'plantilla' => array_key_exists((string) ($v['plantilla'] ?? ''), aviso_plantillas()) ? (string) $v['plantilla'] : null,
            'nombre'    => $nombre,
            'contratos' => $contratos,
            'asunto'    => $asunto,
            'cuerpo'    => aviso_frase_a_campo(aviso_limpiar_cuerpo($cuerpo)),
        ];
    }

    $copias = (string) ($b['copias'] ?? '');
    if ($estricto) {
        $copias = implode(', ', aviso_parsear_copias($copias));
    }
    // Va a una cabecera: solo un correo válido. A medio escribir, en la vista previa,
    // se ignora y queda el jefe del departamento.
    $respuestas = strtolower(trim((string) ($b['respuestas_a'] ?? '')));
    if ($respuestas !== '' && (strlen($respuestas) > 191 || filter_var($respuestas, FILTER_VALIDATE_EMAIL) === false)) {
        if ($estricto) {
            error_json("En \"Las respuestas llegan a\", \"$respuestas\" no parece un correo", 400, 'respuestas_invalido');
        }
        $respuestas = '';
    }

    $excluidos = [];
    foreach (is_array($b['excluidos'] ?? null) ? $b['excluidos'] : [] as $id) {
        if (is_int($id) && $id > 0) {
            $excluidos[] = $id;
        }
    }

    return [
        'periodo'     => mb_substr(trim((string) ($b['periodo'] ?? '')), 0, 80),
        'meses'       => mb_substr(trim((string) ($b['meses'] ?? '')), 0, 80),
        'copias'      => $copias,
        'respuestas_a' => $respuestas,
        'excluidos'   => $excluidos,
        'versiones'   => $versiones,
    ];
}

/** La versión del borrador que le toca a un tipo de profesor, o null. */
function aviso_version_de(array $borrador, ?string $contrato): ?array
{
    foreach ($borrador['versiones'] as $v) {
        if (in_array($contrato, $v['contratos'], true)) {
            return $v;
        }
    }
    return null;
}

// -----------------------------------------------------------------------------
// Fechas
// -----------------------------------------------------------------------------

/** Una fecha 'Y-m-d' de un formulario, o null si viene vacía. Corta con 400 si no es fecha. */
function aviso_fecha_valida($valor, string $etiqueta): ?string
{
    if ($valor === null || $valor === '') {
        return null;
    }
    $d = is_string($valor) ? DateTime::createFromFormat('!Y-m-d', $valor) : false;
    if ($d === false || $d->format('Y-m-d') !== $valor) {
        error_json("La fecha de $etiqueta no es válida", 400, 'fecha_invalida');
    }
    return $valor;
}

/**
 * Valida que el calendario tenga sentido: cada par se compara solo si las dos
 * fechas están capturadas. Corta con 400 diciendo cuál par está mal.
 */
function aviso_validar_orden_fechas(array $f): void
{
    $reglas = [
        ['inicio', 'bajas', 'El inicio del semestre debe ser antes de la fecha límite de bajas'],
        ['inicio', 'fin', 'El inicio del semestre debe ser antes de su fin'],
        ['bajas', 'fin', 'La fecha límite de bajas no puede ser después del fin del semestre'],
        ['fin', 'examenes_inicio', 'Los exámenes finales no pueden empezar antes del fin del semestre'],
        ['examenes_inicio', 'examenes_fin', 'Los exámenes finales: la fecha "del" debe ser antes que "al"'],
    ];
    foreach ($reglas as [$a, $b, $mensaje]) {
        if ($f[$a] !== null && $f[$b] !== null) {
            $estricto = $a === 'inicio';
            if ($estricto ? $f[$a] >= $f[$b] : $f[$a] > $f[$b]) {
                error_json($mensaje, 400, 'fechas_en_desorden');
            }
        }
    }
}

/** 'lunes 11 de enero de 2027'. Sin intl: no se sabe si el servidor lo tiene. */
function aviso_fecha_larga(string $ymd): string
{
    $d = new DateTime($ymd, new DateTimeZone('UTC'));
    return AVISO_DIAS_SEMANA[(int) $d->format('w')] . ' ' . (int) $d->format('j')
        . ' de ' . AVISO_MESES[(int) $d->format('n')] . ' de ' . $d->format('Y');
}

/** 'lunes 7 al sábado 19 de diciembre de 2026': sin repetir lo que comparten. */
function aviso_rango_fechas(string $ini, string $fin): string
{
    $a = new DateTime($ini, new DateTimeZone('UTC'));
    $b = new DateTime($fin, new DateTimeZone('UTC'));
    $textoIni = AVISO_DIAS_SEMANA[(int) $a->format('w')] . ' ' . (int) $a->format('j');
    if ($a->format('Y') !== $b->format('Y')) {
        $textoIni = aviso_fecha_larga($ini);
    } elseif ($a->format('n') !== $b->format('n')) {
        $textoIni .= ' de ' . AVISO_MESES[(int) $a->format('n')];
    }
    return $textoIni . ' al ' . aviso_fecha_larga($fin);
}

/** Lo que vale cada campo de fecha, o null si falta capturarlo. */
function aviso_valores_fechas(array $f): array
{
    return [
        '[FECHA DE INICIO DEL SEMESTRE]' => !empty($f['inicio']) ? aviso_fecha_larga($f['inicio']) : null,
        '[FECHA LÍMITE DE BAJAS]'        => !empty($f['bajas']) ? aviso_fecha_larga($f['bajas']) : null,
        '[FECHA DE FIN DEL SEMESTRE]'    => !empty($f['fin']) ? aviso_fecha_larga($f['fin']) : null,
        '[FECHAS DE EXÁMENES FINALES]'   => !empty($f['examenes_inicio']) && !empty($f['examenes_fin'])
            ? aviso_rango_fechas($f['examenes_inicio'], $f['examenes_fin'])
            : null,
    ];
}

/** Las fechas del semestre, con quién las guardó. Todo null si nadie las ha capturado. */
function aviso_leer_fechas(PDO $pdo, int $semestreId): array
{
    $st = $pdo->prepare(
        'SELECT f.inicio, f.bajas, f.fin, f.examenes_inicio, f.examenes_fin, p.nombre AS actualizado_por, f.actualizado_at
           FROM semestre_fechas f LEFT JOIN profesor p ON p.id = f.actualizado_por
          WHERE f.semestre_id = ?'
    );
    $st->execute([$semestreId]);
    $f = $st->fetch();
    if ($f === false) {
        return [
            'inicio' => null, 'bajas' => null, 'fin' => null, 'examenes_inicio' => null, 'examenes_fin' => null,
            'actualizado_por' => null, 'actualizado_at' => null,
        ];
    }
    $f['actualizado_por'] = $f['actualizado_por'] === null ? null : aviso_nombre($f['actualizado_por']);
    $f['actualizado_at'] = motor_hora_local($f['actualizado_at']);
    return $f;
}

// -----------------------------------------------------------------------------
// Las clases de cada profesor
// -----------------------------------------------------------------------------

/** Como nombreCompleto de frontend/src/lib/mallaVista.js. */
function aviso_nombre(string $n): string
{
    $titulo = preg_replace_callback(
        '/(^|[\s.\-])(\p{L})/u',
        function (array $m): string {
            return $m[1] . mb_strtoupper($m[2], 'UTF-8');
        },
        mb_strtolower(trim($n), 'UTF-8')
    );
    $particulas = ['de', 'del', 'la', 'las', 'los', 'y'];
    $palabras = preg_split('/\s+/u', (string) $titulo, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    foreach ($palabras as $i => $w) {
        $min = mb_strtolower($w, 'UTF-8');
        if ($i > 0 && in_array($min, $particulas, true)) {
            $palabras[$i] = $min;
        }
    }
    return implode(' ', $palabras);
}

/** 'EST-24105/EST-24124-002'; si los grupos no tienen el mismo número, cada clave lleva el suyo. */
function aviso_etiqueta_clase(array $grupos): string
{
    $numeros = array_values(array_unique(array_column($grupos, 'numero')));
    if (count($numeros) === 1) {
        return implode('/', array_column($grupos, 'clave')) . '-' . $numeros[0];
    }
    return implode('/', array_map(function (array $g): string {
        return $g['clave'] . '-' . $g['numero'];
    }, $grupos));
}

/**
 * [profesor_id => clases] de la malla actual del semestre. Una clase:
 *   { etiqueta, materia, sesiones: [{ dia, inicio, fin }] }
 * Solo esto se guarda en la bitácora y se muestra en el perfil: ni salón ni nada
 * de los otros profesores de la clase.
 */
function aviso_clases(PDO $pdo, int $semestreId): array
{
    $nombres = [];
    $st = $pdo->prepare(
        'SELECT DISTINCT m.id, m.nombre FROM materia m JOIN grupo g ON g.materia_id = m.id WHERE g.semestre_id = ?'
    );
    $st->execute([$semestreId]);
    foreach ($st->fetchAll() as $m) {
        $nombres[(int) $m['id']] = (string) $m['nombre'];
    }

    $rej = motor_rejilla($pdo);
    $ordenDia = array_flip(MOTOR_DIAS);
    $porProfesor = [];
    foreach (motor_clases($pdo, $semestreId) as $c) {
        $grupos = array_values(array_filter($c['grupos'], function (array $g): bool {
            return $g['estado'] !== 'cancelado';
        }));
        if ($grupos === [] || $c['profesores'] === []) {
            continue;
        }
        // Sin el salón: dos bloques seguidos en salones distintos son la misma sesión.
        $bloques = array_map(function (array $b): array {
            return ['dia' => $b['dia'], 'franja_id' => $b['franja_id']];
        }, $c['bloques']);
        $sesiones = [];
        foreach (motor_sesiones($rej, $bloques) as $s) {
            $h = $s['inicio'];
            for ($k = 1; $k < $s['bloques']; $k++) {
                $h = $rej['siguiente'][$h]['inicio'];
            }
            $sesiones[] = ['dia' => $s['dia'], 'inicio' => $s['inicio'], 'fin' => $rej['por_inicio'][$h]['fin']];
        }
        usort($sesiones, function (array $a, array $b) use ($ordenDia): int {
            return [$ordenDia[$a['dia']], $a['inicio']] <=> [$ordenDia[$b['dia']], $b['inicio']];
        });

        $materias = [];
        foreach ($grupos as $g) {
            $materias[$nombres[$g['materia_id']] ?? $g['clave']] = true;
        }
        $clase = [
            'etiqueta' => aviso_etiqueta_clase($grupos),
            'materia'  => implode('/', array_keys($materias)),
            'sesiones' => $sesiones,
        ];
        foreach ($c['profesores'] as $p) {
            $porProfesor[$p][] = $clase;
        }
    }
    foreach ($porProfesor as &$lista) {
        usort($lista, function (array $a, array $b): int {
            return strnatcmp($a['etiqueta'], $b['etiqueta']);
        });
    }
    unset($lista);
    return $porProfesor;
}

/**
 * Identifica el horario de un profesor: claves, grupo, días y horas, sin ids (que
 * cambian al volver a cargar la malla) ni salón (no se muestra este semestre).
 */
function aviso_huella(array $clases): string
{
    $partes = [];
    foreach ($clases as $c) {
        $partes[] = [$c['etiqueta'], array_map(function (array $s): array {
            return [$s['dia'], $s['inicio'], $s['fin']];
        }, $c['sesiones'])];
    }
    usort($partes, function (array $a, array $b): int {
        return strcmp($a[0], $b[0]);
    });
    return hash('sha256', (string) json_encode($partes));
}

/** La última vez que se le avisó a cada profesor: [profesor_id => fila]. Las fallidas no cuentan. */
function aviso_ultimos_avisos(PDO $pdo, int $semestreId, array $profesorIds): array
{
    if ($profesorIds === []) {
        return [];
    }
    $st = $pdo->prepare(
        "SELECT id, profesor_id, estado, clases, huella, creado_at FROM aviso_horario_envio
          WHERE semestre_id = ? AND estado IN ('enviado', 'marcado')
            AND profesor_id IN (" . motor_marcas($profesorIds) . ')
          ORDER BY id'
    );
    $st->execute(array_merge([$semestreId], $profesorIds));
    $ultimos = [];
    foreach ($st->fetchAll() as $f) {
        $ultimos[(int) $f['profesor_id']] = $f;
    }
    return $ultimos;
}

// -----------------------------------------------------------------------------
// Armar el correo
// -----------------------------------------------------------------------------

function aviso_h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

function aviso_hora(string $h): string
{
    return (string) preg_replace('/^0(\d)/', '$1', $h);
}

/** Las sesiones por hora: [['dias' => [...], 'inicio', 'fin']], porque una clase puede cambiar de hora según el día. */
function aviso_sesiones_por_hora(array $sesiones): array
{
    $por = [];
    foreach ($sesiones as $s) {
        $k = $s['inicio'] . '|' . $s['fin'];
        if (!isset($por[$k])) {
            $por[$k] = ['dias' => [], 'inicio' => $s['inicio'], 'fin' => $s['fin']];
        }
        $por[$k]['dias'][] = $s['dia'];
    }
    return array_values($por);
}

/** 'Lunes y miércoles', como el campo "Los días" de Matemáticas. */
function aviso_dias_largos(array $dias): string
{
    $n = array_map(function (string $d): string {
        return AVISO_DIAS_LARGO[$d] ?? $d;
    }, $dias);
    $ultimo = array_pop($n);
    $texto = $n === [] ? $ultimo : implode(', ', $n) . ' y ' . $ultimo;
    return mb_strtoupper(mb_substr($texto, 0, 1, 'UTF-8'), 'UTF-8') . mb_substr($texto, 1, null, 'UTF-8');
}

/**
 * [LISTA DE CLASES] como en el formato de cada departamento: Estadística un
 * renglón por clase, con '---' de salón como en su carta; los demás un bloque
 * por clase, como Matemáticas. Devuelve [html, texto].
 */
function aviso_lista_clases(array $clases, string $prefijo): array
{
    $html = '';
    $texto = [];
    if ($prefijo === 'EST') {
        $td = 'style="padding:2px 14px 2px 0;vertical-align:top"';
        foreach ($clases as $c) {
            $horas = aviso_sesiones_por_hora($c['sesiones']);
            $dias = [];
            $horarios = [];
            foreach ($horas as $h) {
                $dias[] = implode('-', array_map(function (string $d): string {
                    return AVISO_DIAS_CODIGO[$d] ?? $d;
                }, $h['dias']));
                $horarios[] = aviso_hora($h['inicio']) . '-' . aviso_hora($h['fin']);
            }
            $html .= "<tr><td $td>" . aviso_h($c['etiqueta']) . "</td><td $td>" . aviso_h($c['materia']) . '</td>'
                . "<td $td>" . ($dias === [] ? '---' : implode('<br>', $dias)) . '</td>'
                . "<td $td>" . ($horarios === [] ? '---' : implode('<br>', $horarios)) . '</td>'
                . "<td $td>---</td></tr>";
            $texto[] = $c['etiqueta'] . '  ' . $c['materia'] . '  '
                . ($dias === [] ? '---' : implode(' / ', $dias)) . '  '
                . ($horarios === [] ? '---' : implode(' / ', $horarios)) . '  ---';
        }
        return ['<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">' . $html . '</table>', implode("\n", $texto)];
    }

    foreach ($clases as $c) {
        $titulo = $c['etiqueta'] . ' ' . $c['materia'];
        $renglones = ['<strong>Materia:</strong> ' . aviso_h($titulo)];
        $renglonesTexto = ['Materia: ' . $titulo];
        $horas = aviso_sesiones_por_hora($c['sesiones']);
        if ($horas === []) {
            $renglones[] = '<strong>Horario:</strong> Por definir';
            $renglonesTexto[] = 'Horario: Por definir';
        }
        foreach ($horas as $h) {
            $dias = aviso_dias_largos($h['dias']);
            $horario = aviso_hora($h['inicio']) . ' a ' . aviso_hora($h['fin']);
            $renglones[] = '<strong>Los días:</strong> ' . aviso_h($dias);
            $renglones[] = '<strong>Horario:</strong> ' . aviso_h($horario);
            $renglonesTexto[] = 'Los días: ' . $dias;
            $renglonesTexto[] = 'Horario: ' . $horario;
        }
        $html .= '<p style="margin:0 0 12px 0">' . implode('<br>', $renglones) . '</p>';
        $texto[] = implode("\n", $renglonesTexto);
    }
    return ['<div>' . $html . '</div>', implode("\n\n", $texto)];
}

/** El HTML del cuerpo como texto plano, para la alternativa del correo. */
function aviso_html_a_texto(string $html): string
{
    $t = preg_replace('/<br\s*\/?>/i', "\n", $html);
    $t = preg_replace('/<li[^>]*>/i', '- ', (string) $t);
    $t = preg_replace('/<\/(li|ul|ol)>/i', "\n", (string) $t);
    $t = preg_replace('/<\/(p|div)>/i', "\n\n", (string) $t);
    $t = html_entity_decode(strip_tags((string) $t), ENT_QUOTES, 'UTF-8');
    $t = str_replace("\u{00A0}", ' ', $t);
    $t = preg_replace('/\n{3,}/', "\n\n", $t);
    return trim((string) $t);
}

/**
 * El correo de un profesor. Es lo único que arma correos: vista previa, prueba y
 * envío real pasan por aquí.
 *
 * $ctx: borrador, departamento (nombre, clave_prefijo), fechas, perfil_excluidos
 * (ids de quienes no ven Mi horario: a ellos no se les pone [AVISO DEL PERFIL]).
 * Devuelve { asunto, html, cuerpo, texto, faltan, sin_lista }. faltan son los campos
 * que el texto usa y aún no tienen valor: en la vista previa se quedan a la vista y
 * no se deja enviar.
 */
function aviso_armar_correo(array $ctx, array $version, array $profesor, array $clases, bool $esActualizacion): array
{
    $b = $ctx['borrador'];
    $mes = (new DateTime('now', new DateTimeZone(MOTOR_ZONA)))->format('n');
    $valores = [
        '[NOMBRE]'             => aviso_nombre((string) $profesor['nombre']),
        '[TIPO DE PROFESOR]'   => AVISO_TIPOS_PROFESOR[$profesor['tipo_contrato']] ?? (string) $profesor['tipo_contrato'],
        '[DEPARTAMENTO]'       => (string) $ctx['departamento']['nombre'],
        '[PERIODO]'            => (string) $b['periodo'],
        '[MESES DEL SEMESTRE]' => (string) $b['meses'],
        '[MES DE ENVÍO]'       => mb_convert_case(AVISO_MESES[(int) $mes], MB_CASE_TITLE, 'UTF-8'),
    ] + aviso_valores_fechas($ctx['fechas']);

    // Antes de todo lo demás: la frase es parte del texto, y sale escapada como él.
    $cuerpo = $version['cuerpo'];
    if (in_array((int) $profesor['id'], $ctx['perfil_excluidos'], true)) {
        $cuerpo = (string) preg_replace('/<(p|div)>\s*' . preg_quote(AVISO_CAMPO_PERFIL, '/') . '\s*<\/\1>/', '', $cuerpo);
        $cuerpo = str_replace(AVISO_CAMPO_PERFIL, '', $cuerpo);
    } else {
        $cuerpo = str_replace(AVISO_CAMPO_PERFIL, aviso_h(aviso_frase_perfil()), $cuerpo);
    }
    $faltan = [];
    foreach ($valores as $campo => $valor) {
        $usado = strpos($cuerpo, $campo) !== false || strpos($version['asunto'], $campo) !== false;
        if ($usado && ($valor === null || $valor === '')) {
            $faltan[] = $campo;
        }
    }
    $conValor = array_filter($valores, function ($v): bool {
        return $v !== null && $v !== '';
    });

    [$listaHtml, $listaTexto] = aviso_lista_clases($clases, (string) $ctx['departamento']['clave_prefijo']);

    // El texto plano sale del cuerpo antes de sustituir: los valores van crudos.
    $texto = strtr(aviso_html_a_texto($cuerpo), $conValor + [AVISO_CAMPO_LISTA => $listaTexto]);

    $escapados = array_map('aviso_h', $conValor);
    // Sola en su párrafo, reemplaza al párrafo: una tabla no va dentro de un <p>.
    $html = (string) preg_replace_callback(
        '/<(p|div)>\s*' . preg_quote(AVISO_CAMPO_LISTA, '/') . '\s*<\/\1>/',
        function () use ($listaHtml): string {
            return $listaHtml;
        },
        $cuerpo
    );
    $html = strtr($html, $escapados + [AVISO_CAMPO_LISTA => $listaHtml]);

    $asunto = strtr($version['asunto'], $conValor + [AVISO_CAMPO_LISTA => '', AVISO_CAMPO_PERFIL => '']);
    if ($esActualizacion) {
        $linea = 'Este correo actualiza el aviso anterior de sus materias y horarios.';
        $asunto = 'Actualización: ' . $asunto;
        $html = '<p><em>' . $linea . '</em></p>' . $html;
        $texto = $linea . "\n\n" . $texto;
    }

    return [
        'asunto'    => $asunto,
        'cuerpo'    => $html,
        'html'      => '<!doctype html><html><head><meta charset="utf-8"></head>'
            . '<body style="font-family:Calibri,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1c2733">'
            . $html . '</body></html>',
        'texto'     => $texto,
        'faltan'    => $faltan,
        'sin_lista' => strpos($cuerpo, AVISO_CAMPO_LISTA) === false,
    ];
}

/** El nombre del remitente: lo ve el profesor en su bandeja. */
function aviso_nombre_remitente(array $departamento): string
{
    return 'Departamento de ' . $departamento['nombre'] . ' · ITAM';
}

/** La dirección de la que sale el aviso: la del jefe o, si no hay, la de config.php. */
function aviso_correo_remitente(array $departamento): string
{
    return aviso_jefe($departamento)
        ?? (string) config_o('correo_remitente', 'no-responder@horariosdace.itam.mx');
}

/** Por qué no se puede mandar el correo armado, o null si se puede. */
function aviso_problema_de_correo(array $correo): ?string
{
    if ($correo['sin_lista']) {
        return 'El texto no incluye ' . AVISO_CAMPO_LISTA . ': agrégala para que el profesor reciba sus clases.';
    }
    if ($correo['faltan'] !== []) {
        return 'Faltan datos que el texto usa: ' . implode(', ', $correo['faltan']) . '.';
    }
    return null;
}
