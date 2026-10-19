import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { TIPO_CONTRATO_LABELS, departamentoInicial } from '../lib/roles';
import SelectorDepartamento from '../components/SelectorDepartamento';
import FormularioPreferencias from './FormularioPreferencias';

// El formulario de prueba del admin (2026-10-13). El admin no tiene
// departamento ni contrato, así que no llena formulario; aquí elige de qué
// departamento y con qué contrato lo quiere ver, y lo contesta como lo haría un
// profesor: mismas secciones, mismos mínimos, mismas validaciones al enviar.
// Nada se guarda (ver `prueba` en FormularioPreferencias): no deja rastro en
// las respuestas ni en los reportes de nadie.
export default function ProbarFormulario({ onVolver }) {
  const { profesor, departamentos } = useAuth();
  const [departamentoId, setDepartamentoId] = useState(() =>
    departamentoInicial(profesor, departamentos),
  );
  const [tipoContrato, setTipoContrato] = useState('tiempo_completo');
  // Cambiar la key vuelve a montar el formulario: arranca en blanco.
  const [intento, setIntento] = useState(0);

  return (
    <>
      <div className="formulario-screen prueba-herramientas">
        <SelectorDepartamento valor={departamentoId} onCambiar={setDepartamentoId} />
        <label className="selector-depto">
          Contrato
          <select value={tipoContrato} onChange={(e) => setTipoContrato(e.target.value)}>
            {Object.entries(TIPO_CONTRATO_LABELS).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-secondary" onClick={() => setIntento((n) => n + 1)}>
          Empezar de nuevo
        </button>
      </div>
      <FormularioPreferencias
        key={`${departamentoId}-${tipoContrato}-${intento}`}
        prueba={{ departamentoId, tipoContrato }}
        onVolver={onVolver}
      />
    </>
  );
}
