import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { etiquetaRol } from '../lib/roles';
import { etiquetaSemestre } from '../lib/semestre';

function iniciales(nombre) {
  // Los nombres del roster vienen como "APELLIDO APELLIDO NOMBRE" o al revés;
  // dos letras bastan para reconocerse, no para ser exactas.
  const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

export default function BarraSuperior({ onInicio, onPerfil }) {
  const { profesor, semestre, logout } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => {
      if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false);
    };
    const escape = (e) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  // Sin aviso de "sigues usando tu clave única" a propósito (decisión del
  // 2026-09-28): cambiar la contraseña es voluntario y por ahora no se empuja.

  return (
    <nav className="barra-superior">
      <button type="button" className="barra-marca" onClick={onInicio}>
        Malla Horarios
        {/* Siempre a la vista: en qué semestre se está trabajando. */}
        {semestre && <span className="barra-semestre">{etiquetaSemestre(semestre)}</span>}
      </button>

      <div className="usuario-menu" ref={contenedor}>
        <button
          type="button"
          className="usuario-boton"
          aria-haspopup="menu"
          aria-expanded={abierto}
          onClick={() => setAbierto((v) => !v)}
        >
          <span className="usuario-avatar" aria-hidden="true">
            {iniciales(profesor.nombre)}
          </span>
          <span className="usuario-nombre">{profesor.nombre}</span>
          <span aria-hidden="true">▾</span>
        </button>

        {abierto && (
          <div className="usuario-desplegable" role="menu">
            <div className="usuario-desplegable-datos">
              <strong>{profesor.nombre}</strong>
              <span>{etiquetaRol(profesor.rol)}</span>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                onPerfil();
              }}
            >
              Mi perfil
            </button>
            <button type="button" role="menuitem" onClick={logout}>
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
