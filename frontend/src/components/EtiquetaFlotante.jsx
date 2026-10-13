import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Etiqueta que se abre al hacer clic en una celda de un reporte y enseña el
 * detalle de ese número (qué materias, qué profesores).
 *
 * Va con position: fixed, anclada al botón que la abrió, y no dentro de la
 * celda: las tablas viven en contenedores con scroll horizontal, que la
 * recortarían en las últimas filas.
 *
 * `boton` es el elemento que la abrió: un clic en él no cuenta como "clic
 * fuera", para que ese mismo clic la cierre (lo maneja quien la abre) en vez
 * de cerrarla y volverla a abrir.
 */
export default function EtiquetaFlotante({ boton, titulo, subtitulo, etiquetaAria, className = '', onCerrar, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  // Se acomoda después de medirse: abajo del botón si cabe, si no arriba, y
  // sin salirse de la ventana por los lados.
  useLayoutEffect(() => {
    const ancla = boton.getBoundingClientRect();
    const caja = ref.current.getBoundingClientRect();
    const margen = 8;
    const abajo = ancla.bottom + 4;
    const top =
      abajo + caja.height <= window.innerHeight - margen ? abajo : Math.max(margen, ancla.top - 4 - caja.height);
    const left = Math.min(Math.max(margen, ancla.right - caja.width), window.innerWidth - margen - caja.width);
    setPos({ top, left });
  }, [boton]);

  // Se cierra con Escape, con un clic fuera, o si la página se mueve (se
  // quedaría flotando lejos de su celda).
  useEffect(() => {
    const alTeclear = (e) => {
      if (e.key !== 'Escape') return;
      onCerrar();
      boton.focus();
    };
    const alClic = (e) => {
      if (!ref.current?.contains(e.target) && !boton.contains(e.target)) onCerrar();
    };
    const alMoverse = (e) => {
      // El scroll dentro de la propia lista larga no la cierra.
      if (!ref.current?.contains(e.target)) onCerrar();
    };
    document.addEventListener('keydown', alTeclear);
    document.addEventListener('mousedown', alClic);
    window.addEventListener('scroll', alMoverse, true);
    window.addEventListener('resize', onCerrar);
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.removeEventListener('mousedown', alClic);
      window.removeEventListener('scroll', alMoverse, true);
      window.removeEventListener('resize', onCerrar);
    };
  }, [boton, onCerrar]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={etiquetaAria}
      className={`etiqueta-flotante ${className}`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      <div className="etiqueta-flotante-titulo">
        <strong>{titulo}</strong>
        {subtitulo && <span>{subtitulo}</span>}
      </div>
      {children}
    </div>
  );
}
