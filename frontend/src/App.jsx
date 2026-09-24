import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import FormularioPreferencias from './pages/FormularioPreferencias';
import PanelPreferencias from './pages/PanelPreferencias';
import ConfiguracionCuestionario from './pages/ConfiguracionCuestionario';
import CatalogoMaterias from './pages/CatalogoMaterias';

// Navegación por estado simple, sin librería de ruteo: con 5 pantallas
// (login / home / formulario / panel / configuración) una URL propia por vista
// todavía no se justifica. La vista es un objeto y no un string porque el
// formulario puede abrirse "para otro profesor" desde el panel y necesita
// llevar a quién; guardarlo en un useState aparte se desincronizaría.
// Si se agregan más vistas reales (panel de Jefe grande, admin) vale la pena
// revisar esto — hoy sería complejidad sin beneficio.
function Shell() {
  const { token, profesor, loading } = useAuth();
  const [vista, setVista] = useState({ nombre: 'home' });

  if (loading) return <div className="app-cargando">Cargando…</div>;
  if (!token || !profesor) return <LoginPage />;

  if (vista.nombre === 'formulario') {
    return (
      <FormularioPreferencias
        profesorObjetivo={vista.profesorObjetivo ?? null}
        soloLecturaForzada={Boolean(vista.profesorObjetivo)}
        onVolver={() => setVista({ nombre: vista.volverA ?? 'home' })}
      />
    );
  }
  if (vista.nombre === 'panel-preferencias') {
    return (
      <PanelPreferencias
        onVolver={() => setVista({ nombre: 'home' })}
        onVerFormulario={(profesorObjetivo) =>
          setVista({ nombre: 'formulario', profesorObjetivo, volverA: 'panel-preferencias' })
        }
      />
    );
  }
  if (vista.nombre === 'configuracion-cuestionario') {
    return <ConfiguracionCuestionario onVolver={() => setVista({ nombre: 'home' })} />;
  }
  if (vista.nombre === 'catalogo-materias') {
    return <CatalogoMaterias onVolver={() => setVista({ nombre: 'home' })} />;
  }
  return (
    <HomePage
      onAbrirFormulario={() => setVista({ nombre: 'formulario' })}
      onAbrirPanelPreferencias={() => setVista({ nombre: 'panel-preferencias' })}
      onAbrirConfigCuestionario={() => setVista({ nombre: 'configuracion-cuestionario' })}
      onAbrirCatalogoMaterias={() => setVista({ nombre: 'catalogo-materias' })}
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
