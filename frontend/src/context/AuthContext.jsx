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

function borrarSesionGuardada() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignorar
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

  // Error al restaurar una sesión guardada que NO es de autenticación (red
  // caída, 500): la sesión sigue siendo buena y la pantalla ofrece reintentar.
  const [errorCarga, setErrorCarga] = useState('');

  const restaurar = useCallback(
    (tok) => {
      setLoading(true);
      setErrorCarga('');
      return cargarCatalogos(tok)
        .catch((err) => {
          // Solo un 401/403 dice que la sesión ya no sirve (vencida, cuenta
          // desactivada). Antes cualquier error cerraba la sesión, así que un
          // tropiezo de red sacaba a la persona a media captura.
          if (err.status === 401 || err.status === 403) {
            borrarSesionGuardada();
            setToken(null);
          } else {
            setErrorCarga(err.message);
          }
        })
        .finally(() => setLoading(false));
    },
    [cargarCatalogos],
  );

  useEffect(() => {
    const session = readStoredSession();
    if (!session) {
      setLoading(false);
      return;
    }
    setToken(session.token);
    restaurar(session.token);
  }, [restaurar]);

  const reintentarCarga = useCallback(() => restaurar(token), [restaurar, token]);

  const login = useCallback(
    async (cu, password) => {
      const { token: tok, expira_en } = await apiLogin(cu, password);
      // Primero el perfil y DESPUÉS guardar la sesión: si catalogos falla, la
      // pantalla de login muestra el error, y no debe quedar una sesión
      // guardada que al recargar la página "aparezca" adentro sola.
      await cargarCatalogos(tok);
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ token: tok, expiresAt: Date.now() + expira_en * 1000 }),
        );
      } catch {
        // sin persistencia local sigue funcionando para esta pestaña
      }
      setErrorCarga('');
      setToken(tok);
    },
    [cargarCatalogos],
  );

  const logout = useCallback(() => {
    borrarSesionGuardada();
    setErrorCarga('');
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
        errorCarga,
        reintentarCarga,
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
