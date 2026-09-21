// Cliente mínimo hacia el backend real (login propio + REST directo a la
// base de datos, protegido por RLS — ver ../../../bd/rls-policies.sql).
// A propósito no se usa @supabase/supabase-js: el proyecto ya decidió no
// acoplar el frontend a un proveedor específico (ver README de esta carpeta),
// y un simple `fetch` con dos headers es suficiente para lo que necesitamos.

const DB_URL = import.meta.env.VITE_DB_URL;
const DB_ANON_KEY = import.meta.env.VITE_DB_ANON_KEY;
const LOGIN_FUNCTION_URL = import.meta.env.VITE_LOGIN_FUNCTION_URL;

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
  if (res.status === 204) return null;
  return res.json();
}
