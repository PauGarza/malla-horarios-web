// Autoplanear — función de login
//
// Por qué existe: el proyecto decidió (2026-09-21) manejar sus propias
// contraseñas (profesor.password_hash) en vez de usar el sistema de
// autenticación nativo del proveedor de base de datos, para no acoplar las
// credenciales a un proveedor específico de cara a una posible migración de
// infraestructura. Esta función es el único lugar del sistema que ve una
// contraseña en texto plano y el único que puede leer password_hash (con la
// clave de administrador de la base, que ignora RLS — ver ../../bd/rls-policies.sql,
// que le revocó ese permiso al rol autenticado normal).
//
// Login unificado (2026-09-21): NO hay una tabla separada para roles
// administrativos. Jefe de Departamento/Servicios Escolares/Nómina/admin
// inician sesión con el mismo cu + password que cualquier profesor (un Jefe
// de Departamento también da clases) — lo único que cambia es profesor.rol,
// que se incluye como claim en el token.
//
// Flujo: recibe { cu, password }, valida el hash con bcrypt, y si es válido
// firma un JWT propio con el secreto JWT del proyecto — el mismo que usa la
// capa de API para validar peticiones — incluyendo el claim estándar "role":
// "authenticated" (para que se acepte como petición autenticada) más los
// claims personalizados "profesor_id" y "rol". ../../bd/rls-policies.sql lee
// esos claims vía app_profesor_id()/app_rol() en vez de auth.uid().
//
// Nota de plataforma: este archivo vive bajo supabase/functions/ porque así
// lo exige la herramienta de línea de comandos del proveedor actual para
// poder desplegarlo (ver ../../README.md de backend/) — no porque el diseño
// dependa de esa plataforma; la lógica de login en sí (bcrypt + JWT) es
// código estándar, portable a cualquier runtime de JavaScript/Deno/Node.
//
// verify_jwt = false a propósito en el deploy: este endpoint es el que EMITE
// el JWT — exigir uno para poder llamarlo sería circular (nadie podría entrar
// nunca). La validación de identidad la hace el propio handler (cu+password).
//
// Desplegado 2026-09-21 contra el proyecto real (malla-horarios,
// gvdgbuktokpfbtdhyiuz), status ACTIVE. Ya existe una cuenta de prueba
// (cu='TEST01', password='TEST01', rol=admin) para probarlo end-to-end.
//
// CORS (bug encontrado y corregido 2026-09-21): el frontend corre en un
// origen distinto (localhost en desarrollo, GitHub Pages en producción), así
// que el navegador manda un preflight OPTIONS antes del POST real — sin
// manejarlo, y sin el header Access-Control-Allow-Origin en la respuesta, el
// navegador bloquea la petición aunque la función responda bien ("Failed to
// fetch" del lado del cliente, no un error real del servidor). Se permite
// cualquier origen (`*`) a propósito: este endpoint no depende del origen
// para su seguridad (rate limiting + bcrypt + mensajes genéricos), igual que
// las claves públicas del proyecto ya son públicas por diseño.

import { create } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
// bcryptjs es CJS — bajo el especificador npm: de Deno no expone `compare`
// como export nombrado, solo como método del objeto default.
import bcrypt from "npm:bcryptjs@2.4.3";
import { createClient } from "npm:@supabase/supabase-js@2";

// --- Configuración ---------------------------------------------------------
// Variables de entorno que hay que configurar como "secrets" de la función
// una vez exista el proyecto:
//   DB_URL              — URL del proyecto/instancia (la misma que usa el frontend)
//   DB_ADMIN_KEY         — clave de administrador (NUNCA la clave pública/anon;
//                          esta sí puede leer password_hash porque
//                          rls-policies.sql se lo revocó al rol autenticado
//                          normal, no al de administrador)
//   APP_JWT_SECRET       — el "JWT Secret" del proyecto (en la plataforma
//                          actual: Project Settings > API > JWT Settings) —
//                          con ESTE se firma el token para que la capa de API
//                          lo acepte como válido
//   TOKEN_TTL_SECONDS    — duración del token; default 12 horas (ver nota de
//                          duración en ../../bd/diseno-bd.md §4.2 — se llena
//                          el cuestionario en sesiones cortas, no hace falta
//                          un token de larga duración en V1)

const DB_URL = Deno.env.get("DB_URL")!;
const DB_ADMIN_KEY = Deno.env.get("DB_ADMIN_KEY")!;
const JWT_SECRET = Deno.env.get("APP_JWT_SECRET")!;
const TOKEN_TTL_SECONDS = Number(Deno.env.get("TOKEN_TTL_SECONDS") ?? 12 * 60 * 60);

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

// --- Rate limiting mínimo ---------------------------------------------------
// Nivel "mejor que nada" para V1: bloquea ráfagas desde el mismo proceso de la
// función (se reinicia si la función se recicla — no es un límite duro y
// persistente). Si esto no basta, lo correcto es moverlo a una tabla en la
// base de datos con un contador por cu/IP, o a un servicio dedicado — marcado
// como pendiente en ../../bd/diseno-bd.md §4.2, no bloquea empezar a
// recolectar preferencias porque el volumen esperado (profesores del ITAM,
// uso puntual dos veces al año) es bajo.
const intentosRecientes = new Map<string, number[]>();
const VENTANA_MS = 5 * 60 * 1000;
const MAX_INTENTOS = 8;

function excedeLimite(clave: string): boolean {
  const ahora = Date.now();
  const intentos = (intentosRecientes.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS);
  intentos.push(ahora);
  intentosRecientes.set(clave, intentos);
  return intentos.length > MAX_INTENTOS;
}

// --- CORS --------------------------------------------------------------------

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
    // Preflight del navegador — sin cuerpo, solo confirma que el POST real
    // está permitido desde este origen.
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido" }, 405);
  }

  let body: { cu?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido" }, 400);
  }

  const { cu, password } = body;
  if (!cu || !password) {
    return jsonResponse({ error: "Faltan credenciales" }, 400);
  }

  if (excedeLimite(cu)) {
    return jsonResponse({ error: "Demasiados intentos, espera unos minutos" }, 429);
  }

  // Login unificado: profesor, Jefe de Departamento, Servicios Escolares,
  // Nómina y admin son todos filas de `profesor` — solo cambia `rol`.
  const { data: cuenta, error } = await dbAdmin
    .from("profesor")
    .select("id, password_hash, rol, activo")
    .eq("cu", cu)
    .maybeSingle();

  if (error || !cuenta || cuenta.activo === false) {
    // Mensaje genérico a propósito: no revelar si el cu existe o no.
    return jsonResponse({ error: "Credenciales inválidas" }, 401);
  }

  const valido = await bcrypt.compare(password, cuenta.password_hash);
  if (!valido) {
    return jsonResponse({ error: "Credenciales inválidas" }, 401);
  }

  const claims: Record<string, unknown> = {
    role: "authenticated",
    iss: "autoplanear-login",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    profesor_id: cuenta.id,
    rol: cuenta.rol,
  };

  const key = await importJwtKey(JWT_SECRET);
  const jwt = await create({ alg: "HS256", typ: "JWT" }, claims, key);

  return jsonResponse({ token: jwt, expira_en: TOKEN_TTL_SECONDS, rol: cuenta.rol }, 200);
});

// --- Pendiente, no parte de este primer borrador ----------------------------
// - Endpoint separado para "cambiar contraseña" (opcional, ver
//   ../../bd/diseno-bd.md §4.2) — debe actualizar también password_predeterminada
//   a false.
// - Endpoint para inicializar el roster (password_hash = hash(cu) para cada
//   profesor nuevo) — hoy asumido como un script/paso manual de carga, no una
//   ruta HTTP pública.
