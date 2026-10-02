// =============================================================================
// Pruebas de autorización del API, contra un servidor real.
//
// Automatiza la tabla de api/README.md §Verificación, que hasta 2026-09-30 se
// corría a mano con curl. RLS se reemplazó por código (lib/auth.php) y estas
// pruebas son lo único que dice si la traducción aguanta.
//
// Uso (Node 18+, sin dependencias):
//
//   AP_URL=https://horariosdace.itam.mx/api \
//   AP_PROF_CU=... AP_PROF_PASS=... \
//   node api/pruebas/autorizacion.mjs
//
// Opcionales:
//   AP_PROF2_CU / AP_PROF2_PASS  segunda cuenta de profesor: prueba que mandar
//                                el profesor_id de otro en el cuerpo del PUT no
//                                toca lo suyo.
//   AP_ESCRIBIR=1                habilita esa prueba. ESCRIBE: reemplaza el
//                                borrador de AP_PROF_CU en el semestre activo.
//                                Úsese solo con cuentas de prueba.
//   AP_JEFE_CU / AP_JEFE_PASS    un jefe_departamento: prueba que no puede pedir
//                                ?departamento_id= de otro departamento.
//
// Las credenciales van por variable de entorno y NUNCA en este archivo: el repo
// es público. Este .mjs no lo sube deploy:api (solo sube .php).
//
// Todas las peticiones que se espera que fallen (403/401) no escriben nada por
// construcción; la única que escribe es la de AP_ESCRIBIR.
// =============================================================================

const URL_API = process.env.AP_URL;
if (!URL_API || !process.env.AP_PROF_CU || !process.env.AP_PROF_PASS) {
  console.error('Faltan AP_URL, AP_PROF_CU y AP_PROF_PASS (ver el encabezado del archivo).');
  process.exit(2);
}

let fallas = 0;
let pasadas = 0;

function revisar(nombre, ok, detalle = '') {
  if (ok) pasadas += 1;
  else fallas += 1;
  console.log(`${ok ? '  ok ' : 'FALLA'}  ${nombre}${!ok && detalle ? `  — ${detalle}` : ''}`);
}

// Mismo tunelado que frontend/src/lib/api.js: el proxy del ITAM solo deja pasar
// GET y POST, y el token va en X-Autoplanear-Token porque descarta Authorization.
async function pedir(ruta, { token, metodo = 'GET', cuerpo } = {}) {
  const tunelado = ['PUT', 'PATCH', 'DELETE'].includes(metodo);
  const res = await fetch(`${URL_API}/${ruta}`, {
    method: tunelado ? 'POST' : metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(tunelado ? { 'X-HTTP-Method-Override': metodo } : {}),
      ...(token ? { 'X-Autoplanear-Token': token } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    // HTML de un error de PHP o del proxy: se reporta por status
  }
  return { status: res.status, datos, texto };
}

async function entrar(cu, password) {
  const r = await pedir('login.php', { metodo: 'POST', cuerpo: { cu, password } });
  if (r.status !== 200 || !r.datos?.token) {
    throw new Error(`No se pudo entrar con ${cu} (status ${r.status}): ${r.datos?.error ?? r.texto.slice(0, 80)}`);
  }
  return r.datos.token;
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// -----------------------------------------------------------------------------

console.log(`\nAPI: ${URL_API}\n`);

const tokProf = await entrar(process.env.AP_PROF_CU, process.env.AP_PROF_PASS);
const cat = await pedir('catalogos.php', { token: tokProf });
if (cat.status !== 200) throw new Error(`catalogos.php respondió ${cat.status}`);
const semestreId = cat.datos.semestre?.id;
const yo = cat.datos.perfil;
console.log(`Profesor: ${yo.nombre} (rol ${yo.rol}), semestre activo ${semestreId ?? 'ninguno'}\n`);
if (yo.rol !== 'profesor') {
  console.error('AP_PROF_CU tiene que ser una cuenta con rol "profesor" para que las pruebas signifiquen algo.');
  process.exit(2);
}

// --- Sesión ------------------------------------------------------------------

console.log('Sesión');
revisar('sin token -> 401', (await pedir('catalogos.php')).status === 401);

const [h, p, f] = tokProf.split('.');
const firmaAlterada = `${h}.${p}.${f.slice(0, -2)}${f.endsWith('AA') ? 'BB' : 'AA'}`;
revisar('firma alterada -> 401', (await pedir('catalogos.php', { token: firmaAlterada })).status === 401);

const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
const algNone = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ ...claims, rol: 'admin' })}.`;
revisar('alg "none" con rol admin -> 401', (await pedir('catalogos.php', { token: algNone })).status === 401);

const payloadAdmin = `${h}.${b64url({ ...claims, rol: 'admin' })}.${f}`;
revisar('claim rol cambiado a admin (firma vieja) -> 401', (await pedir('panel.php?semestre_id=1', { token: payloadAdmin })).status === 401);

const vencido = `${h}.${b64url({ ...claims, exp: 1 })}.${f}`;
revisar('exp en el pasado -> 401', (await pedir('catalogos.php', { token: vencido })).status === 401);

// --- Endpoints de gestión con token de profesor -------------------------------

console.log('\nGestión con token de profesor (todo debe dar 403)');
const s = semestreId ?? 1;
const gestion = [
  ['panel.php', 'GET', `panel.php?semestre_id=${s}`],
  ['panel.php detalle', 'GET', `panel.php?semestre_id=${s}&profesor_id=${yo.id}`],
  ['reabrir.php', 'POST', 'reabrir.php', { preferencia_id: 1 }],
  ['materias.php GET', 'GET', 'materias.php'],
  ['materias.php POST', 'POST', 'materias.php', { clave: 'ZZZ-00000', nombre: 'x', creditos: 6 }],
  ['materias.php PATCH', 'PATCH', 'materias.php?id=1', { nombre: 'x' }],
  ['materias.php co_oferta', 'PUT', 'materias.php?recurso=co_oferta', { agregar: [], quitar: [] }],
  ['configuracion.php GET', 'GET', `configuracion.php?semestre_id=${s}`],
  ['configuracion.php publicar', 'POST', `configuracion.php?recurso=publicar&semestre_id=${s}`, { publicado: false }],
  ['configuracion.php formulario', 'PUT', `configuracion.php?recurso=formulario&semestre_id=${s}`, {}],
  ['respuestas.php GET', 'GET', `respuestas.php?semestre_id=${s}`],
  ['respuestas.php bloqueo', 'POST', `respuestas.php?recurso=bloqueo&semestre_id=${s}`, { profesor_id: yo.id, materia_id: 1, bloqueado: true }],
  ['semestres.php GET', 'GET', 'semestres.php'],
  ['semestres.php abrir', 'POST', 'semestres.php?recurso=abrir', { tipo: 'otono', anio: 2099 }],
  ['demanda.php GET', 'GET', `demanda.php?semestre_id=${s}`],
  ['demanda.php POST', 'POST', `demanda.php?semestre_id=${s}`, { filas: [] }],
];
for (const [nombre, metodo, ruta, cuerpo] of gestion) {
  const r = await pedir(ruta, { token: tokProf, metodo, cuerpo });
  revisar(`${nombre} -> 403`, r.status === 403, `status ${r.status}`);
}

// --- password_hash nunca sale -------------------------------------------------

console.log('\nDatos sensibles');
const propias = [
  await pedir('catalogos.php', { token: tokProf }),
  semestreId ? await pedir(`cuestionario.php?semestre_id=${semestreId}`, { token: tokProf }) : null,
  semestreId ? await pedir(`preferencia.php?semestre_id=${semestreId}`, { token: tokProf }) : null,
].filter(Boolean);
revisar(
  'password_hash no aparece en catalogos/cuestionario/preferencia',
  propias.every((r) => !/password_hash|\$2[aby]\$/.test(r.texto)),
);

// --- profesor_id ajeno en el cuerpo ------------------------------------------

if (process.env.AP_PROF2_CU && process.env.AP_ESCRIBIR === '1' && semestreId) {
  console.log('\nprofesor_id ajeno en el cuerpo del PUT (escribe en AP_PROF_CU)');
  const tokOtro = await entrar(process.env.AP_PROF2_CU, process.env.AP_PROF2_PASS);
  const otro = (await pedir('catalogos.php', { token: tokOtro })).datos.perfil;
  const antes = (await pedir(`preferencia.php?semestre_id=${semestreId}`, { token: tokOtro })).texto;

  const r = await pedir(`preferencia.php?semestre_id=${semestreId}`, {
    token: tokProf,
    metodo: 'PUT',
    cuerpo: { profesor_id: otro.id, num_cursos_max: 1, estado: 'borrador', materias: [], disponibilidad: [], respuestas: [] },
  });
  const despues = (await pedir(`preferencia.php?semestre_id=${semestreId}`, { token: tokOtro })).texto;
  revisar('la preferencia del otro no cambió', antes === despues, `PUT respondió ${r.status}`);
  if (r.status === 409) console.log('       (el formulario no está publicado: el PUT ni siquiera escribió)');
} else {
  console.log('\n(omitida: profesor_id ajeno — requiere AP_PROF2_CU/AP_PROF2_PASS y AP_ESCRIBIR=1)');
}

// --- Jefe de departamento fuera de su departamento ----------------------------

if (process.env.AP_JEFE_CU && semestreId) {
  console.log('\nJefe de departamento sobre otro departamento (todo debe dar 403)');
  const tokJefe = await entrar(process.env.AP_JEFE_CU, process.env.AP_JEFE_PASS);
  const jefe = (await pedir('catalogos.php', { token: tokJefe })).datos;
  if (jefe.perfil.rol !== 'jefe_departamento') {
    revisar('AP_JEFE_CU es jefe_departamento', false, `rol ${jefe.perfil.rol}`);
  } else {
    const ajeno = jefe.departamentos.find((d) => d.id !== jefe.perfil.departamento_id);
    for (const ruta of ['configuracion.php', 'respuestas.php', 'demanda.php', 'materias.php']) {
      const r = await pedir(`${ruta}?semestre_id=${semestreId}&departamento_id=${ajeno.id}`, { token: tokJefe });
      revisar(`${ruta}?departamento_id=${ajeno.id} -> 403`, r.status === 403, `status ${r.status}`);
    }
    const r = await pedir('semestres.php', { token: tokJefe });
    revisar('semestres.php (solo división/admin) -> 403', r.status === 403, `status ${r.status}`);
  }
} else {
  console.log('(omitida: jefe fuera de su departamento — requiere AP_JEFE_CU/AP_JEFE_PASS)');
}

console.log(`\n${pasadas} pasaron, ${fallas} fallaron.\n`);
process.exit(fallas > 0 ? 1 : 0);
