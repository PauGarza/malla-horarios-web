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

/** Departamentos para el formulario de alta; no requiere sesión. */
export const departamentosRegistro = () => pedir('registro.php', null);

/** Alta de cuenta con rol profesor; no requiere sesión. */
export const registrar = (datos) => post('registro.php', null, datos);

/** Lo editable del perfil propio; hoy solo el correo ('' lo borra). */
export const guardarCorreo = (token, correo) => post('perfil.php', token, { correo });

export const cambiarPassword = (token, passwordActual, passwordNueva) =>
  post('cambiar-password.php', token, {
    password_actual: passwordActual,
    password_nueva: passwordNueva,
  });

// --- Catálogos --------------------------------------------------------------

/** Perfil propio + departamentos + franjas + semestre actual, en una petición. */
export const catalogos = (token) => pedir('catalogos.php', token);

// --- Cuestionario del profesor ----------------------------------------------

/** El formulario del profesor que llama, ya resuelto por el servidor. */
export const cuestionario = (token, semestreId) =>
  pedir(`cuestionario.php?semestre_id=${semestreId}`, token);

export const leerPreferencia = (token, semestreId) =>
  pedir(`preferencia.php?semestre_id=${semestreId}`, token);

/** Guarda preferencia + materias + disponibilidad + respuestas en UNA transacción. */
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

// --- Editor del formulario (jefatura) ---------------------------------------
// departamentoId es opcional: sin él, el servidor usa el departamento propio.
// Solo jefe_division y admin pueden pedir otro (departamento_objetivo()).

const conDepto = (ruta, semestreId, departamentoId) =>
  `${ruta}${ruta.includes('?') ? '&' : '?'}semestre_id=${semestreId}` +
  (departamentoId ? `&departamento_id=${departamentoId}` : '');

/** El formulario completo, sin filtrar por audiencia, más las materias ocultas. */
export const leerFormulario = (token, semestreId, departamentoId) =>
  pedir(conDepto('configuracion.php', semestreId, departamentoId), token);

/** Guarda TODO el formulario en una transacción y devuelve cómo quedó. */
export const guardarFormulario = (token, semestreId, departamentoId, formulario) =>
  put(conDepto('configuracion.php?recurso=formulario', semestreId, departamentoId), token, formulario);

export const publicarFormulario = (token, semestreId, departamentoId, publicado) =>
  post(conDepto('configuracion.php?recurso=publicar', semestreId, departamentoId), token, { publicado });

// --- Respuestas y bloqueos (jefatura) ---------------------------------------

export const leerRespuestas = (token, semestreId, departamentoId) =>
  pedir(conDepto('respuestas.php', semestreId, departamentoId), token);

export const cambiarBloqueo = (token, semestreId, departamentoId, profesorId, materiaId, bloqueado) =>
  post(conDepto('respuestas.php?recurso=bloqueo', semestreId, departamentoId), token, {
    profesor_id: profesorId,
    materia_id: materiaId,
    bloqueado,
  });

// --- Semestres (admin y jefa de división) ----------------------------------

export const leerSemestres = (token) => pedir('semestres.php', token);

/** Abre (o reusa) ese semestre, lo deja activo y cierra el anterior. */
export const abrirSemestre = (token, tipo, anio) =>
  post('semestres.php?recurso=abrir', token, { tipo, anio });

export const reactivarSemestre = (token, semestreId) =>
  post('semestres.php?recurso=reactivar', token, { semestre_id: semestreId });

// --- Estimación de demanda (jefatura) ---------------------------------------

export const leerDemanda = (token, semestreId, departamentoId) =>
  pedir(conDepto('demanda.php', semestreId, departamentoId), token);

/** Reemplaza la estimación del departamento/semestre con estas filas, en una transacción. */
export const guardarDemanda = (token, semestreId, departamentoId, filas) =>
  post(conDepto('demanda.php', semestreId, departamentoId), token, { filas });
