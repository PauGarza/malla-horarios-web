import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import FormularioPreferencias from './pages/FormularioPreferencias';

// Navegación por estado simple, sin librería de ruteo: con solo 3 pantallas
// (login / home / formulario) una URL propia por vista todavía no se
// justifica. Si se agregan más vistas reales (panel de Jefe, admin, etc.)
// vale la pena revisar esto — hoy sería complejidad sin beneficio.
function Shell() {
  const { token, profesor, loading } = useAuth();
  const [vista, setVista] = useState('home');

  if (loading) return <div className="app-cargando">Cargando…</div>;
  if (!token || !profesor) return <LoginPage />;

  if (vista === 'formulario') {
    return <FormularioPreferencias onVolver={() => setVista('home')} />;
  }
  return <HomePage onAbrirFormulario={() => setVista('formulario')} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
