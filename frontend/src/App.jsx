import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import FormularioPreferencias from './pages/FormularioPreferencias';
import PanelPreferencias from './pages/PanelPreferencias';
import EditorCuestionario from './pages/EditorCuestionario';
import RespuestasCuestionario from './pages/RespuestasCuestionario';
import ReportePreferencias from './pages/ReportePreferencias';
import ReporteHoras from './pages/ReporteHoras';
import AsignacionesDirectas from './pages/AsignacionesDirectas';
import CatalogoMaterias from './pages/CatalogoMaterias';
import PerfilUsuario from './pages/PerfilUsuario';
import CargaDemanda from './pages/CargaDemanda';
import Semestres from './pages/Semestres';
import RestablecerPasswordPage from './pages/RestablecerPasswordPage';
import CapturarCorreoPage from './pages/CapturarCorreoPage';
import BarraSuperior from './components/BarraSuperior';

// Navegación por estado simple, sin librería de ruteo: con un puñado de
// pantallas una URL propia por vista todavía no se justifica. La vista es un objeto y no un string porque el
// formulario puede abrirse "para otro profesor" desde el panel y necesita
// llevar a quién; guardarlo en un useState aparte se desincronizaría.
// Si se agregan más vistas reales (panel de Jefe grande, admin) vale la pena
// revisar esto — hoy sería complejidad sin beneficio.
// El enlace de "olvidé mi contraseña" llega como /#restablecer=<token> (ver
// api/olvide-password.php). Es la única entrada a la app por URL.
function tokenDelEnlace() {
  const m = window.location.hash.match(/^#restablecer=([0-9a-f]{64})$/);
  return m ? m[1] : null;
}

function Shell() {
  const { token, profesor, loading, errorCarga, reintentarCarga, logout } = useAuth();
  const [vista, setVista] = useState({ nombre: 'home' });
  const [tokenRestablecer, setTokenRestablecer] = useState(tokenDelEnlace);

  // Antes que todo lo demás: el enlace sirve aunque haya otra sesión abierta.
  if (tokenRestablecer) {
    return (
      <RestablecerPasswordPage
        token={tokenRestablecer}
        onTerminar={() => {
          // Quitar el token de la barra de direcciones y del historial.
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          setTokenRestablecer(null);
        }}
      />
    );
  }

  if (loading) return <div className="app-cargando">Cargando…</div>;
  // Sesión buena pero el servidor no respondió al arrancar: ofrecer reintentar
  // en vez de mandar al login, que haría creer que la sesión se perdió.
  if (token && !profesor && errorCarga) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>No se pudo conectar</h1>
          <p className="login-error">{errorCarga}</p>
          <button type="button" className="btn-primary" onClick={reintentarCarga}>
            Reintentar
          </button>
          <button type="button" className="btn-link" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }
  if (!token || !profesor) return <LoginPage />;
  // Obligatorio desde el 2026-10-02; el roster cargado no lo trae.
  if (!profesor.correo) return <CapturarCorreoPage />;

  // La barra va arriba de TODA vista autenticada: el menú de usuario (perfil,
  // cerrar sesión) tiene que estar a un clic desde cualquier pantalla.
  return (
    <>
      <BarraSuperior
        onInicio={() => setVista({ nombre: 'home' })}
        onPerfil={() => setVista({ nombre: 'perfil' })}
      />
      <Vista vista={vista} setVista={setVista} />
    </>
  );
}

function Vista({ vista, setVista }) {
  if (vista.nombre === 'perfil') {
    return <PerfilUsuario onVolver={() => setVista({ nombre: 'home' })} />;
  }

  if (vista.nombre === 'formulario') {
    return (
      <FormularioPreferencias
        profesorObjetivo={vista.profesorObjetivo ?? null}
        soloLecturaForzada={Boolean(vista.profesorObjetivo)}
        onVolver={() =>
          setVista({ nombre: vista.volverA ?? 'home', departamentoId: vista.departamentoId ?? null })
        }
      />
    );
  }
  if (vista.nombre === 'panel-preferencias') {
    // departamentoId viaja de ida y vuelta por "Ver formulario" para que el
    // admin regrese al departamento que estaba viendo y no al primero.
    return (
      <PanelPreferencias
        departamentoPrevio={vista.departamentoId ?? null}
        onVolver={() => setVista({ nombre: 'home' })}
        onVerFormulario={(profesorObjetivo, departamentoId) =>
          setVista({ nombre: 'formulario', profesorObjetivo, volverA: 'panel-preferencias', departamentoId })
        }
      />
    );
  }
  if (vista.nombre === 'editor-cuestionario') {
    return <EditorCuestionario onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'respuestas') {
    return <RespuestasCuestionario onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'reporte-preferencias') {
    return <ReportePreferencias onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'reporte-horas') {
    return <ReporteHoras onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'asignaciones-directas') {
    return <AsignacionesDirectas onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'catalogo-materias') {
    return <CatalogoMaterias onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'carga-demanda') {
    return <CargaDemanda onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'semestres') {
    return <Semestres onVolver={() => setVista({ nombre: 'home' })} />;
  }
  return (
    <HomePage
      onAbrirFormulario={() => setVista({ nombre: 'formulario' })}
      onAbrirPanelPreferencias={() => setVista({ nombre: 'panel-preferencias' })}
      onAbrirEditor={() => setVista({ nombre: 'editor-cuestionario' })}
      onAbrirRespuestas={() => setVista({ nombre: 'respuestas' })}
      onAbrirReporte={() => setVista({ nombre: 'reporte-preferencias' })}
      onAbrirReporteHoras={() => setVista({ nombre: 'reporte-horas' })}
      onAbrirAsignaciones={() => setVista({ nombre: 'asignaciones-directas' })}
      onAbrirCatalogoMaterias={() => setVista({ nombre: 'catalogo-materias' })}
      onAbrirCargaDemanda={() => setVista({ nombre: 'carga-demanda' })}
      onAbrirSemestres={() => setVista({ nombre: 'semestres' })}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
