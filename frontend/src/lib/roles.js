// Todo lo que el frontend sabe de roles, en un solo lugar. Antes vivía
// repartido entre HomePage y cada pantalla que necesitaba saber el alcance.

export const ROL_LABELS = {
  profesor: 'Profesor',
  jefe_departamento: 'Jefe de Departamento',
  jefe_division: 'Jefe de División',
  servicios_escolares: 'Servicios Escolares',
  nomina: 'Nómina',
  admin: 'Administrador',
};

export const TIPO_CONTRATO_LABELS = {
  tiempo_completo: 'Tiempo Completo',
  medio_tiempo: 'Medio Tiempo',
  asignatura: 'Asignatura',
};

// jefe_division va aquí porque la división académica está arriba de los
// departamentos: su alcance son los 3 de DACE. Espejo de ROLES_GESTION en
// api/lib/auth.php — si se agrega un rol, se agrega en los dos lados.
export const ROLES_GESTION = ['jefe_departamento', 'jefe_division', 'admin'];

export const gestionaDepartamento = (rol) => ROLES_GESTION.includes(rol);

// Espejo de ve_todos_los_departamentos() en api/lib/auth.php. Solo decide si
// se muestra el selector de departamento: quien autoriza es el servidor.
export const veTodosLosDepartamentos = (rol) => rol === 'jefe_division' || rol === 'admin';

export const etiquetaRol = (rol) => ROL_LABELS[rol] ?? rol;

/** El departamento con el que arranca una vista de jefatura. */
export function departamentoInicial(profesor, departamentos) {
  return profesor.departamento_id ?? departamentos[0]?.id ?? null;
}
