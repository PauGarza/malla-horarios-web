import { Fragment, memo } from 'react';
import { DIAS, claveDisponibilidad } from '../lib/formulario';

// Piezas del formulario que comparten el profesor (que lo contesta) y el editor
// de la jefatura (que las muestra deshabilitadas como vista previa). Si viven
// en un solo lugar, lo que ve la jefa al editar es exactamente lo que verá el
// profesor.

export function LeyendaDisponibilidad() {
  return (
    <div className="legend">
      <span><i className="legend-verde" /> Seguro disponible</span>
      <span><i className="legend-amarillo" /> Posible pero complicado</span>
      <span><i className="legend-rojo" /> No disponible</span>
    </div>
  );
}

/**
 * La rejilla lunes-viernes × franjas. Sin handlers queda deshabilitada (vista
 * previa del editor o formulario en solo lectura).
 */
export function RejillaDisponibilidad({
  franjas,
  niveles = {},
  disabled,
  onIniciar,
  onContinuar,
  onTeclado,
  onPointerMove,
  ayudaId,
}) {
  return (
    <div className="disponibilidad-grid-wrap">
      <table className="disponibilidad-grid" onPointerMove={onPointerMove}>
        <thead>
          <tr>
            <th>Hora</th>
            {DIAS.map((d) => (
              <th key={d.valor}>{d.etiqueta}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {franjas.map((f, i) => {
            const filaAnterior = franjas[i - 1];
            const saltoComida = filaAnterior && f.hora_inicio !== filaAnterior.hora_fin;
            return (
              <Fragment key={f.id}>
                {saltoComida && (
                  <tr className="fila-comida">
                    <td colSpan={DIAS.length + 1}>comida</td>
                  </tr>
                )}
                <tr>
                  <td className="franja-hora">{f.hora_inicio.slice(0, 5)}</td>
                  {DIAS.map((d) => {
                    // La franja no existe ese día (2026-10-02: 14:00-14:30 solo
                    // martes y jueves). Sin botón ni data-clave, así no se
                    // puede pintar ni con clic, ni arrastrando, ni con teclado.
                    if (f.dias && !f.dias.includes(d.valor)) {
                      return <td key={d.valor} className="slot-no-aplica" aria-hidden="true" />;
                    }
                    const clave = claveDisponibilidad(d.valor, f.id);
                    return (
                      <SlotCelda
                        key={d.valor}
                        clave={clave}
                        nivel={niveles[clave]}
                        etiqueta={`${d.etiqueta} ${f.hora_inicio.slice(0, 5)}`}
                        disabled={disabled}
                        ayudaId={ayudaId}
                        onIniciar={onIniciar}
                        onContinuar={onContinuar}
                        onTeclado={onTeclado}
                      />
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// memo + handlers estables: al arrastrar se repinta solo la celda que cambió,
// no las 112 de la rejilla.
const SlotCelda = memo(function SlotCelda({
  clave,
  nivel,
  etiqueta,
  disabled,
  ayudaId,
  onIniciar,
  onContinuar,
  onTeclado,
}) {
  return (
    <td>
      <button
        type="button"
        className={`slot ${nivel ?? ''}`}
        data-clave={clave}
        disabled={disabled}
        aria-label={`${etiqueta}: ${nivel ?? 'sin marcar'}`}
        aria-describedby={ayudaId}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          // Sin liberar la captura, en touch todos los eventos siguen yendo a
          // la celda donde empezó el gesto y arrastrar no pintaría nada más.
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          onIniciar(clave);
        }}
        onPointerEnter={() => {
          if (!disabled) onContinuar(clave);
        }}
        onKeyDown={(e) => {
          // El clic sintético que el navegador genera con Enter sobre un
          // <button> se perdió al quitar onClick, así que el teclado se maneja
          // aquí o la rejilla deja de ser usable sin mouse. No arma arrastre:
          // sin pointerup que lo cierre, se quedaría activo para siempre.
          if (disabled) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onTeclado(clave);
        }}
      />
    </td>
  );
});

// El texto del botón es el color, pero lo que se está respondiendo es si puede
// dar la materia; el title lo deja claro justo donde se toma la decisión.
export function TriToggle({ valor, disabled, onCambiar }) {
  return (
    <div className="tri-toggle">
      <button
        type="button"
        className={`v ${valor === 'verde' ? 'active' : ''}`}
        disabled={disabled}
        title="Sí puedo darla, con gusto"
        onClick={() => onCambiar('verde')}
      >
        Verde
      </button>
      <button
        type="button"
        className={`a ${valor === 'amarillo' ? 'active' : ''}`}
        disabled={disabled}
        title="Sí puedo darla, aunque no es mi primera opción"
        onClick={() => onCambiar('amarillo')}
      >
        Amarillo
      </button>
      <button
        type="button"
        className={`r ${valor === 'rojo' ? 'active' : ''}`}
        disabled={disabled}
        title="No puedo darla — por ejemplo, no podría preparar el material"
        onClick={() => onCambiar('rojo')}
      >
        Rojo
      </button>
    </div>
  );
}

/** "Álgebra Lineal (antes Álgebra I)  MAT-12345" */
export function MateriaInfo({ materia }) {
  return (
    <div className="materia-info">
      <span className="materia-nombre">{materia.nombreMostrado}</span>
      {materia.alias?.length > 0 && (
        <span className="materia-alias">(antes {materia.alias.join(', ')})</span>
      )}
      <span className="materia-clave">{materia.clave}</span>
    </div>
  );
}
