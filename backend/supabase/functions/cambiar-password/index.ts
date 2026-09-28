// Autoplanear — función de cambio de contraseña
//
// Por qué existe una función y no una llamada directa a la API de datos:
// `rls-policies.sql` le revocó al rol autenticado el acceso a
// `profesor.password_hash` (pedirlo explícitamente devuelve 403, confirmado el
// 2026-09-21 y otra vez el 2026-09-24 desde el sitio publicado). Eso es
// deliberado —que nadie pueda leer ni escribir hashes desde el navegador— y
// tiene como consecuencia que cambiar la propia contraseña necesite un endpoint
// con la clave de administrador, igual que el login.
//
// Es OPCIONAL a propósito (decisión del usuario, 2026-09-24): la contraseña
// inicial de todos es su propio `cu`, y quien no la cambie sigue entrando así.
// El sistema lo usan profesores de un departamento, no internet abierto, y lo
// que se recolecta son preferencias de horario. Esta función existe para quien
// sí quiera cambiarla, no para forzar a nadie.
//
// Se pide la contraseña ACTUAL además de la nueva. No es burocracia: sin eso,
// un token robado (o una sesión abierta en una computadora compartida —
// escenario realista en cubículos de departamento) bastaría para secuestrar la
// cuenta de forma permanente. Con esto, el atacante necesita además el secreto
// que no está en el token.
//
// Nota de despliegue: se despliega con verify_jwt = false y la validación del
// token se hace AQUÍ, con APP_JWT_SECRET. No es que el endpoint sea público —
// sin un JWT válido responde 401 unas líneas más abajo. Se hace así para que la
// autorización viva en código versionado y revisable, y no dependa de una
// casilla en el panel de un proveedor que nadie vuelve a mirar; además mantiene
// la función portable a cualquier runtime, igual que la de login.

import { verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
// bcryptjs es CJS — bajo el especificador npm: de Deno no expone sus funciones
// como exports nombrados, solo como métodos del objeto default (mismo tropiezo
// que en la función de login).
import bcrypt from "npm:bcryptjs@2.4.3";
import { createClient } from "npm:@supabase/supabase-js@2";

// --- Configuración -----------------------------------------------------------
// Los mismos 3 secrets que ya usa la función de login; no hace falta configurar
// ninguno nuevo.
const DB_URL = Deno.env.get("DB_URL")!;
const DB_ADMIN_KEY = Deno.env.get("DB_ADMIN_KEY")!;
const JWT_SECRET = Deno.env.get("APP_JWT_SECRET")!;

// Longitud mínima deliberadamente modesta. El riesgo que este endpoint mitiga
// no es la fuerza bruta contra una contraseña débil, sino que la contraseña sea
// el `cu` —un dato que no es secreto y que aparece en listas y correos—. Exigir
// mayúsculas, símbolos y 12 caracteres a 44 profesores que van a entrar dos
// veces al año lograría sobre todo que nadie la cambie, o que la apunten en un
// papel pegado al monitor. Lo que sí se rechaza abajo es que sea igual al `cu`,
// que es el caso que de verdad importa.
const MIN_LARGO = 6;
// bcrypt ignora en silencio lo que pase de 72 bytes. Truncar sin avisar es peor
// que rechazar: alguien creería tener una contraseña larga que en realidad no lo
// es. Se mide en bytes, no en caracteres, porque los acentos ocupan 2.
const MAX_BYTES = 72;
// Costo 10 (el default de bcrypt hoy). El roster se cargó con costo 6, que es el
// default de pgcrypto y es bajo; toda contraseña que pase por aquí queda mejor
// protegida que la inicial.
const COSTO_BCRYPT = 10;

const dbAdmin = createClient(DB_URL, DB_ADMIN_KEY);

async function importJwtKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// --- Rate limiting -----------------------------------------------------------
// Mismo enfoque "mejor que nada" que la función de login: por proceso, se
// reinicia si la función se recicla. Aquí el límite es por profesor_id (sale del
// token ya verificado, así que no se puede falsear) y es más estricto que el del
// login: cambiar la contraseña es una acción rara —una o dos veces en la vida de
// la cuenta—, así que 5 intentos en 5 minutos sobra para los dedos torpes y
// estorba a quien esté probando contraseñas actuales a ciegas.
const intentosRecientes = new Map<number, number[]>();
const VENTANA_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 5;

function excedeLimite(profesorId: number): boolean {
  const ahora = Date.now();
  const intentos = (intentosRecientes.get(profesorId) ?? []).filter((t) => ahora - t < VENTANA_MS);
  intentos.push(ahora);
  intentosRecientes.set(profesorId, intentos);
  return intentos.length > MAX_INTENTOS;
}

// --- CORS --------------------------------------------------------------------
// Igual que en login: el frontend vive en otro origen (localhost en desarrollo,
// GitHub Pages en producción), así que el navegador manda un preflight OPTIONS
// antes del POST real. Sin manejarlo, el navegador bloquea la petición aunque la
// función responda bien, y del lado del cliente se ve como "Failed to fetch".
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// --- Handler -----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  // 1. Identificar a quien llama, a partir del token y solo del token.
  //    El profesor_id NUNCA se toma del cuerpo de la petición: eso permitiría
  //    cambiarle la contraseña a cualquier otra persona con solo mandar su id.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return jsonResponse({ error: "Falta la sesión" }, 401);
  }

  let profesorId: number;
  try {
    const key = await importJwtKey(JWT_SECRET);
    const claims = await verify(token, key);
    profesorId = Number(claims.profesor_id);
    if (!Number.isInteger(profesorId)) throw new Error("claim inválido");
  } catch {
    // verify() ya rechaza firma inválida Y token expirado (claim exp).
    return jsonResponse({ error: "Sesión inválida o vencida, vuelve a entrar" }, 401);
  }

  let body: { password_actual?: string; password_nueva?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const passwordActual = body.password_actual ?? "";
  const passwordNueva = body.password_nueva ?? "";
  if (!passwordActual || !passwordNueva) {
    return jsonResponse({ error: "Faltan la contraseña actual y la nueva" }, 400);
  }

  if (excedeLimite(profesorId)) {
    return jsonResponse({ error: "Demasiados intentos, espera unos minutos" }, 429);
  }

  // 2. Traer la cuenta. Con la clave de administrador, que es la única que puede
  //    leer password_hash.
  const { data: cuenta, error } = await dbAdmin
    .from("profesor")
    .select("id, cu, password_hash, activo")
    .eq("id", profesorId)
    .maybeSingle();

  if (error || !cuenta || cuenta.activo === false) {
    return jsonResponse({ error: "Sesión inválida o vencida, vuelve a entrar" }, 401);
  }

  // 3. Validar la contraseña actual ANTES de revisar la nueva, para no decirle a
  //    quien no conoce la actual nada sobre las reglas de la nueva.
  const valido = await bcrypt.compare(passwordActual, cuenta.password_hash);
  if (!valido) {
    return jsonResponse({ error: "La contraseña actual no es correcta" }, 401);
  }

  // 4. Reglas de la nueva. Los mensajes son específicos a propósito: aquí ya
  //    demostró ser el dueño de la cuenta, así que no hay nada que ocultarle y sí
  //    mucho que ganar en que entienda por qué no se aceptó.
  const largoBytes = new TextEncoder().encode(passwordNueva).length;
  if (passwordNueva.length < MIN_LARGO) {
    return jsonResponse({ error: `La nueva contraseña debe tener al menos ${MIN_LARGO} caracteres` }, 400);
  }
  if (largoBytes > MAX_BYTES) {
    return jsonResponse({ error: "La nueva contraseña es demasiado larga" }, 400);
  }
  if (passwordNueva === cuenta.cu) {
    // El caso que motiva todo este endpoint: el `cu` no es secreto.
    return jsonResponse({ error: "La nueva contraseña no puede ser tu Clave Única" }, 400);
  }
  if (passwordNueva === passwordActual) {
    return jsonResponse({ error: "La nueva contraseña es igual a la actual" }, 400);
  }

  // 5. Guardar. password_predeterminada pasa a false, que es lo que distingue a
  //    quien ya personalizó su acceso de quien sigue con el `cu`.
  const hashNuevo = await bcrypt.hash(passwordNueva, COSTO_BCRYPT);
  const { error: errorUpdate } = await dbAdmin
    .from("profesor")
    .update({ password_hash: hashNuevo, password_predeterminada: false })
    .eq("id", profesorId);

  if (errorUpdate) {
    return jsonResponse({ error: "No se pudo guardar la nueva contraseña" }, 500);
  }

  // El token que ya trae en la mano sigue siendo válido hasta que expire: no se
  // invalidan sesiones al cambiar la contraseña. Hacerlo requeriría llevar
  // registro de tokens emitidos (hoy no existe: son JWT sin estado) y para V1 no
  // se justifica. Queda anotado en TODO.md por si alguna vez importa.
  return jsonResponse({ ok: true }, 200);
});
