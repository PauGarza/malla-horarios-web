import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, login as apiLogin } from '../lib/api';

const STORAGE_KEY = 'autoplanear_session';
const AuthContext = createContext(null);

function readStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    // localStorage puede fallar (modo privado, storage bloqueado) — no es
    // motivo para tronar la app, solo se pierde la sesión persistida.
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [profesor, setProfesor] = useState(null);
  const [departamentos, setDepartamentos] = useState([]);
  const [loading, setLoading] = useState(true);

  const cargarPerfil = useCallback(async (tok) => {
    const [perfil, deptos] = await Promise.all([
      apiFetch('/profesor?select=id,cu,nombre,rol,departamento_id,tipo_contrato,modo_materias_elegibles', tok),
      apiFetch('/departamento?select=id,nombre', tok),
    ]);
    setProfesor(perfil[0] ?? null);
    setDepartamentos(deptos ?? []);
  }, []);

  useEffect(() => {
    const session = readStoredSession();
    if (!session) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    cargarPerfil(session.token)
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [cargarPerfil]);

  const login = useCallback(
    async (cu, password) => {
      const { token: tok, expira_en } = await apiLogin(cu, password);
      const session = { token: tok, expiresAt: Date.now() + expira_en * 1000 };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch {
        // sin persistencia local sigue funcionando para esta pestaña
      }
      setToken(tok);
      await cargarPerfil(tok);
    },
    [cargarPerfil],
  );

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignorar
    }
    setToken(null);
    setProfesor(null);
    setDepartamentos([]);
  }, []);

  const nombreDepartamento = useCallback(
    (id) => departamentos.find((d) => d.id === id)?.nombre ?? null,
    [departamentos],
  );

  return (
    <AuthContext.Provider
      value={{ token, profesor, departamentos, nombreDepartamento, loading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
