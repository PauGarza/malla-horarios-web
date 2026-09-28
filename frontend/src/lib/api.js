// Cliente hacia el API propio (api/*.php), que vive en el mismo origen que la
// app. Antes esto hablaba PostgREST directo contra la base y la seguridad la
// ponía Row Level Security; ahora cada endpoint decide qué devuelve, así que
// aquí no queda nada que filtrar ni ningún id que leer del token.
//
// Lo que desapareció al migrar y por qué:
//   - apiFetch: armaba query strings de PostgREST (?select=...&campo=eq.X).
//     Ya no hay sintaxis de consulta que el navegador pueda mandar.
//   - profesorIdDelToken: leía el JWT sin verificar para poder filtrar por el
//     propio id. El servidor ya sabe quién llama, y decidir algo con un token
//     sin verificar era justo lo que se quería dejar de hacer.
//   - apikey / VITE_DB_ANON_KEY: no hay llave pública que exponer.

// Mismo origen por defecto. VITE_API_URL solo hace falta para apuntar a otro
// host (ej. levantar el front en local contra el API del ITAM), y eso vuelve a
// necesitar CORS en el PHP.
const API = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(message, status, codigo) {
    super(message);
    this.status = status;
    // Identificador estable que manda el endpoint ('clave_duplicada',
    // 'ya_enviada', ...). Existe porque antes había que reconocer el nombre de
    // una constraint de Postgres dentro del texto del error, y eso no
    // sobrevive un cambio de motor.
    this.codigo = codigo ?? null;
  }
}

// Métodos que el proxy inverso del ITAM rechaza con un 405 propio, antes de
// que la petición llegue a PHP (comprobado 2026-09-25: solo deja pasar GET y
// POST). Se mandan como POST con X-HTTP-Method-Override, que es el tunelado
// clásico para atravesar intermediarios restrictivos; lib/auth.php los vuelve a
// resolver del otro lado.
const TUNELADOS = ['PUT', 'PATCH', 'DELETE'];

// El token va en X-Autoplanear-Token y NO en Authorization. Mismo motivo y mismo
// día: ese proxy descarta el header Authorization y PHP nunca lo ve. Se manda
// también como Bearer por si el API se despliega algún día detrás de algo que
// no lo toque; cuesta unos bytes y evita tener que recordar esto.
async function pedir(ruta, token, opciones = {}) {
  const pedido = opciones.method ?? 'GET';
  const tunelado = TUNELADOS.includes(pedido);

  const res = await fetch(`${API}/${ruta}`, {
    ...opciones,
    method: tunelado ? 'POST' : pedido,
    headers: {
      'Content-Type': 'application/json',
      ...(tunelado ? { 'X-HTTP-Method-Override': pedido } : {}),
      ...(token
        ? { 'X-Autoplanear-Token': token, Authorization: `Bearer ${token}` }
        : {}),
      ...opciones.headers,
    },
  });

  // Se mira el cuerpo y no el código de estado: un endpoint puede responder
  // 200 sin cuerpo, y res.json() sobre eso truena con "Unexpected end of JSON
  // input", que no se parece en nada al problema real.
  const texto = await res.text();
  let datos = null;
  if (texto) {
    try {
      datos = JSON.parse(texto);
    } catch {
      // Un error de PHP fuera de json_encode (fatal, warning impreso antes del
      // cuerpo) llega como HTML. Mejor decir que la respuesta no se entendió
      // que mostrar el HTML crudo.
      throw new ApiError(`Respuesta inesperada del servidor (${res.status})`, res.status);
    }
  }

  if (!res.ok) {
    throw new ApiError(datos?.error ?? `Error ${res.status} llamando a ${ruta}`, res.status, datos?.codigo);
  }
  return datos;
}

const conCuerpo = (metodo) => (ruta, token, cuerpo) =>
  pedir(ruta, token, { method: metodo, body: JSON.stringify(cuerpo) });

const post = conCuerpo('POST');
const put = conCuerpo('PUT');
const patch = conCuerpo('PATCH');

// --- Sesión -----------------------------------------------------------------

export const login = (cu, password) => post('login.php', null, { cu, password });

export const cambiarPassword = (token, passwordActual, passwordNueva) =>
  post('cambiar-password.php', token, {
    password_actual: passwordActual,
    password_nueva: passwordNueva,
  });

// --- Catálogos --------------------------------------------------------------

/** Perfil propio + departamentos + franjas + semestre actual, en una petición. */
export const catalogos = (token) => pedir('catalogos.php', token);

// --- Cuestionario del profesor ----------------------------------------------

/** El catálogo del cuestionario ya resuelto por el servidor. */
export const cuestionario = (token, semestreId) =>
  pedir(`cuestionario.php?semestre_id=${semestreId}`, token);

export const leerPreferencia = (token, semestreId) =>
  pedir(`preferencia.php?semestre_id=${semestreId}`, token);

/** Guarda preferencia + materias + disponibilidad en UNA transacción. */
export const guardarPreferencia = (token, semestreId, datos) =>
  put(`preferencia.php?semestre_id=${semestreId}`, token, datos);

// --- Panel del Jefe de Departamento -----------------------------------------

export const panel = (token, semestreId) => pedir(`panel.php?semestre_id=${semestreId}`, token);

/**
 * El formulario ya contestado de un profesor del departamento, en solo lectura.
 * Trae el MISMO catálogo que vio quien lo llenó, no el de quien lo consulta.
 */
export const preferenciaDeProfesor = (token, semestreId, profesorId) =>
  pedir(`panel.php?semestre_id=${semestreId}&profesor_id=${profesorId}`, token);

export const reabrirPreferencia = (token, preferenciaId) =>
  post('reabrir.php', token, { preferencia_id: preferenciaId });

// --- Catálogo de materias ---------------------------------------------------

export const listarMaterias = (token) => pedir('materias.php', token);

export const crearMateria = (token, materia) => post('materias.php', token, materia);

export const editarMateria = (token, id, cambios) =>
  patch(`materias.php?id=${id}`, token, cambios);

/** `agregar` y `quitar` son arreglos de pares [materiaId, coOfertadaId]. */
export const guardarCoOferta = (token, agregar, quitar) =>
  put('materias.php?recurso=co_oferta', token, { agregar, quitar });

// --- Configuración del cuestionario -----------------------------------------

export const leerConfiguracion = (token, semestreId) =>
  pedir(`configuracion.php?semestre_id=${semestreId}`, token);

/** Una o varias filas de materia_cuestionario, en una transacción. */
export const guardarFilasCuestionario = (token, semestreId, filas) =>
  put(`configuracion.php?recurso=cuestionario&semestre_id=${semestreId}`, token, { filas });

export const guardarConfigDepartamento = (token, semestreId, config) =>
  put(`configuracion.php?recurso=departamento&semestre_id=${semestreId}`, token, config);

export const cambiarModoMaterias = (token, semestreId, profesorId, modo) =>
  put(`configuracion.php?recurso=modo_materias&semestre_id=${semestreId}`, token, {
    profesor_id: profesorId,
    modo,
  });

/** Reemplaza la lista personalizada completa de un profesor. */
export const guardarElegibles = (token, profesorId, materiaIds) =>
  put('configuracion.php?recurso=elegibles', token, {
    profesor_id: profesorId,
    materia_ids: materiaIds,
  });
