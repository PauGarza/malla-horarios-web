// Sube api/ al sitio institucional (horariosdace.itam.mx) por SFTP.
//
// Uso:  npm run deploy:api
//
// Hermano de deploy-itam.mjs, que sube dist/. Son dos comandos y no uno a
// propósito: el paso 7 del corte (§10 de plansql.md) pide subir el API y
// probarlo con curl MIENTRAS la app sigue apuntando a Supabase. Si un solo
// comando subiera las dos cosas, ese paso no existiría.
//
// Comparte ~20 líneas de conexión con deploy-itam.mjs. Se dejan duplicadas a
// propósito: factorizarlas obligaría a tocar el script de dist/, que ya
// funciona, para no ganar nada más que evitar la repetición.
//
// Tres diferencias con el de dist/:
//
//   1. lib/config.php NO se sobrescribe nunca. Tiene la contraseña de MySQL y
//      el secreto del JWT; sobrescribirlo desde una copia local desactualizada
//      tira el sitio de una forma difícil de diagnosticar (todos los endpoints
//      responden 500 y el navegador solo dice "error del servidor"). Se sube
//      una sola vez, si allá no existe.
//   2. Solo se suben archivos .php. README.md y config.example.php se quedan
//      aquí: nginx serviría el .md como texto plano, publicando el mapa del
//      API y de su autorización a quien pase por /api/README.md.
//   3. No borra archivos huérfanos. En dist/ tiene sentido (Vite le pone hash
//      a cada bundle y se acumulan); aquí los nombres son fijos, así que
//      borrar de más es más peligroso que dejar de más. Si algún día se
//      elimina un endpoint, se borra a mano.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Client from 'ssh2-sftp-client';

const RAIZ_FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ_REPO = resolve(RAIZ_FRONTEND, '..');
const API = join(RAIZ_REPO, 'api');

// Mismo destino que deploy-itam.mjs: el home del usuario SFTP ES la raíz web.
const RAIZ_REMOTA = '/var/www/html/horariosdace.itam.mx';
const API_REMOTO = `${RAIZ_REMOTA}/api`;

const CONFIG = 'lib/config.php';

const ARCHIVO_ENV = join(RAIZ_FRONTEND, '.env.deploy');
if (existsSync(ARCHIVO_ENV)) process.loadEnvFile(ARCHIVO_ENV);

const { SFTP_HOST, SFTP_USER, SFTP_PASS } = process.env;
if (!SFTP_HOST || !SFTP_USER || !SFTP_PASS) {
  console.error(
    'Faltan credenciales. Copia frontend/.env.deploy.example a\n' +
      'frontend/.env.deploy y llena SFTP_HOST, SFTP_USER y SFTP_PASS.',
  );
  process.exit(1);
}

if (!existsSync(join(API, 'login.php'))) {
  console.error(`No encuentro el API en ${API}.`);
  process.exit(1);
}

if (!existsSync(join(API, CONFIG))) {
  console.error(
    'Falta api/lib/config.php.\n' +
      'Cópialo de api/lib/config.example.php y llénalo antes de desplegar.',
  );
  process.exit(1);
}

/** Rutas relativas de los .php de api/, recursivo. */
function archivosDelApi(dir = API, prefijo = '') {
  return readdirSync(dir).flatMap((nombre) => {
    const completa = join(dir, nombre);
    const relativa = prefijo ? `${prefijo}/${nombre}` : nombre;
    if (statSync(completa).isDirectory()) return archivosDelApi(completa, relativa);
    if (!nombre.endsWith('.php')) return [];
    if (nombre === 'config.example.php') return [];
    return [relativa];
  });
}

const sftp = new Client();
try {
  await sftp.connect({
    host: SFTP_HOST,
    port: 22,
    username: SFTP_USER,
    password: SFTP_PASS,
    readyTimeout: 20000,
  });

  const locales = archivosDelApi();

  // Los directorios primero: put() no crea el padre por su cuenta.
  await sftp.mkdir(API_REMOTO, true);
  const directorios = new Set(
    locales.filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))),
  );
  for (const d of [...directorios].sort()) {
    await sftp.mkdir(`${API_REMOTO}/${d}`, true);
  }

  const yaExisteConfig = await sftp.exists(`${API_REMOTO}/${CONFIG}`);

  for (const relativa of locales) {
    if (relativa === CONFIG && yaExisteConfig) {
      console.log(`saltado ${relativa} (ya existe en el servidor, no se toca)`);
      continue;
    }
    await sftp.put(join(API, relativa), `${API_REMOTO}/${relativa}`);
    console.log(`subido  ${relativa}`);
  }

  if (!yaExisteConfig) {
    // 644 y no 600, aunque 600 sería lo deseable: PHP corre como `apache` y el
    // archivo lo sube el usuario de SFTP (otro uid). Con 600 apache no puede
    // leerlo y TODOS los endpoints responden 500 con el cuerpo vacío —
    // comprobado contra el servidor el 2026-09-25. Con 640 tampoco: no
    // comparten grupo, así que no hay término medio disponible.
    //
    // Qué significa 644 aquí: cualquier usuario con shell en ese servidor puede
    // leer la contraseña de MySQL y el secreto del JWT. NO queda expuesto por
    // web (Apache pasa los .php a php-fpm y nunca sirve el código). Es el
    // riesgo estándar del hosting compartido, y es la razón de peso para
    // preguntarle a la DSTI por un directorio arriba de la raíz web.
    await sftp.chmod(`${API_REMOTO}/${CONFIG}`, 0o644);
    console.log(`\nconfig.php subido por primera vez y puesto en 644 (ver el comentario del script).`);
  }

  console.log('\nListo: https://horariosdace.itam.mx/api/');
  console.log('Pruébalo con los curl de §11.3 de plansql.md antes de tocar el frontend.');
} finally {
  await sftp.end();
}
