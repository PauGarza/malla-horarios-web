<?php
// =============================================================================
// Plantilla de api/lib/config.php — ESTE archivo sí va al repo, el otro NO.
//
// Para usarlo:
//   1. Copiar a config.php en el mismo directorio.
//   2. Llenar los valores.
//   3. chmod 644 config.php   <- sí, 644. Ver abajo.
//
// `npm run deploy:api` hace los tres pasos por ti la primera vez y después
// nunca lo sobrescribe. config.php está en el .gitignore de la raíz, igual que
// frontend/.env.deploy.
//
// Por qué un .php que devuelve un array y no un .ini o un .json: el home de la
// cuenta SFTP ES la raíz web (/var/www/html/horariosdace.itam.mx), no hay un
// directorio padre donde esconder la configuración. Apache pasa los .php a
// php-fpm, así que el código fuente de este archivo nunca se sirve como texto;
// un .ini o un .json sí se descargarían con la contraseña dentro.
//
// POR QUÉ 644 Y NO 600 (comprobado contra el servidor el 2026-09-25):
// PHP corre como el usuario `apache` y este archivo lo sube el usuario de SFTP,
// que es otro uid. Con 600, apache NO puede leerlo y todos los endpoints
// responden 500 con el cuerpo vacío — un fallo especialmente molesto de
// diagnosticar porque no deja rastro en la respuesta. Con 640 tampoco funciona:
// no comparten grupo, así que no hay término medio.
//
// Qué implica 644, dicho sin adornos: cualquier usuario con shell en ese
// servidor puede leer la contraseña de MySQL y el secreto del JWT. NO queda
// expuesto por web. Es el riesgo estándar del hosting compartido, y es la razón
// de peso para preguntarle a la DSTI por un directorio arriba de la raíz web
// donde la cuenta pueda escribir — ahí sí tendría sentido el 600.
// =============================================================================

return [
    'db_host' => 'localhost',
    'db_name' => '',
    'db_user' => '',
    'db_pass' => '',

    // Generar con:  openssl rand -base64 48
    //
    // Este secreto es NUESTRO. Ya no es el "Legacy JWT Secret" de Supabase, que
    // el proyecto marcaba como PREVIOUS KEY tras rotar a llaves asimétricas
    // (riesgo registrado en SECRETS-NO-SUBIR.md el 2026-09-21). Con endpoints
    // propios el que verifica el token es api/lib/auth.php, así que el riesgo
    // desaparece por construcción en vez de mitigarse.
    //
    // Cambiarlo invalida todas las sesiones abiertas: la gente vuelve a entrar.
    'jwt_secret' => '',

    // 12 horas, igual que TOKEN_TTL_SECONDS de la Edge Function de login.
    'token_ttl' => 12 * 60 * 60,
];
