import { useAuth } from '../context/AuthContext';
import { veTodosLosDepartamentos } from '../lib/roles';

/**
 * Para jefe_division y admin, que trabajan sobre los 3 departamentos. A un
 * jefe_departamento no se le muestra: solo tiene el suyo, y el servidor
 * rechazaría cualquier otro de todas formas (departamento_objetivo()).
 */
export default function SelectorDepartamento({ valor, onCambiar, disabled }) {
  const { profesor, departamentos } = useAuth();
  if (!veTodosLosDepartamentos(profesor.rol)) return null;

  return (
    <label className="selector-depto">
      Departamento
      <select value={valor ?? ''} disabled={disabled} onChange={(e) => onCambiar(Number(e.target.value))}>
        {departamentos.map((d) => (
          <option key={d.id} value={d.id}>
            {d.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

