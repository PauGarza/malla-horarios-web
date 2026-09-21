import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import FormularioPreferencias from './pages/FormularioPreferencias';
import PanelPreferencias from './pages/PanelPreferencias';

// Navegación por estado simple, sin librería de ruteo: con solo 4 pantallas
// (login / home / formulario / panel) una URL propia por vista todavía no se
// justifica. Si se agregan más vistas reales (panel de Jefe grande, admin,
// etc.) vale la pena revisar esto — hoy sería complejidad sin beneficio.
function Shell() {
  const { token, profesor, loading } = useAuth();
  const [vista, setVista] = useState('home');

  if (loading) return <div className="app-cargando">Cargando…</div>;
  if (!token || !profesor) return <LoginPage />;

  if (vista === 'formulario') {
    return <FormularioPreferencias onVolver={() => setVista('home')} />;
  }
  if (vista === 'panel-preferencias') {
    return <PanelPreferencias onVolver={() => setVista('home')} />;
  }
  return (
    <HomePage
      onAbrirFormulario={() => setVista('formulario')}
      onAbrirPanelPreferencias={() => setVista('panel-preferencias')}
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
