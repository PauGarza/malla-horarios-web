import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { catalogos, login as apiLogin } from '../lib/api';

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
  // El semestre actual y las franjas se cargan aquí y no en cada pantalla:
  // antes tres pantallas pedían /semestre?order=id.desc&limit=1 por separado.
  const [semestre, setSemestre] = useState(null);
  const [franjas, setFranjas] = useState([]);
  // Si el formulario del propio departamento ya está abierto, para la tarjeta
  // del inicio. El formulario mismo lo vuelve a preguntar al abrirse.
  const [formularioPublicado, setFormularioPublicado] = useState(false);
  const [loading, setLoading] = useState(true);

  // Una sola petición. Antes eran dos, y la del perfil tenía que filtrar por
  // el propio id porque RLS dejaba pasar también el roster del departamento
  // cuando quien entraba era Jefe — sin ese filtro, "la primera fila que
  // regrese" podía ser la de un colega (bug real del 2026-09-21). Ahora
  // catalogos.php devuelve el perfil de quien manda el token y de nadie más,
  // así que no hay nada que filtrar ni ningún id que leer del JWT.
  const cargarCatalogos = useCallback(async (tok) => {
    const datos = await catalogos(tok);
    setProfesor(datos.perfil ?? null);
    setDepartamentos(datos.departamentos ?? []);
    setSemestre(datos.semestre ?? null);
    setFranjas(datos.franjas ?? []);
    setFormularioPublicado(Boolean(datos.formulario_publicado));
  }, []);

  useEffect(() => {
    const session = readStoredSession();
    if (!session) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    cargarCatalogos(session.token)
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [cargarCatalogos]);

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
      await cargarCatalogos(tok);
    },
    [cargarCatalogos],
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
    setSemestre(null);
    setFranjas([]);
    setFormularioPublicado(false);
  }, []);

  // Vuelve a leer el perfil sin cerrar la sesión (p. ej. después de cambiar la
  // contraseña, que apaga password_predeterminada).
  const recargarPerfil = useCallback(() => cargarCatalogos(token), [cargarCatalogos, token]);

  const nombreDepartamento = useCallback(
    (id) => departamentos.find((d) => d.id === id)?.nombre ?? null,
    [departamentos],
  );

  return (
    <AuthContext.Provider
      value={{
        token,
        profesor,
        departamentos,
        semestre,
        franjas,
        formularioPublicado,
        nombreDepartamento,
        loading,
        login,
        logout,
        recargarPerfil,
      }}
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
