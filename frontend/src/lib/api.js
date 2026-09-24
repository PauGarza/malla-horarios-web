// Cliente mínimo hacia el backend real (login propio + REST directo a la
// base de datos, protegido por RLS — ver ../../../bd/rls-policies.sql).
// A propósito no se usa @supabase/supabase-js: el proyecto ya decidió no
// acoplar el frontend a un proveedor específico (ver README de esta carpeta),
// y un simple `fetch` con dos headers es suficiente para lo que necesitamos.

const DB_URL = import.meta.env.VITE_DB_URL;
const DB_ANON_KEY = import.meta.env.VITE_DB_ANON_KEY;
const LOGIN_FUNCTION_URL = import.meta.env.VITE_LOGIN_FUNCTION_URL;

/**
 * Lee el profesor_id del JWT propio, sin verificar la firma (eso ya lo hizo
 * el servidor al aceptar/rechazar la petición; esto es solo para saber qué
 * pedir). Necesario porque RLS no siempre acota una consulta a "una sola
 * fila": un Jefe de Departamento/admin también puede ver el roster completo
 * de su departamento (roster_departamento_select), así que pedir /profesor
 * sin filtrar por id puede devolver varias filas — la propia y las de sus
 * colegas — y no hay garantía de cuál sale primero.
 */
export function profesorIdDelToken(token) {
  const payload = token.split('.')[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = JSON.parse(atob(base64));
  return json.profesor_id;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** POST { cu, password } al endpoint de login. Lanza ApiError si falla. */
export async function login(cu, password) {
  const res = await fetch(LOGIN_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cu, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || 'No se pudo iniciar sesión', res.status);
  }
  return data; // { token, expira_en, rol }
}

/**
 * fetch autenticado contra el Data API (PostgREST). `path` empieza con "/",
 * ej. "/profesor?select=id,nombre". RLS decide qué filas se ven según el
 * JWT propio — este helper no filtra nada por su cuenta.
 */
export async function apiFetch(path, token, options = {}) {
  const res = await fetch(`${DB_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: DB_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message || `Error ${res.status} llamando a ${path}`, res.status);
  }
  // PostgREST no siempre devuelve cuerpo: un DELETE/PATCH responde 204, pero un
  // POST sin `Prefer: return=representation` responde 201 y el cuerpo VACÍO.
  // Hacer res.json() sobre eso truena con "Unexpected end of JSON input", que
  // no se parece en nada al problema real — pasó con el botón de lista
  // personalizada y afectaba por igual a guardar el cuestionario de un
  // profesor. Por eso se mira el cuerpo, no el código de estado.
  const texto = await res.text();
  if (!texto) return null;
  return JSON.parse(texto);
}
