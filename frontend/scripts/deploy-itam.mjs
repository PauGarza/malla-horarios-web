// Sube dist/ al sitio institucional (horariosdace.itam.mx) por SFTP.
//
// Uso:  npm run build && npm run deploy:itam
//
// Las credenciales NO están aquí ni en ningún archivo commiteado: se leen de
// .env.deploy (gitignoreado, ver .env.deploy.example). Son credenciales de
// servidor, no variables públicas del frontend — la distinción está explicada
// en .env.production.
//
// Por qué un script y no arrastrar carpetas en FileZilla: el paso fácil de
// olvidar es borrar los assets viejos. Vite le pone un hash al nombre de cada
// bundle (index-DSp-EHxM.js), así que subir encima sin limpiar va acumulando
// archivos huérfanos de cada despliegue; el sitio funciona, pero nadie puede
// decir después qué versión está publicada. Este script sincroniza: sube lo
// nuevo y borra de assets/ lo que ya no existe en el build.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Client from 'ssh2-sftp-client';

const RAIZ_FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RAIZ_FRONTEND, 'dist');

// El home del usuario SFTP ES el directorio que Apache sirve como raíz del
// sitio: no hay un public_html/ debajo. Verificado al conectarse por primera
// vez (cwd = /var/www/html/horariosdace.itam.mx, vacío salvo los dotfiles de
// la cuenta). Por eso el script nunca borra el directorio completo: ahí viven
// también .bashrc y compañía.
const RAIZ_REMOTA = '/var/www/html/horariosdace.itam.mx';

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

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No hay build que subir: corre `npm run build` primero.');
  process.exit(1);
}

/** Rutas relativas de todos los archivos de dist/, recursivo. */
function archivosDelBuild(dir = DIST, prefijo = '') {
  return readdirSync(dir).flatMap((nombre) => {
    const completa = join(dir, nombre);
    const relativa = prefijo ? `${prefijo}/${nombre}` : nombre;
    return statSync(completa).isDirectory()
      ? archivosDelBuild(completa, relativa)
      : [relativa];
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

  const locales = archivosDelBuild();

  // Los directorios primero: put() no crea el padre por su cuenta.
  const directorios = new Set(
    locales.filter((r) => r.includes('/')).map((r) => r.slice(0, r.lastIndexOf('/'))),
  );
  for (const d of [...directorios].sort()) {
    await sftp.mkdir(`${RAIZ_REMOTA}/${d}`, true);
  }

  for (const relativa of locales) {
    await sftp.put(join(DIST, relativa), `${RAIZ_REMOTA}/${relativa}`);
    console.log(`subido  ${relativa}`);
  }

  // Limpieza de assets/ huérfanos (bundles con hash de despliegues anteriores).
  // Se limita a assets/ a propósito: es el único directorio cuyo contenido
  // completo genera Vite, así que "lo que no está en el build es basura" solo
  // es cierto ahí.
  const subidos = new Set(locales);
  for (const remoto of await sftp.list(`${RAIZ_REMOTA}/assets`)) {
    if (remoto.type === '-' && !subidos.has(`assets/${remoto.name}`)) {
      await sftp.delete(`${RAIZ_REMOTA}/assets/${remoto.name}`);
      console.log(`borrado assets/${remoto.name} (de un build anterior)`);
    }
  }

  console.log('\nListo: https://horariosdace.itam.mx/');
} finally {
  await sftp.end();
}
