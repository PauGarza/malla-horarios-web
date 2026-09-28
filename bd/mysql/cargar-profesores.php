<?php
// =============================================================================
// Autoplanear — carga de los 45 profesores del Departamento de Matematicas.
//
// ESTE ARCHIVO ES DE UN SOLO USO. Se sube, se abre una vez, SE BORRA.
// No debe quedarse en el servidor.
//
// Por que es PHP y no SQL, como el resto de los datos: el original de Postgres
// (DACE/BD/datos-matematicas.sql) inserta el hash con
// crypt(cu, gen_salt('bf')), que es pgcrypto. MySQL NO tiene bcrypt en ninguna
// forma — ni funcion equivalente ni extension. La unica manera de generar esos
// hashes contra MySQL es desde la aplicacion, y conviene que sea con
// password_hash() de PHP: exactamente la misma funcion cuyo password_verify()
// los va a leer despues en api/login.php.
//
// La contrasena inicial de cada quien ES su clave unica (diseno-bd.md 4.5), y
// cambiarla es opcional — por eso password_predeterminada se queda en 1.
//
// Idempotente: INSERT IGNORE por cu. Correrlo dos veces no duplica ni pisa
// nada, asi que tampoco pisa una contrasena que alguien ya haya cambiado.
//
// Uso:
//   1. Subirlo a la raiz del sitio por SFTP.
//   2. Abrir https://horariosdace.itam.mx/cargar-profesores.php
//   3. BORRARLO del servidor.
// =============================================================================

header('Content-Type: text/plain; charset=utf-8');

$cfg = require __DIR__ . '/api/lib/config.php';
$pdo = new PDO(
    "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4",
    $cfg['db_user'], $cfg['db_pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
);

// cu, nombre, rol, tipo_contrato, estado_especial, activo
$roster = [
    ['59147', 'AGUILAR VILLEGAS JUAN CARLOS', 'profesor', 'tiempo_completo', null, 1],
    ['157853', 'ARROYO GILES SERGIO IVAN', 'profesor', 'asignatura', null, 1],
    ['231839', 'AVILEZ GARCIA ANA BELÉN', 'profesor', 'tiempo_completo', null, 1],
    ['228698', 'BARRERA ANZALDO CARLOS', 'profesor', 'tiempo_completo', null, 1],
    ['172721', 'BENGOCHEA CRUZ ABIMAEL JAVIER', 'profesor', 'tiempo_completo', null, 1],
    ['3744', 'CAMPERO PARDO JOSE DEL NIÑO DE JESUS', 'profesor', 'asignatura', null, 1],
    ['146046', 'CASTAÑEDA RIVERA PABLO', 'profesor', 'tiempo_completo', 'licencia', 1],
    ['3513', 'DE OLIVEIRA CONTRERAS VLADIMIR C.', 'profesor', 'tiempo_completo', null, 1],
    ['181158', 'DENTI OCHOA MAYA', 'profesor', 'asignatura', null, 1],
    ['35834', 'FELIX FELIX LYSETTE', 'profesor', 'asignatura', null, 1],
    ['89477', 'FERNANDEZ ROMAN LEOBARDO', 'profesor', 'medio_tiempo', null, 1],
    ['138311', 'FIGUEROA GUTIERREZ ANA PAULINA', 'profesor', 'tiempo_completo', null, 1],
    ['182538', 'GARCIA ANCONA RAYBEL ANDRES', 'profesor', 'asignatura', null, 1],
    ['83368', 'GARCIA GARCIA CESAR LUIS', 'profesor', 'tiempo_completo', null, 1],
    ['103444', 'GONZALEZ ROBERT GERARDO', 'profesor', 'tiempo_completo', null, 1],
    ['228667', 'JACKMAN CONNOR FOX', 'profesor', 'tiempo_completo', null, 1],
    ['156776', 'LEITAO DA CRUZ MORAIS JOAO PEDRO', 'profesor', 'tiempo_completo', null, 1],
    ['15227', 'MADRIZ MENDOZA MAIRA', 'profesor', 'medio_tiempo', null, 1],
    ['13775', 'MALDONADO LOZANO RITA EUGENIA', 'profesor', 'asignatura', null, 1],
    ['232206', 'MARTINEZ ALBERGA SOFIA', 'profesor', 'tiempo_completo', null, 1],
    ['183625', 'MARTINEZ AVENDAÑO RUBEN ALEJANDRO', 'profesor', 'tiempo_completo', 'sábatico', 1],
    ['81795', 'MONROY JIMENEZ JORGE', 'profesor', 'asignatura', null, 1],
    ['44743', 'MOTA GAYTAN MIGUEL ANGEL', 'profesor', 'tiempo_completo', 'sábatico', 1],
    ['16475', 'NOREÑA VILLARIAS FRANCISCO FERNANDO', 'profesor', 'asignatura', null, 1],
    ['103383', 'NUÑEZ LOPEZ MAYRA', 'profesor', 'tiempo_completo', null, 1],
    ['118209', 'OLIVARES PRETELIN JOSE PABLO', 'profesor', 'asignatura', null, 1],
    ['227476', 'ORENDAIN ALMADA JUAN', 'profesor', 'asignatura', null, 1],
    ['231841', 'OVIEDO LEON HARRY F.', 'profesor', 'tiempo_completo', null, 1],
    ['10933', 'PARADA GARCIA ZEFERINO', 'profesor', 'tiempo_completo', null, 1],
    ['160168', 'PEREZ CHAVELA ERNESTO', 'profesor', 'tiempo_completo', 'jubilación', 0],
    ['18092', 'PEREZ JUAREZ ANGEL', 'profesor', 'asignatura', null, 1],
    ['18697', 'POSSANI ESPINOSA EDGAR', 'profesor', 'tiempo_completo', 'sábatico', 1],
    ['18750', 'PRETELIN MUÑOZ DE COTE YOLANDA ISABEL', 'profesor', 'asignatura', null, 1],
    ['115331', 'RAMIREZ DAVID LUCIA', 'profesor', 'tiempo_completo', null, 1],
    ['228385', 'RIOS HERREJON ALEJANDRO', 'profesor', 'asignatura', null, 1],
    ['175296', 'RIVERA NORIEGA JORGE', 'profesor', 'tiempo_completo', null, 1],
    ['55238', 'ROQUERO ROS MARTINA', 'profesor', 'medio_tiempo', null, 1],
    ['21133', 'RUIZ RUIZ FUNES CONCEPCION', 'profesor', 'asignatura', null, 1],
    ['21180', 'RUMBOS PELLICER IRMA BEATRIZ', 'jefe_division', 'tiempo_completo', null, 1],
    ['58149', 'SANCHEZ LARIOS HERICA', 'profesor', 'asignatura', null, 1],
    ['80099', 'SOTO SANCHEZ JOSÉ EZEQUIEL', 'jefe_departamento', 'tiempo_completo', null, 1],
    ['156261', 'VALVERDE ESPARZA SHARON MAGALI', 'profesor', 'asignatura', null, 1],
    ['175985', 'VARGAS GARCIA EDITH MIREYA', 'profesor', 'tiempo_completo', null, 1],
    ['40966', 'VILLANUEVA CASTILLO MARISOL', 'profesor', 'asignatura', null, 1],
    ['110961', 'ZAMORA RAMOS JOEL', 'profesor', 'asignatura', null, 1],
];

$deptoId = $pdo->query("SELECT id FROM departamento WHERE clave_prefijo = 'MAT'")->fetchColumn();
if ($deptoId === false) {
    exit("ERROR: no existe el departamento MAT. ¿Cargaste seed-mysql.sql?
");
}

$st = $pdo->prepare(
    'INSERT IGNORE INTO profesor
            (cu, password_hash, nombre, rol, departamento_id, tipo_contrato, estado_especial, activo)
     VALUES (?,?,?,?,?,?,?,?)'
);

$nuevos = 0;
$existentes = 0;
foreach ($roster as $p) {
    list($cu, $nombre, $rol, $tipo, $estado, $activo) = $p;
    // cost 10: el mismo que usa api/cambiar-password.php.
    $hash = password_hash($cu, PASSWORD_BCRYPT, ['cost' => 10]);
    $st->execute([$cu, $hash, $nombre, $rol, $deptoId, $tipo, $estado, $activo]);
    if ($st->rowCount() > 0) { $nuevos++; } else { $existentes++; }
}

echo "profesores insertados: $nuevos
";
echo "ya existian (sin tocar): $existentes
";
echo "total en el roster:      " . count($roster) . "

";

foreach ([
    'profesores en MAT'   => "SELECT COUNT(*) FROM profesor WHERE departamento_id = $deptoId",
    'jefe_departamento'   => "SELECT COUNT(*) FROM profesor WHERE rol = 'jefe_departamento'",
    'inactivos'           => "SELECT COUNT(*) FROM profesor WHERE activo = 0",
    'medio_tiempo'        => "SELECT COUNT(*) FROM profesor WHERE tipo_contrato = 'medio_tiempo'",
] as $etiqueta => $sql) {
    printf("%-22s %s
", $etiqueta . ':', $pdo->query($sql)->fetchColumn());
}

echo "
AHORA BORRA ESTE ARCHIVO DEL SERVIDOR.
";
