// La vista de malla (pages/MallaHorarios.jsx la monta).
//
// Es la lógica del mockup que ya vieron los jefes
// (malla-horarios/docs/mockup/mockup-vista-malla.html), portada tal cual: la
// malla son cientos de bloques posicionados a mano, con carriles, arrastre y
// capas de disponibilidad, y se pinta con innerHTML en un contenedor que React
// no toca. React solo trae los datos y monta/desmonta.
//
// Los datos son los de api/malla.php:
//   entrada  el paquete autoplanear-entrada/2 del alcance (catálogos, rejilla,
//            profesores, salones, grupos_fijos = publicados, asignaciones_fijas)
//   grupos   los grupos sin publicar, en el formato de un grupo de la salida
//   corrida  la última corrida del motor que toca el alcance, o null
// Las reglas que se revisan en vivo son las de §5 de
// malla-horarios/docs/convencion-datos-motor.md, igual que optv1/validar.py:
// rojo = la subida lo rechazaría; ámbar = aviso.
//
// Hoy es de solo lectura (opciones.editable = false): se puede filtrar, ver los
// choques y la disponibilidad, pero no mover. El arrastre ya está escrito y
// queda apagado hasta que existan los endpoints para guardar.

const DIA_TXT = { lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado' };
const DIA_CORTO = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const titleCase = (s) => (s || '').toLowerCase().replace(/(^|[\s.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const natural = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
const hm = (t) => t.replace(/^0(\d)/, '$1');
const plural = (n, s, p) => n + ' ' + (n === 1 ? s : p || s + 's');
const horas = (bl) => (bl / 2).toLocaleString('es-MX');
// "Apellido Apellido Nombre(s)" → "Apellido Nombre"
const nombreCorto = (n) => {
  const w = titleCase(n).split(/\s+/);
  return w.length <= 2 ? w.join(' ') : w[0] + ' ' + w[w.length - 1];
};
const NIVEL_TXT = { verde: 'verde', amarillo: 'amarillo', rojo: 'rojo', sin: 'sin respuesta', maestria: 'su materia de maestría', ocupado: 'ocupado en otro departamento' };

// Rojo = la subida del motor lo rechazaría (§5, duras); ámbar = aviso.
const TIPOS = {
  prof: 'Profesor en dos grupos a la vez', ocupado: 'Choque con su clase en otro departamento', salon: 'Salón ocupado dos veces',
  maestria: 'Encima de una materia de maestría', rojo: 'Fuera de la disponibilidad', bloqueo: 'Profesor bloqueado para la materia',
  franja: 'Franja que no vale ese día o para el departamento', salon_auth: 'Salón no autorizado para el departamento', salon_tipo: 'Salón de otro tipo',
  salon_cap: 'Salón con menos lugares que el cupo', tope: 'Asignatura arriba del tope de horas', fija: 'Asignación directa sin cumplir',
  fija_sin: 'Asignación directa sin grupo',
  cohorte: 'Choque de semestre (misma cohorte)', asig_rojo: 'Asignación directa en horas no disponibles', amarillo: 'Horas en amarillo',
  mat: 'Materia que el profesor no prefiere', borrador: 'Formulario en borrador', cursos: 'Más cursos de los pedidos', creditos: 'Bloques distintos a los créditos',
  cupo: 'Menos lugares que la demanda estimada', demanda: 'Más clases que las que pide la demanda', media: 'Media hora suelta', sinprof: 'Sin profesor', sinsalon: 'Sin salón',
};
const ORDEN = Object.keys(TIPOS);

const ESQUELETO = `
<header class="m-head">
  <div class="brand"><b data-m="ttl">Malla horaria</b><span data-m="semLbl"></span></div>
  <div class="stats" data-m="stats"></div>
  <div class="hdr-actions" data-m="acciones"></div>
</header>
<div class="m-app">
  <aside class="m-side" data-m="side"></aside>
  <main class="m-main">
    <div class="toolbar">
      <div class="seg" data-m="viewSeg">
        <button data-v="salon">Por salón</button>
        <button data-v="prof">Por profesor</button>
        <button data-v="semana">Semana</button>
      </div>
      <div class="days" data-m="dayPills"></div>
      <div class="filters">
        <div class="ms" data-m="msDep"></div>
        <div class="ms" data-m="msProf"></div>
        <div class="ms" data-m="msRoom"></div>
        <div class="ms" data-m="msMat"></div>
        <div class="ms" data-m="msCoh"></div>
        <button class="btn clearf" data-m="clearF" hidden>Quitar filtros</button>
      </div>
    </div>
    <div data-m="banners"></div>
    <div class="hint" data-m="hint"></div>
    <div class="gridwrap" data-m="gridwrap">
      <div class="colhead" data-m="colhead"></div>
      <div class="gridbody" data-m="gridbody"></div>
    </div>
  </main>
</div>
<div class="m-tip" data-m="tip"></div>
<div class="m-card" data-m="card"></div>`;

/**
 * Pinta la malla dentro de `raiz` y devuelve { destruir }.
 *
 * opciones:
 *   editable   false por ahora (solo lectura)
 *   onVolver   el botón "← Inicio"
 *   alcances   [{ valor, etiqueta }] para el selector de departamento (admin), o null
 *   alcance    el valor elegido
 *   onAlcance  (valor) => void
 */
export function montarMalla(raiz, datos, opciones = {}) {
  const ED = Boolean(opciones.editable);
  raiz.innerHTML = ESQUELETO;
  const $m = (k) => raiz.querySelector(`[data-m="${k}"]`);
  const limpiezas = [];
  const escuchar = (blanco, ev, fn, o) => {
    blanco.addEventListener(ev, fn, o);
    limpiezas.push(() => blanco.removeEventListener(ev, fn, o));
  };

  // ---------- Modelo: entrada + grupos → lo que pinta la vista ----------
  let M = null, P = {}, R = {}, ROOMS = [];
  let groups = [], byId = {};
  const reindex = () => { byId = Object.fromEntries(groups.map((g) => [g.id, g])); };
  const ui = { side: true, view: 'semana', day: 0, sel: null, deps: new Set(), profs: new Set(), rooms: new Set(), mats: new Set(), cohs: new Set(), showAll: {} };

  function cargar(ent, gsal, corrida) {
    const dias = ent.rejilla.dias;
    const alcance = (ent.alcance && ent.alcance.departamentos) || ent.departamentos.map((d) => d.id);
    const enAlcance = new Set(alcance);
    // Rejilla: las franjas del alcance, más las que use algún grupo fijo u ocupado (§3.3, §3.7)
    const todas = [...ent.rejilla.franjas].sort((a, b) => a.orden - b.orden);
    const pos = Object.fromEntries(todas.map((f, i) => [f.inicio, i]));
    const usadas = new Set();
    const marcar = (se) => { let i = pos[se.inicio]; for (let k = 0; k < se.bloques && i != null && i < todas.length; k++, i++) usadas.add(i); };
    for (const g of [...(ent.grupos_fijos || []), ...gsal]) (g.sesiones || []).forEach(marcar);
    for (const p of ent.profesores) (p.ocupado || []).forEach(marcar);
    const F = todas.filter((f, i) => f.departamento_id == null || enAlcance.has(f.departamento_id) || usadas.has(i))
      .map((f) => ({ inicio: f.inicio, fin: f.fin, dias: f.dias ? new Set(f.dias) : null, depto: f.departamento_id ?? null }));
    const idx = Object.fromEntries(F.map((f, i) => [f.inicio, i]));
    const dIdx = Object.fromEntries(dias.map((d, i) => [d, i]));
    const avisosCarga = [];
    const toSes = (se) => {
      const d = dIdx[se.dia], s = idx[se.inicio];
      if (d == null || s == null) { avisosCarga.push(`sesión ${se.dia} ${se.inicio} fuera de la rejilla`); return null; }
      const o = { d, s, len: se.bloques };
      if (se.salon_id !== undefined) o.roomId = se.salon_id;
      return o;
    };
    const mats = {};
    for (const m of ent.materias) mats[m.id] = { id: m.id, clave: m.clave, nombre: m.nombre, depto: m.departamento_id, cr: m.creditos,
      co: m.co_oferta || [], planes: m.planes || [], demanda: m.demanda || null, tipo: m.tipo_salon_requerido ?? null };
    P = {};
    for (const p of ent.profesores) {
      const maes = new Set();
      for (const [dia, hs] of Object.entries(p.maestria || {})) for (const h of hs) if (dIdx[dia] != null && idx[h] != null) maes.add(dIdx[dia] * 100 + idx[h]);
      P[p.id] = { id: p.id, cu: p.cu, nombre: p.nombre, short: nombreCorto(p.nombre), depto: p.departamento_id, contrato: p.tipo_contrato, pref: p.preferencia,
        disp: dias.map((dia) => F.map((f) => (p.disponibilidad && p.disponibilidad[dia] && p.disponibilidad[dia][f.inicio]) || null)),
        respondio: !!(p.disponibilidad && Object.keys(p.disponibilidad).length), maes,
        ocup: (p.ocupado || []).map((o) => { const x = toSes(o); return x && { ...x, motivo: o.motivo || 'otro departamento' }; }).filter(Boolean),
        mats: p.materias || {}, bloq: new Set(p.bloqueos || []) };
    }
    ROOMS = (ent.salones || []).map((r) => ({ id: r.id, name: r.nombre, cap: r.capacidad, tipo: r.tipo ?? null, disp: r.disponible || {} }))
      .sort((a, b) => { const na = /^\d/.test(a.name), nb = /^\d/.test(b.name); return na !== nb ? (na ? -1 : 1) : natural(a.name, b.name); });
    R = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
    const asig = {};
    for (const a of ent.asignaciones_fijas || []) {
      const cells = new Set();
      for (const se of a.sesiones || []) { const x = toSes(se); if (x) for (let k = 0; k < x.len; k++) cells.add(x.d * 100 + x.s + k); }
      asig[a.id] = { id: a.id, mid: a.materia_id, pid: a.profesor_id, cells, conHorario: (a.sesiones || []).length > 0 };
    }
    const coh = cohortes(ent.materias);
    const conGrupos = new Set([...ent.materias.filter((m) => m.demanda).map((m) => m.id), ...(ent.asignaciones_fijas || []).map((a) => a.materia_id)]);
    const est = estrellasCoOferta(ent.materias, conGrupos);
    M = { ent, corrida, dias, alcance, deptos: Object.fromEntries(ent.departamentos.map((d) => [d.id, d])), reglas: ent.reglas || {},
      F, mats, asig, pares: coh.pares, cohortes: coh.lista, principalDe: est.principalDe, estrellas: est.estrellas,
      motivos: Object.fromEntries(((corrida && corrida.sin_asignar) || []).map((x) => [x.materia_id, x.motivo])), avisosCarga };
    const mk = (g, locked) => ({ id: locked ? 'fijo-' + (g.grupo_id ?? g.ref) : String(g.ref), grupoId: g.grupo_id ?? null, fijaId: g.asignacion_fija_id ?? null, locked,
      items: g.materias.map((x) => ({ mid: x.materia_id, clave: x.clave || (mats[x.materia_id] || {}).clave || String(x.materia_id), numero: x.numero || '', pct: x.porcentaje ?? null })),
      profs: [...(g.profesores || [])], roomId: g.salon_id ?? null, sessions: (g.sesiones || []).map(toSes).filter(Boolean), cupo: g.cupo_maximo ?? null });
    groups = [...(ent.grupos_fijos || []).map((g) => mk(g, true)), ...gsal.map((g) => mk(g, false))];
    reindex();
    ui.view = ROOMS.length ? 'salon' : 'prof';
  }

  // Clases compartidas de la co-oferta (igual que estrellas_co_oferta de optv1/convencion.py, 2026-10-21):
  // de mayor a menor demanda, una clave se pega a la principal de más demanda entre sus co-ofertas; si
  // ninguna lo es, ella es principal. Una estrella de varias claves pide demanda ajustada sumada / 30
  // clases (capacidad_planeacion de la principal), al entero más cercano y al menos 1 como redondea
  // Escolares, y cada clase lleva todas sus claves; una clave sola pide sus grupos_sugeridos.
  function estrellasCoOferta(materias, conGrupos) {
    const mat = Object.fromEntries(materias.map((m) => [m.id, m]));
    const ids = [...conGrupos].filter((x) => mat[x]);
    const dem = (x) => mat[x].demanda || {};
    const sug = (x) => dem(x).grupos_sugeridos || 0;
    const aj = (x) => dem(x).demanda_ajustada ?? null;
    const cmp = (a, b) => (mat[a].clave < mat[b].clave ? -1 : mat[a].clave > mat[b].clave ? 1 : 0);
    const principalDe = {};
    for (const x of [...ids].sort((a, b) => (aj(b) || 0) - (aj(a) || 0) || sug(b) - sug(a) || cmp(a, b))) {
      const prin = (mat[x].co_oferta || []).filter((o) => principalDe[o] === o);
      principalDe[x] = prin.length ? prin.sort((a, b) => (aj(b) || 0) - (aj(a) || 0) || cmp(a, b))[0] : x;
    }
    const estrellas = {};
    for (const [x, p] of Object.entries(principalDe)) (estrellas[p] ??= { mids: [], n: 0 }).mids.push(+x);
    for (const [p, e] of Object.entries(estrellas)) {
      const ms = e.mids;
      if (ms.length === 1) e.n = sug(+p);
      else if (!ms.some(sug)) e.n = 0;
      else if (ms.every((x) => aj(x) == null)) e.n = Math.max(...ms.map(sug));
      else e.n = Math.max(1, Math.floor(Math.round(ms.reduce((t, x) => t + (aj(x) || 0), 0) * 1e6) / 1e6 / (dem(+p).capacidad_planeacion || 30) + 0.5));
      ms.sort(cmp);
    }
    return { principalDe, estrellas };
  }

  // Cohortes: materias del mismo plan y semestre (convención §3.4; igual que optv1/cohortes.py, vigente y anterior)
  function cohortes(materias) {
    const cl = (c) => { if (!c || !c.includes('-')) return null; const i = c.lastIndexOf('-'), le = c.slice(i + 1); return le.length === 1 && /\p{L}/u.test(le) ? [c.slice(0, i), le] : null; };
    const todos = materias.flatMap((m) => m.planes || []);
    const usados = new Set();
    if (!todos.some((p) => 'vigente' in p && p.clave)) todos.forEach((p) => usados.add(p.clave || p.plan));
    else {
      const vig = {};
      for (const p of todos) { const c = cl(p.clave); if (p.vigente && c && (vig[c[0]] || '') < c[1]) vig[c[0]] = c[1]; }
      for (const p of todos) {
        const c = cl(p.clave);
        if (!c) { if (p.vigente) usados.add(p.clave || p.plan); continue; }
        const v = vig[c[0]];
        if (v && (c[1] === v || c[1] === String.fromCharCode(v.charCodeAt(0) - 1))) usados.add(p.clave);
      }
    }
    const por = new Map();
    for (const m of materias) for (const p of m.planes || []) {
      const k = p.clave || p.plan; if (!usados.has(k)) continue;
      const key = k + ' · ' + p.semestre_plan + '.º';
      if (!por.has(key)) por.set(key, { key, plan: k, sem: p.semestre_plan, mids: new Set() });
      por.get(key).mids.add(m.id);
    }
    const co = Object.fromEntries(materias.map((m) => [m.id, new Set(m.co_oferta || [])]));
    const pares = new Map(), lista = [];
    for (const c of por.values()) {
      const ids = [...c.mids].sort((a, b) => a - b);
      if (ids.length < 2) continue;
      lista.push({ key: c.key, plan: c.plan, sem: c.sem, mids: ids });
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        if (co[a].has(b) || co[b].has(a)) continue;
        const k = a + '|' + b;
        if (!pares.has(k)) pares.set(k, { a, b, ks: [] });
        pares.get(k).ks.push(c.key);
      }
    }
    return { pares: [...pares.values()], lista };
  }

  // ---------- Rejilla ----------
  const NS = () => M.F.length;
  const ND = () => M.dias.length;
  const DN = (d) => DIA_TXT[M.dias[d]] || M.dias[d];
  const DC = (d) => DIA_CORTO[M.dias[d]] || M.dias[d];
  const lbl = (s) => hm(M.F[s].inicio);
  const range = (s, len) => lbl(s) + '–' + hm(M.F[s + len - 1].fin);
  const contiguo = (s) => s + 1 < M.F.length && M.F[s].fin === M.F[s + 1].inicio; // la franja s y la s+1
  const diaOk = (s, d) => !M.F[s].dias || M.F[s].dias.has(M.dias[d]);
  const franjaOk = (s, d, dep) => !!M.F[s] && diaOk(s, d) && (M.F[s].depto == null || M.F[s].depto === dep);
  function sesionOk(d, s, len, dep) {
    if (d < 0 || d >= ND() || s < 0 || s + len > NS()) return false;
    for (let k = 0; k < len; k++) { if (!franjaOk(s + k, d, dep)) return false; if (k && !contiguo(s + k - 1)) return false; }
    return true;
  }
  function snapS(d, s, len, dep) {
    for (let k = 0; k < NS(); k++) { if (sesionOk(d, s - k, len, dep)) return s - k; if (k && sesionOk(d, s + k, len, dep)) return s + k; }
    return null;
  }
  const cellsOfSes = (se) => Array.from({ length: se.len }, (_, k) => se.d * 100 + se.s + k);
  const runsTxt = (arr) => {
    const a = [...new Set(arr)].sort((x, y) => x - y), out = [];
    let st = a[0], pv = a[0];
    for (const x of a.slice(1)) { if (x === pv + 1 && contiguo(pv)) { pv = x; continue; } out.push(range(st, pv - st + 1)); st = pv = x; }
    out.push(range(st, pv - st + 1));
    return out.join(', ');
  };
  const cellsTxt = (cells) => {
    const by = {};
    for (const c of cells) (by[Math.floor(c / 100)] ??= []).push(c % 100);
    const m = {};
    for (const d of Object.keys(by).map(Number).sort((a, b) => a - b)) (m[runsTxt(by[d])] ??= []).push(d);
    return Object.entries(m).map(([r, ds]) => ds.map(DC).join(', ') + ' ' + r).join(' · ');
  };

  // ---------- Grupos ----------
  const mat = (g) => M.mats[g.items[0].mid] || { nombre: g.items[0].clave, cr: null, depto: null };
  const gDep = (g) => mat(g).depto;
  const pref = (c, base) => (c.slice(0, 4) === base.slice(0, 4) ? c.slice(4) : c);
  const gCode = (g) => g.items[0].clave + (g.items.length > 1 ? ' + ' + g.items.slice(1).map((i) => pref(i.clave, g.items[0].clave)).join(' + ') : '');
  const gLabel = (g) => gCode(g) + (g.items[0].numero ? ' · ' + g.items[0].numero : '');
  const gName = (g) => mat(g).nombre;
  const gNames = (g) => [...new Set(g.items.map((i) => (M.mats[i.mid] || {}).nombre || i.clave))].join(' / ');
  const gFull = (g) => `<b>${esc(gNames(g))}</b> (${esc(gLabel(g))})`;
  const roomOf = (g, se) => (se.roomId !== undefined ? se.roomId : g.roomId);
  const rName = (id) => (id != null && R[id] ? R[id].name : 'Sin salón');
  const pName = (id) => (id != null && P[id] ? P[id].short : 'Sin profesor');
  const pFull = (id) => (id != null && P[id] ? titleCase(P[id].nombre) : 'Sin profesor');
  const gProf = (g) => (g.profs.length ? g.profs.map(pName).join(' / ') : g.locked ? 'Programación de ' + ((M.deptos[gDep(g)] || {}).nombre || 'otro departamento') : 'Sin profesor');
  const gProfFull = (g) => (g.profs.length ? g.profs.map(pFull).join(' / ') : gProf(g));
  const hue = (g) => { let h = 0; for (const ch of g.items[0].clave) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const sesTxt = (g) => {
    const m = {};
    for (const s of g.sessions) (m[range(s.s, s.len)] ??= []).push(s.d);
    return Object.entries(m).map(([r, ds]) => ds.sort((a, b) => a - b).map(DC).join(', ') + ' ' + r).join(' · ') || 'Sin horario';
  };
  const bloquesDe = (g) => g.sessions.reduce((n, s) => n + s.len, 0);
  // Disponibilidad efectiva de un profesor en (día, franja): maestría > lo que marcó; sin marcar = "sin"
  const nivel = (p, d, s) => (p.maes.has(d * 100 + s) ? 'maestria' : p.disp[d][s] || 'sin');
  const sinComo = () => M.reglas.sin_respuesta_cuenta_como || 'rojo';
  const esRojo = (nv) => nv === 'rojo' || (nv === 'sin' && sinComo() === 'rojo');
  const esAmarillo = (nv) => nv === 'amarillo' || (nv === 'sin' && sinComo() === 'amarillo');
  // Un grupo fijo sin ninguna clave del departamento del profesor no cuenta como curso (convención §3.7)
  const cuentaComoCurso = (g, p) => !g.locked || g.items.some((i) => (M.mats[i.mid] || {}).depto === p.depto);
  function carga(pid, gs = groups) {
    const p = P[pid];
    let cursos = 0, bl = p ? p.ocup.reduce((n, o) => n + o.len, 0) : 0;
    for (const g of gs) if (g.profs.includes(pid)) { bl += bloquesDe(g); if (p && cuentaComoCurso(g, p)) cursos++; }
    return { cursos, bl, max: p && p.pref ? p.pref.num_cursos_max ?? null : null };
  }
  // Lugares que se esperan en la clase (como optv1/validar.py)
  function estimado(g) {
    let e = 0;
    for (const it of g.items) {
      const d = (M.mats[it.mid] || {}).demanda || {};
      const n = (M.estrellas[M.principalDe[it.mid]] || {}).n;
      e += d.demanda_ajustada && n ? Math.ceil(d.demanda_ajustada / n) : d.capacidad_planeacion || 30;
    }
    return e;
  }

  // ---------- Revisión en vivo (convención §5) ----------
  function analyze(gs) {
    const list = [];
    const add = (type, sev, ids, cells, extra) => list.push({ type, sev, ids, cells: cells || [], ...extra });
    const cellsOf = new Map();
    const profCell = new Map(), roomCell = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const g of gs) {
      const cs = new Set();
      for (const se of g.sessions) for (const c of cellsOfSes(se)) {
        cs.add(c);
        const r = roomOf(g, se);
        if (r != null) push(roomCell, r + '|' + c, g.id);
        for (const p of g.profs) push(profCell, p + '|' + c, g.id);
      }
      cellsOf.set(g.id, cs);
    }
    for (const p of Object.values(P)) p.ocup.forEach((o, i) => { for (const c of cellsOfSes(o)) push(profCell, p.id + '|' + c, '#' + i); });
    // 4. y 5. choques de profesor y de salón
    const pares = new Map();
    const par = (type, x, y, c, extra) => {
      const k = type + '|' + x + '|' + y;
      if (!pares.has(k)) pares.set(k, { type, sev: 'hard', ids: y ? [x, y] : [x], cells: [], ...extra });
      pares.get(k).cells.push(c);
    };
    for (const [key, arr] of profCell) {
      if (arr.length < 2) continue;
      const [pid, c] = key.split('|').map(Number);
      const gsx = [...new Set(arr.filter((v) => v[0] !== '#'))].sort(), oc = arr.filter((v) => v[0] === '#');
      for (let i = 0; i < gsx.length; i++) for (let j = i + 1; j < gsx.length; j++) par('prof', gsx[i], gsx[j], c, { p: pid });
      for (const o of oc) for (const g of gsx) par('ocupado', g, null, c, { p: pid, motivo: P[pid].ocup[+o.slice(1)].motivo });
    }
    for (const [key, arr] of roomCell) {
      if (arr.length < 2) continue;
      const [rid, c] = key.split('|');
      const gsx = [...new Set(arr)].sort();
      for (let i = 0; i < gsx.length; i++) for (let j = i + 1; j < gsx.length; j++) par('salon', gsx[i], gsx[j], +c, { r: rid });
    }
    list.push(...pares.values());
    // Reglas de cada grupo. Los publicados solo ocupan: no se revisan (§3.7)
    const bpc = M.reglas.bloques_por_credito || 1;
    for (const g of gs) {
      if (g.locked) continue;
      const dep = gDep(g), cs = cellsOf.get(g.id), a = g.fijaId != null ? M.asig[g.fijaId] : null;
      // 3. franjas válidas para el día y el departamento, sin cruzar un hueco
      const malas = g.sessions.filter((se) => !sesionOk(se.d, se.s, se.len, dep));
      if (malas.length) add('franja', 'hard', [g.id], malas.flatMap(cellsOfSes));
      for (const pid of g.profs) {
        const p = P[pid]; if (!p) continue;
        const maes = [], rojas = [], amar = [];
        for (const c of cs) {
          const nv = nivel(p, Math.floor(c / 100), c % 100);
          if (nv === 'maestria') maes.push(c); else if (esRojo(nv)) rojas.push(c); else if (esAmarillo(nv)) amar.push(c);
        }
        // 7. rojo, sin respuesta y maestría; una asignación directa manda sobre la disponibilidad, nunca sobre la maestría
        if (maes.length) add('maestria', 'hard', [g.id], maes, { p: pid });
        if (rojas.length) {
          if (!a || a.pid !== pid) add('rojo', 'hard', [g.id], rojas, { p: pid, sin: rojas.filter((c) => !p.disp[Math.floor(c / 100)][c % 100]).length });
          else if (!a.conHorario) add('asig_rojo', 'soft', [g.id], rojas, { p: pid });
        }
        if (amar.length) add('amarillo', 'soft', [g.id], amar, { p: pid });
        for (const it of g.items) {
          if (p.bloq.has(it.mid)) add('bloqueo', 'hard', [g.id], [], { p: pid, clave: it.clave });
          const nm = p.mats[String(it.mid)];
          if (nm !== 'verde' && !p.bloq.has(it.mid)) add('mat', 'soft', [g.id], [], { p: pid, clave: it.clave, nivel: nm || null });
        }
        if (p.pref && p.pref.estado === 'borrador') add('borrador', 'soft', [g.id], [], { p: pid });
      }
      if (!g.profs.length) add('sinprof', 'soft', [g.id], [...cs]);
      // 5. y 6. salón
      if (ROOMS.length && g.sessions.some((se) => roomOf(g, se) == null)) add('sinsalon', 'soft', [g.id], [...cs]);
      const rids = new Set(g.sessions.map((se) => roomOf(g, se)).filter((r) => r != null && R[r]));
      for (const se of g.sessions) {
        const r = R[roomOf(g, se)]; if (!r) continue;
        const fuera = cellsOfSes(se).filter((c) => !(((r.disp[String(dep)] || {})[M.dias[se.d]] || []).includes(M.F[c % 100].inicio)));
        if (fuera.length) add('salon_auth', 'hard', [g.id], fuera, { r: r.id });
      }
      const tipos = new Set(g.items.map((i) => (M.mats[i.mid] || {}).tipo).filter(Boolean));
      for (const rid of rids) {
        if (tipos.size && !(tipos.size === 1 && tipos.has(R[rid].tipo))) add('salon_tipo', 'hard', [g.id], [], { r: rid, tipos: [...tipos].join(', ') });
        if (g.cupo != null && R[rid].cap < g.cupo) add('salon_cap', 'hard', [g.id], [], { r: rid });
      }
      if (g.sessions.length) {
        const est = estimado(g);
        let ofr = g.cupo != null ? g.cupo : est;
        if (rids.size) ofr = Math.min(ofr, ...[...rids].map((r) => R[r].cap));
        if (est > ofr) add('cupo', 'soft', [g.id], [], { est, ofr });
        const bl = bloquesDe(g);
        for (const it of g.items) { const m = M.mats[it.mid]; if (m && m.cr * bpc !== bl) add('creditos', 'soft', [g.id], [], { clave: it.clave, cr: m.cr, bl }); }
      }
      // 9. asignación directa: su materia, su profesor y, si los fijó, sus horarios
      if (a) {
        const por = [];
        if (!g.profs.includes(a.pid)) por.push('no lo da ' + pName(a.pid));
        if (!g.items.some((i) => i.mid === a.mid)) por.push('no trae ' + ((M.mats[a.mid] || {}).clave || a.mid));
        if (a.conHorario && (a.cells.size !== cs.size || [...a.cells].some((c) => !cs.has(c)))) por.push('no está en ' + (cellsTxt([...a.cells]) || 'el horario fijado'));
        if (por.length) add('fija', 'hard', [g.id], [...a.cells], { fija: a.id, por });
      }
    }
    // 9. cada asignación directa en algún grupo
    const cumplidas = new Set(gs.map((g) => g.fijaId).filter((x) => x != null));
    for (const a of Object.values(M.asig)) if (!cumplidas.has(a.id)) add('fija_sin', 'hard', [], [...a.cells], { fija: a.id, p: a.pid, mid: a.mid });
    // Por profesor: 8. tope de asignatura (contando ocupado), número de cursos, medias horas sueltas
    const max = M.reglas.max_horas_asignatura ?? 10;
    for (const p of Object.values(P)) {
      const mios = gs.filter((g) => g.profs.includes(p.id));
      if (!mios.length) continue;
      const c = carga(p.id, gs), ids = mios.filter((g) => !g.locked).map((g) => g.id);
      if (!ids.length) continue;
      if (p.contrato === 'asignatura' && c.bl / 2 > max) add('tope', 'hard', ids, [], { p: p.id, h: c.bl / 2, max });
      const libres = mios.filter((g) => !g.locked).length;
      if (c.max != null && libres > c.max) add('cursos', 'soft', ids, [], { p: p.id, n: libres, max: c.max });
      for (let d = 0; d < ND(); d++) {
        const occ = new Set();
        for (const g of mios) for (const se of g.sessions) if (se.d === d) for (let k = 0; k < se.len; k++) occ.add(se.s + k);
        for (const o of p.ocup) if (o.d === d) for (let k = 0; k < o.len; k++) occ.add(o.s + k);
        const huecos = [];
        for (const s of occ) if (!occ.has(s + 1) && occ.has(s + 2) && contiguo(s) && contiguo(s + 1)) huecos.push(d * 100 + s + 1);
        if (huecos.length) add('media', 'soft', mios.filter((g) => !g.locked && g.sessions.some((se) => se.d === d)).map((g) => g.id), huecos, { p: p.id, d });
      }
    }
    // Choques de semestre (§3.4): un par de la misma cohorte se rompe si todas sus combinaciones de grupos chocan
    const deMat = new Map();
    for (const g of gs) if (g.sessions.length) for (const it of g.items) { if (!deMat.has(it.mid)) deMat.set(it.mid, []); deMat.get(it.mid).push(g); }
    for (const pr of M.pares) {
      const ga = deMat.get(pr.a), gb = deMat.get(pr.b);
      if (!ga || !gb || ga.some((g) => gb.includes(g))) continue;
      if (ga.every((x) => x.locked) && gb.every((x) => x.locked)) continue;
      let cells = null, todas = true;
      for (const x of ga) {
        for (const y of gb) { const ov = [...cellsOf.get(x.id)].filter((c) => cellsOf.get(y.id).has(c)); if (!ov.length) { todas = false; break; } cells ??= ov; }
        if (!todas) break;
      }
      if (todas) add('cohorte', 'soft', [...ga, ...gb].filter((g) => !g.locked).map((g) => g.id), cells || [], { a: pr.a, b: pr.b, ks: pr.ks, na: ga.length, nb: gb.length });
    }
    // Demanda, por estrella de co-oferta: más clases que las que pide es aviso; las que faltan van a «por asignar»
    const clasesDe = new Map();
    for (const g of gs) new Set(g.items.map((i) => M.principalDe[i.mid]).filter((p) => p != null)).forEach((p) => clasesDe.set(String(p), (clasesDe.get(String(p)) || 0) + 1));
    const faltan = [];
    for (const [p, e] of Object.entries(M.estrellas)) {
      const n = clasesDe.get(p) || 0;
      const claves = e.mids.map((x) => M.mats[x].clave).join(' + ');
      if (n > e.n) add('demanda', 'soft', gs.filter((g) => !g.locked && g.items.some((i) => e.mids.includes(i.mid))).map((g) => g.id), [], { clave: claves, n, sug: e.n });
      else if (n < e.n) faltan.push({ mid: +p, mids: e.mids, pide: e.n, n: e.n - n, motivo: e.mids.map((x) => M.motivos[x]).find(Boolean) || null });
    }
    faltan.sort((x, y) => natural(M.mats[x.mid].clave, M.mats[y.mid].clave));
    const per = new Map();
    for (const c of list) for (const id of c.ids) {
      if (!per.has(id)) per.set(id, { hard: [], soft: [] });
      per.get(id)[c.sev].push(c);
    }
    const minc = (c) => (c.cells.length ? Math.min(...c.cells) : 1e9);
    list.sort((x, y) => (x.sev === y.sev ? 0 : x.sev === 'hard' ? -1 : 1) || ORDEN.indexOf(x.type) - ORDEN.indexOf(y.type) || minc(x) - minc(y));
    return { list, per, faltan };
  }
  const other = (c, id) => c.ids.find((x) => x !== id);
  let dragGroup = () => null;
  function cfText(c) {
    const A = byId[c.ids[0]] || dragGroup(c.ids[0]), B = c.ids[1] ? byId[c.ids[1]] || dragGroup(c.ids[1]) : null;
    const pn = c.p != null ? pName(c.p) : '';
    const where = c.cells.length ? ' · ' + cellsTxt(c.cells) : '';
    switch (c.type) {
      case 'prof': return { t: `${pn} está en dos grupos a la vez`, s: `${gFull(A)} y ${gFull(B)}${where}` };
      case 'ocupado': return { t: `${pn} ya da clase a esa hora en otro departamento`, s: `${esc(gLabel(A))} choca con ${esc(c.motivo)}${where}` };
      case 'salon': return { t: `Salón ${esc(rName(+c.r))} ocupado dos veces`, s: `${gFull(A)} de ${esc(gProf(A))} y ${gFull(B)} de ${esc(gProf(B))}${where}` };
      case 'maestria': return { t: `Encima de la materia de maestría de ${pn}`, s: `${esc(gLabel(A))}${where}` };
      case 'rojo': return { t: `Fuera de la disponibilidad de ${pn}`, s: `${esc(gLabel(A))}${where} · ${c.sin === c.cells.length ? 'no marcó esas horas' : c.sin ? 'rojo o sin marcar' : 'marcadas en rojo'}` };
      case 'bloqueo': return { t: `${pn} está bloqueado para ${esc(c.clave)}`, s: `${esc(gLabel(A))} · bloqueo de la jefatura` };
      case 'franja': return { t: `${esc(gLabel(A))} cae en una franja que no vale`, s: `${where.slice(3)} · revisa los días de la franja o si es solo de otro departamento` };
      case 'salon_auth': return { t: `Salón ${esc(rName(c.r))} no autorizado para ${esc((M.deptos[gDep(A)] || {}).nombre || 'el departamento')}`, s: `${esc(gLabel(A))}${where}` };
      case 'salon_tipo': return { t: `Salón ${esc(rName(c.r))} no es del tipo que pide la materia`, s: `${esc(gLabel(A))} pide ${esc(c.tipos)}` };
      case 'salon_cap': return { t: `Salón ${esc(rName(c.r))} tiene menos lugares que el cupo`, s: `${esc(gLabel(A))}: cupo ${A.cupo}, salón de ${R[c.r].cap}` };
      case 'tope': return { t: `${pn} pasa de ${c.max} h por semana`, s: `Asignatura: ${horas(c.h * 2)} h, contando otros departamentos` };
      case 'fija': return { t: `${esc(gLabel(A))} ya no cumple la asignación directa`, s: `Asignación ${c.fija}: ${esc(c.por.join('; '))}. Si la jefatura la cambió, hay que cambiarla también en Asignaciones directas.` };
      case 'fija_sin': return { t: `Ningún grupo cumple la asignación directa de ${pn}`, s: `${esc((M.mats[c.mid] || {}).clave || c.mid)}${where ? where : ', sin horario fijado'} · revisa Asignaciones directas o vuelve a correr el motor` };
      case 'cohorte': {
        const ca = M.mats[c.a].clave, cb = M.mats[c.b].clave;
        return { t: `${esc(ca)} y ${esc(cb)} chocan para ${esc(c.ks[0])}${c.ks.length > 1 ? ' y ' + (c.ks.length - 1) + ' más' : ''}`,
          s: (c.na * c.nb === 1 ? 'Un grupo cada una, a la misma hora' : `Sus ${c.na}×${c.nb} combinaciones de grupos chocan`) + `: ningún alumno de esa cohorte puede llevar las dos${where}` };
      }
      case 'asig_rojo': return { t: `Asignación directa en horas que ${pn} no marcó`, s: `${esc(gLabel(A))}${where} · la jefatura manda (D48)` };
      case 'amarillo': return { t: `${pn} marcó amarillo esas horas`, s: `${esc(gLabel(A))}${where}` };
      case 'mat': return { t: c.nivel ? `${pn} marcó ${esc(c.clave)} en ${c.nivel}` : `${pn} no marcó ${esc(c.clave)}`, s: `${esc(gLabel(A))} · ${esc(gName(A))}` };
      case 'borrador': return { t: `${pn} no envió su formulario`, s: `Se usó lo que guardó en borrador · ${esc(gLabel(A))}` };
      case 'cursos': return { t: `${pn} tiene ${c.n} cursos y ${P[c.p].pref && P[c.p].pref.num_cursos_origen === 'jefatura' ? 'la jefatura le fijó' : 'pidió'} ${c.max}`, s: 'Más cursos que los que pidió' };
      case 'creditos': return { t: `${esc(c.clave)}: ${c.cr} créditos en ${c.bl} bloques`, s: `${esc(gLabel(A))} · ${horas(c.bl)} h por semana` };
      case 'cupo': return { t: `${esc(gLabel(A))}: menos lugares que la demanda`, s: `Se esperan ${c.est}, caben ${c.ofr}` };
      case 'demanda': return { t: `${esc(c.clave)}: ${c.n} clases y la demanda pide ${c.sug}`, s: 'Con co-oferta: demanda ajustada sumada / 30 lugares; sin ella, los grupos sugeridos' };
      case 'media': return { t: `${pn}: media hora suelta el ${DN(c.d).toLowerCase()}`, s: cellsTxt(c.cells) };
      case 'sinprof': return { t: `${esc(gLabel(A))} no tiene profesor`, s: `${esc(gName(A))} · ${sesTxt(A)}` };
      case 'sinsalon': return { t: `${esc(gLabel(A))} no tiene salón`, s: `${esc(gName(A))} · ${esc(gProf(A))}` };
    }
    return { t: c.type, s: '' };
  }

  // ---------- Geometría ----------
  const gb = $m('gridbody');
  const ch = $m('colhead');
  const wrap = $m('gridwrap');
  const GUT = 58, TOP = 10;
  const geo = { row: 26, gap: 22, colW: 100, cols: [], gb: [] };
  const oneProf = () => (ui.profs.size === 1 ? +[...ui.profs][0] : null);
  const yOf = (s) => TOP + s * geo.row + geo.gb[s] * geo.gap;
  const yEnd = (s, len) => yOf(s + len - 1) + geo.row;
  const totalH = () => yEnd(NS() - 1, 1) + 6;
  function slotFromY(y) { for (let s = 0; s < NS(); s++) if (y < yOf(s) + geo.row) return s; return NS() - 1; }
  function columns() {
    if (ui.view === 'salon') {
      const cols = ROOMS.filter((r) => !ui.rooms.size || ui.rooms.has(String(r.id))).map((r) => ({ key: 'r' + r.id, roomId: r.id, title: r.name, sub: r.cap ? 'cap. ' + r.cap : '' }));
      if (!ui.rooms.size && groups.some((g) => g.sessions.some((se) => se.d === ui.day && roomOf(g, se) == null))) cols.push({ key: 'r-', roomId: null, title: 'Sin salón', sub: 'por definir', nosalon: true });
      return cols;
    }
    if (ui.view === 'prof') {
      let ids;
      if (ui.profs.size) ids = [...ui.profs].map(Number).filter((id) => P[id]);
      else ids = Object.values(P).filter((p) => {
        const c = carga(p.id);
        const da = groups.some((g) => g.profs.includes(p.id) && depOk(g)) || p.ocup.length;
        const pendiente = c.max != null && c.max > c.cursos && (!ui.deps.size || ui.deps.has(String(p.depto)));
        return da || pendiente;
      }).map((p) => p.id);
      ids.sort((a, b) => natural(P[a].short, P[b].short));
      const cols = ids.map((id) => {
        const c = carga(id), over = c.max != null && c.cursos > c.max;
        return { key: 'p' + id, profId: id, title: P[id].short, full: titleCase(P[id].nombre), over,
          sub: `${c.cursos}${c.max != null ? '/' + c.max : ''} curso${c.cursos === 1 && c.max == null ? '' : 's'} · ${horas(c.bl)} h` };
      });
      if (!ui.profs.size && groups.some((g) => !g.locked && !g.profs.length && g.sessions.some((se) => se.d === ui.day))) cols.push({ key: 'p-', profId: null, title: 'Sin profesor', sub: 'por asignar', nosalon: true });
      return cols;
    }
    return M.dias.map((d, i) => ({ key: 'd' + i, day: i, title: DN(i), sub: '' }));
  }
  function measure() {
    geo.gb = [0];
    for (let s = 1; s < NS(); s++) geo.gb[s] = geo.gb[s - 1] + (contiguo(s - 1) ? 0 : 1);
    const nGaps = geo.gb[NS() - 1];
    const h = wrap.clientHeight - 44 - TOP;
    geo.gap = 22;
    geo.row = Math.max(18, Math.min(34, Math.floor((h - nGaps * geo.gap - 8) / NS())));
    geo.cols = columns();
    const avail = wrap.clientWidth - GUT - 2;
    const min = ui.view === 'semana' ? 170 : 104;
    geo.colW = Math.max(min, Math.floor(avail / Math.max(1, geo.cols.length)));
  }

  // ---------- Capas de fondo ----------
  // Disponibilidad de un profesor: en la columna de cada día (semana) o a todo lo ancho (salón)
  function availHTML(pid, d, x, w, conOcup = true) {
    const p = P[pid]; if (!p) return '';
    let h = '';
    for (let s = 0; s < NS(); s++) {
      if (!diaOk(s, d)) continue;
      const nv = nivel(p, d, s);
      if (nv === 'verde') continue;
      h += `<div class="av av-${nv}" style="left:${x}px;width:${w}px;top:${yOf(s)}px;height:${geo.row}px"></div>`;
    }
    if (conOcup) for (const o of p.ocup) if (o.d === d) h += `<div class="oc" style="left:${x + 3}px;width:${w - 6}px;top:${yOf(o.s) + 1}px;height:${yEnd(o.s, o.len) - yOf(o.s) - 2}px"><b>Ocupado</b>${esc(o.motivo)}</div>`;
    return h;
  }
  function availLayer(pid) {
    if (ui.view === 'semana') return M.dias.map((_, d) => availHTML(pid, d, GUT + d * geo.colW + 1, geo.colW - 1)).join('');
    if (ui.view === 'salon') return availHTML(pid, ui.day, GUT, geo.cols.length * geo.colW, false);
    return '';
  }
  function freeRoomsAt(d, s, exceptId) {
    const busy = new Set();
    for (const g of groups) {
      if (g.id === exceptId) continue;
      for (const se of g.sessions) if (se.d === d && s >= se.s && s < se.s + se.len && roomOf(g, se) != null) busy.add(roomOf(g, se));
    }
    return ROOMS.filter((r) => !busy.has(r.id));
  }
  function freeRoomsFor(g) {
    const dep = gDep(g);
    return ROOMS.filter((r) => g.sessions.every((se) => cellsOfSes(se).every((c) => {
      const s = c % 100;
      return freeRoomsAt(se.d, s, g.id).includes(r) && ((r.disp[String(dep)] || {})[M.dias[se.d]] || []).includes(M.F[s].inicio);
    })));
  }
  // Profesores que pueden dar el grupo en su horario: sin bloqueo, sin rojo ni maestría, libres y sin pasar el tope.
  // Quien no marcó la materia solo cuenta si es del departamento de la materia: los demás nunca la vieron en su formulario.
  function candidatos(g) {
    const cs = g.sessions.flatMap(cellsOfSes), max = M.reglas.max_horas_asignatura ?? 10, bl = bloquesDe(g);
    const deps = new Set(g.items.map((i) => (M.mats[i.mid] || {}).depto));
    const out = [];
    for (const p of Object.values(P)) {
      if (g.items.some((i) => p.bloq.has(i.mid))) continue;
      const niv = g.items.map((i) => p.mats[String(i.mid)]).filter(Boolean);
      const nm = niv.includes('verde') ? 'verde' : niv.includes('amarillo') ? 'amarillo' : niv.includes('rojo') ? 'rojo' : null;
      if (nm === 'rojo' || (nm === null && !deps.has(p.depto))) continue;
      let ok = true, amar = 0;
      for (const c of cs) { const nv = nivel(p, Math.floor(c / 100), c % 100); if (nv === 'maestria' || esRojo(nv)) { ok = false; break; } if (esAmarillo(nv)) amar++; }
      if (!ok) continue;
      const ocupado = new Set();
      for (const x of groups) if (x.id !== g.id && x.profs.includes(p.id)) x.sessions.forEach((se) => cellsOfSes(se).forEach((c) => ocupado.add(c)));
      p.ocup.forEach((o) => cellsOfSes(o).forEach((c) => ocupado.add(c)));
      if (cs.some((c) => ocupado.has(c))) continue;
      const c = carga(p.id, groups.filter((x) => x.id !== g.id));
      if (p.contrato === 'asignatura' && (c.bl + bl) / 2 > max) continue;
      out.push({ p, nm, amar, c, cur: g.profs.includes(p.id) });
    }
    const rk = (x) => (x.nm === 'verde' ? 0 : x.nm === 'amarillo' ? 1 : 2) * 1000 + (x.c.max != null && x.c.cursos >= x.c.max ? 500 : 0) + x.amar;
    return out.sort((a, b) => rk(a) - rk(b) || natural(a.p.short, b.p.short));
  }

  // ---------- Filtros ----------
  const depOk = (g) => !ui.deps.size || g.items.some((i) => ui.deps.has(String((M.mats[i.mid] || {}).depto)));
  const cohMats = () => { const s = new Set(); for (const k of ui.cohs) { const c = M.cohortes.find((x) => x.key === k); if (c) c.mids.forEach((m) => s.add(m)); } return s; };
  const matches = (g) => {
    if (!depOk(g)) return false;
    if (ui.profs.size && !g.profs.some((p) => ui.profs.has(String(p)))) return false;
    if (ui.rooms.size && !g.sessions.some((se) => ui.rooms.has(String(roomOf(g, se))))) return false;
    if (ui.mats.size && !g.items.some((i) => ui.mats.has(String(i.mid)))) return false;
    if (ui.cohs.size) { const cm = cohMats(); if (!g.items.some((i) => cm.has(i.mid))) return false; }
    return true;
  };
  const filtering = () => !!(ui.deps.size || ui.profs.size || ui.rooms.size || ui.mats.size || ui.cohs.size);

  // ---------- Layout de carriles ----------
  function lanes(items) {
    items.sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster = [], cEnd = -1, ends = [];
    const flush = () => { const n = ends.length; cluster.forEach((it) => (it.nl = n)); cluster = []; ends = []; cEnd = -1; };
    for (const it of items) {
      if (cluster.length && it.start >= cEnd) flush();
      let l = ends.findIndex((e) => e <= it.start);
      if (l < 0) { l = ends.length; ends.push(it.end); } else ends[l] = it.end;
      it.lane = l; cluster.push(it); cEnd = Math.max(cEnd, it.end);
    }
    flush();
  }

  // ---------- Render ----------
  let AN = { list: [], per: new Map(), faltan: [] };
  const stOf = (id) => AN.per.get(id) || { hard: [], soft: [] };
  function render() {
    reindex();
    AN = analyze(groups);
    renderHeader();
    renderToolbar();
    renderSide();
    renderGrid();
    if (cardId) drawCard();
    syncFilters();
  }

  function renderHeader() {
    const deps = M.alcance.map((id) => M.deptos[id]).filter(Boolean);
    $m('ttl').textContent = 'Malla horaria · ' + (deps.length === 1 ? 'Departamento de ' + deps[0].nombre : 'DACE (' + deps.map((d) => d.nombre).join(', ') + ')');
    const sched = groups.filter((g) => g.sessions.length);
    const hard = AN.list.filter((c) => c.sev === 'hard').length, soft = AN.list.length - hard;
    const pend = groups.filter((g) => !g.sessions.length).length + AN.faltan.reduce((n, f) => n + f.n, 0);
    const items = sched.reduce((n, g) => n + g.items.length, 0), fijos = groups.filter((g) => g.locked).length;
    $m('semLbl').textContent = `${M.ent.semestre.etiqueta} · ${items} grupos (${sched.length} clases en la malla, con los grupos espejo juntos)`;
    $m('stats').innerHTML =
      `<div class="stat"><b>${sched.length}</b> en la malla</div>` +
      `<div class="stat ${hard ? 'bad' : 'ok'}"><b>${hard}</b> choques</div>` +
      `<div class="stat ${soft ? 'warn' : 'ok'}"><b>${soft}</b> avisos</div>` +
      `<div class="stat ${pend ? 'warn' : 'ok'}"><b>${pend}</b> por asignar</div>` +
      (fijos ? `<div class="stat" title="Grupos publicados: no se mueven"><b>${fijos}</b> publicados</div>` : '');
  }

  function renderAcciones() {
    let h = '';
    if (opciones.alcances) {
      h += `<label class="alcance">Departamento <select data-m="alcance">${opciones.alcances.map((a) => `<option value="${esc(a.valor)}" ${a.valor === opciones.alcance ? 'selected' : ''}>${esc(a.etiqueta)}</option>`).join('')}</select></label>`;
    }
    if (opciones.onVolver) h += `<button class="btn" data-m="volver">← Inicio</button>`;
    $m('acciones').innerHTML = h;
    const sel = $m('alcance'); if (sel) sel.onchange = (e) => opciones.onAlcance && opciones.onAlcance(e.target.value);
    const v = $m('volver'); if (v) v.onclick = opciones.onVolver;
  }

  function renderToolbar() {
    $m('viewSeg').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === ui.view);
      if (b.dataset.v === 'salon') { b.disabled = !ROOMS.length; b.title = ROOMS.length ? '' : 'Todavía no hay salones del semestre (modo sin salones)'; }
    });
    const dp = $m('dayPills');
    dp.style.display = ui.view === 'semana' ? 'none' : '';
    const perDay = M.dias.map(() => 0);
    for (const c of AN.list) if (c.sev === 'hard') new Set(c.cells.map((x) => Math.floor(x / 100))).forEach((d) => perDay[d]++);
    dp.innerHTML = M.dias.map((d, i) => `<button data-d="${i}" class="${i === ui.day ? 'on' : ''}">${DN(i)}${perDay[i] ? `<span class="badge">${perDay[i]}</span>` : ''}</button>`).join('');
    const clic = 'Clic en un grupo para ver con qué choca, quién más puede darlo y la disponibilidad de su profesor.';
    $m('hint').textContent = {
      salon: (ED ? 'Arrastra un grupo a otro salón u otra hora. ' : '') + clic,
      prof: 'Cada columna es un profesor, con su disponibilidad de fondo (rojo = no puede, amarillo = la evita). ' + (ED ? 'Arrastra un grupo a otra columna para cambiarle el profesor. ' : '') + clic,
      semana: (ED ? 'Arrastra un grupo para cambiarlo de día u hora. ' : '') + 'Filtra por «Plan y semestre» para ver la semana de una cohorte, o por un profesor para ver su disponibilidad de fondo.',
    }[ui.view];
    let b = '';
    const c = M.corrida;
    if (!groups.some((g) => !g.locked) && !c) b += `<div class="banner warn">Todavía no hay grupos de este semestre: falta correr el motor y subir su resultado en «Datos para el motor». Mientras, aquí solo se ven los publicados y la demanda por asignar.</div>`;
    else if (!ROOMS.length) b += `<div class="banner info"><b>Modo sin salones.</b> El motor asignó profesor y horario, pero no salones: los grupos quedan «en asignación» hasta cargar los salones del semestre y volver a correrlo.</div>`;
    if (c && c.desfasada) b += `<div class="banner warn">La última corrida se aplicó aunque algo había cambiado desde la descarga. La revisión de abajo ya es contra los datos de hoy.</div>`;
    if (M.avisosCarga.length) b += `<div class="banner bad">Al cargar: ${esc([...new Set(M.avisosCarga)].slice(0, 4).join('; '))}${M.avisosCarga.length > 4 ? '…' : ''}</div>`;
    $m('banners').innerHTML = b;
  }

  function renderGrid() {
    measure();
    const cols = geo.cols, W = GUT + cols.length * geo.colW, H = totalH();
    ch.innerHTML = `<div class="sp"></div>` + cols.map((c) => `<div class="ch ${c.nosalon ? 'nosalon' : ''} ${c.over ? 'over' : ''}" style="width:${geo.colW}px" title="${esc(c.full || c.title)}"><b>${esc(c.title)}</b><small>${esc(c.sub) || '&nbsp;'}</small></div>`).join('');
    ch.style.width = W + 'px';
    gb.style.width = W + 'px';
    gb.style.height = H + 'px';
    const single = ui.view !== 'semana';
    let gut = '', h = '';
    for (let s = 0; s < NS(); s++) {
      const f = M.F[s], hour = f.inicio.endsWith(':00');
      const off = single && !diaOk(s, ui.day);
      h += `<div class="row ${hour ? 'hour' : ''} ${off ? 'blocked' : ''} ${f.depto != null ? 'dep' : ''}" style="top:${yOf(s)}px;height:${geo.row}px"></div>`;
      gut += `<div class="tl ${hour ? 'hour' : ''} ${f.depto != null ? 'dep' : ''}" style="top:${yOf(s)}px">${lbl(s)}</div>`;
      if (f.depto != null && (s === 0 || M.F[s - 1].depto !== f.depto)) {
        let e = s; while (e + 1 < NS() && M.F[e + 1].depto === f.depto) e++;
        h += `<div class="deplbl" style="top:${yOf(s)}px">${range(s, e - s + 1)} · solo ${esc((M.deptos[f.depto] || {}).nombre || f.depto)}</div>`;
      }
      if (s + 1 < NS() && !contiguo(s)) h += `<div class="gapband" style="top:${yEnd(s, 1)}px;height:${geo.gap}px;left:${GUT}px">${hm(f.fin)} – ${lbl(s + 1)} · sin clases</div>`;
      if (!single) M.dias.forEach((_, d) => { if (!diaOk(s, d)) h += `<div class="off" style="left:${GUT + d * geo.colW}px;width:${geo.colW}px;top:${yOf(s)}px;height:${geo.row}px"></div>`; });
    }
    cols.forEach((c, i) => { h += `<div class="vline" style="left:${GUT + i * geo.colW}px"></div>`; });
    // disponibilidad de fondo: cada profesor en su columna, o el profesor filtrado en la semana
    if (ui.view === 'prof') cols.forEach((c, i) => { if (c.profId != null) h += availHTML(c.profId, ui.day, GUT + i * geo.colW + 1, geo.colW - 1); });
    else if (ui.view === 'semana' && oneProf() != null) h += availLayer(oneProf());
    h += '<div data-m="ov"></div>';
    // bloques
    const vis = [];
    for (const g of groups) for (let si = 0; si < g.sessions.length; si++) {
      const se = g.sessions[si];
      let cs = [];
      if (ui.view === 'salon') { if (se.d === ui.day) cs = [cols.findIndex((c) => c.roomId === (roomOf(g, se) ?? null))]; }
      else if (ui.view === 'prof') { if (se.d === ui.day) cs = g.profs.length ? g.profs.map((p) => cols.findIndex((c) => c.profId === p)) : g.locked ? [] : [cols.findIndex((c) => c.profId === null)]; }
      else if (!filtering() || matches(g)) cs = [se.d];
      for (const col of cs) if (col >= 0) vis.push({ g, si, col, start: se.s, end: se.s + se.len });
    }
    const byCol = {};
    vis.forEach((v) => (byCol[v.col] ??= []).push(v));
    Object.values(byCol).forEach(lanes);
    for (const v of vis) {
      const g = v.g, st = stOf(g.id);
      const inner = geo.colW - 6, base = GUT + v.col * geo.colW + 3;
      let w = inner, x = base, strip = 0;
      if (v.nl > 1) {
        // cascada: tarjetas de ancho legible, encimadas y semitransparentes
        w = ui.view === 'semana' ? Math.max(110, Math.min(Math.max(130, inner * 0.55), inner - (v.nl - 1) * 20)) : Math.min(inner, Math.max(70, inner * 0.55));
        w = Math.min(w, inner);
        const step = (inner - w) / (v.nl - 1);
        x = base + v.lane * step;
        const cover = vis.reduce((m, o) => (o.col === v.col && o.lane > v.lane && o.start < v.end && o.end > v.start ? Math.min(m, o.lane - v.lane) : m), Infinity);
        if (cover !== Infinity) strip = cover * step;
      }
      const y = yOf(v.start) + 1, hh = yEnd(v.start, v.end - v.start) - yOf(v.start) - 2;
      const hu = hue(g);
      const cls = ['blk'];
      if (st.hard.length) cls.push('hard'); else if (st.soft.length) cls.push('soft');
      if (g.locked) cls.push('lock');
      if (!ED) cls.push('ro');
      if (w < 64) cls.push('tiny');
      if (v.nl > 1) cls.push('stack');
      if (strip && strip < 64) cls.push(strip >= 15 ? 'strip' : 'strip mute');
      if (ui.view !== 'semana' && filtering() && !matches(g)) cls.push('dim');
      if (ui.sel === g.id) cls.push('sel');
      const flag = st.hard.length || st.soft.length ? `<div class="flag">!</div>` : '';
      const short = pref(g.items[0].clave, '----');
      const code = (g.fijaId != null ? '<span class="af" title="Asignación directa de la jefatura">◆</span>' : '') + (g.locked ? '🔒 ' : '') +
        esc(w < 64 ? short.slice(4) || short : g.items.map((i) => i.clave.slice(4)).join('+') + (g.items[0].numero ? ' · ' + g.items[0].numero : ''));
      const third = ui.view === 'salon' ? gProf(g) : ui.view === 'prof' ? (ROOMS.length ? rName(roomOf(g, g.sessions[v.si])) : (M.deptos[gDep(g)] || {}).clave_prefijo || '') : gProf(g) + (ROOMS.length ? ' · ' + rName(roomOf(g, g.sessions[v.si])) : '');
      h += `<div class="${cls.join(' ')}" data-g="${esc(g.id)}" data-si="${v.si}" style="left:${x}px;top:${y}px;width:${w - 2}px;height:${hh}px;--z:${5 + v.lane};--in:${strip ? Math.max(0, strip - 12) + 'px' : 'auto'};--bg-c:hsl(${hu} 70% 95%);--bgt-c:hsl(${hu} 70% 92% / .62);--bd-c:hsl(${hu} 45% 82%);--st-c:hsl(${hu} 55% 48%)">
        ${flag}<div class="vc">${esc(g.items[0].clave.slice(4))}</div><div class="in"><div class="c">${code}</div><div class="n">${esc(gName(g))}</div><div class="p ${g.profs.length || g.locked ? '' : 'none'}">${esc(third)}</div></div></div>`;
    }
    h += '<div data-m="pv"></div>';
    gb.innerHTML = `<div class="gut" style="height:${H}px">${gut}</div>` + h;
  }

  function renderSide() {
    const side = $m('side');
    side.classList.toggle('collapsed', !ui.side);
    const tgl = `<button class="side-toggle" data-m="sideTgl" title="${ui.side ? 'Ocultar panel' : 'Mostrar panel'}">${ui.side ? '«' : '»'}</button>`;
    const hard = AN.list.filter((c) => c.sev === 'hard'), soft = AN.list.filter((c) => c.sev === 'soft');
    const pend = groups.filter((g) => !g.sessions.length), nf = AN.faltan.reduce((n, f) => n + f.n, 0);
    if (!ui.side) {
      side.innerHTML = tgl + `<div class="vside" data-m="vside"><span class="r">${hard.length} choques</span><span class="a">${soft.length} avisos</span><span>${pend.length + nf} por asignar</span></div>`;
      $m('sideTgl').onclick = $m('vside').onclick = () => toggleSide(true);
      return;
    }
    if (ui.sel && byId[ui.sel]) { side.innerHTML = tgl + detailHTML(byId[ui.sel]); bindDetail(); bindTgl(); return; }
    let h = '';
    if (oneProf() != null && P[oneProf()]) h += profCard(oneProf());
    else h += runCard();
    h += `<h3>Choques <span class="n">${hard.length}</span></h3>`;
    h += hard.length ? groupedHTML(hard, 'hard') : `<div class="empty">✓ Nada que la subida rechazaría</div>`;
    h += `<h3>Avisos <span class="n">${soft.length}</span></h3>`;
    h += soft.length ? groupedHTML(soft, 'soft') : `<div class="empty">✓ Sin avisos</div>`;
    h += `<h3>Por asignar <span class="n">${pend.length + nf}</span></h3>`;
    if (pend.length) h += `<div class="tray">${pend.map((g) => `<div class="tcard" data-g="${esc(g.id)}"><b>${esc(gLabel(g))}</b>${g.fijaId != null ? ' <span class="af">◆</span>' : ''}<div>${esc(gName(g))}</div><div class="s">${esc(gProf(g))}${ROOMS.length ? ' · ' + esc(rName(g.roomId)) : ''}</div></div>`).join('')}</div>`;
    if (AN.faltan.length) h += `<div class="tray" style="margin-top:6px">${AN.faltan.map((f) => { const m = M.mats[f.mid]; return `<div class="dem"><b>${esc(f.mids.map((x) => M.mats[x].clave).join(' + '))}</b> · ${esc(m.nombre)}<div class="s">Falta${f.n > 1 ? 'n' : ''} ${plural(f.n, 'clase')} de ${f.pide} que pide la demanda${f.motivo ? '. El motor: «' + esc(f.motivo) + '»' : ''}</div></div>`; }).join('')}</div>`;
    if (!pend.length && !AN.faltan.length) h += `<div class="empty">✓ Toda la demanda tiene grupo y horario</div>`;
    h += `<h3>Leyenda</h3><div class="legend">
      <div><i style="background:#fff;border:2px solid var(--red)"></i>Choque: la subida del motor lo rechazaría (mismo profesor o salón a la vez, rojo, bloqueo, tope…)</div>
      <div><i style="background:#fff;border:2px solid var(--amber)"></i>Aviso: se acepta, pero conviene revisarlo</div>
      <div><i style="background:hsl(210 70% 95%);border-left:4px solid hsl(210 55% 48%)"></i>Grupo (el color identifica la materia)</div>
      <div><i style="color:var(--violet)">◆</i>Asignación directa de la jefatura</div>
      <div><i style="background:repeating-linear-gradient(135deg,#ccd 0 3px,#fff 3px 6px);border:1px dashed #99a">🔒</i>Publicado: no se mueve</div>
      <div><i class="av-rojo"></i>El profesor no puede (rojo)</div>
      <div><i class="av-sin"></i>El profesor no marcó esa hora (cuenta como ${esc(sinComo())})</div>
      <div><i class="av-amarillo"></i>El profesor la evita (amarillo)</div>
      <div><i class="av-maestria"></i>Su materia de maestría</div>
      <div><i style="background:repeating-linear-gradient(135deg,#eef0f3 0 4px,#f7f8fa 4px 8px)"></i>Franja sin clases ese día</div></div>`;
    side.innerHTML = tgl + h;
    bindTgl();
    side.querySelectorAll('.cf').forEach((el) => (el.onclick = () => goTo(AN.list[+el.dataset.i])));
    side.querySelectorAll('.tg, .tcard').forEach((el) => (el.onclick = () => { ui.sel = el.dataset.g; render(); }));
    side.querySelectorAll('details.grp').forEach((d) => (d.ontoggle = () => { ui.showAll[d.dataset.k] = d.open; }));
    const cp = $m('clearProf'); if (cp) cp.onclick = () => { ui.profs.clear(); render(); };
  }
  // Una lista por tipo; los tipos con pocos elementos van abiertos
  function groupedHTML(list, sev) {
    const by = new Map();
    for (const c of list) { if (!by.has(c.type)) by.set(c.type, []); by.get(c.type).push(c); }
    return [...by].map(([t, cs]) => {
      const k = sev + t, open = ui.showAll[k] ?? (sev === 'hard' || cs.length <= 3);
      return `<details class="grp ${sev}" data-k="${k}" ${open ? 'open' : ''}><summary><span class="dot"></span>${esc(TIPOS[t])}<span class="n">${cs.length}</span></summary><div>${cs.map(cfItem).join('')}</div></details>`;
    }).join('');
  }
  function runCard() {
    const c = M.corrida;
    if (!c) return `<div class="run"><b>Sin corrida del motor</b><br>Todavía no se ha subido un resultado que toque ${M.alcance.length === 1 ? 'este departamento' : 'estos departamentos'}.</div>`;
    const m = c.metricas || {}, mo = c.motor || {};
    const deps = c.departamentos.map((id) => (M.deptos[id] || {}).clave_prefijo || id).join(', ');
    const sinA = (c.sin_asignar || []).reduce((n, x) => n + x.grupos_faltantes, 0);
    const k = [['Grupos creados', c.grupos_creados], ['Sin asignar', sinA], ['Cohortes rotas', m.V ?? '—']];
    return `<div class="run"><b>${esc(mo.nombre || 'motor')}</b> ${esc(mo.version || '')}<br>Subida el ${esc(c.subido_at ? new Date(c.subido_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—')} por ${esc(titleCase(c.subido_por || ''))} · alcance ${esc(deps)}
      <div class="k">${k.map(([a, b]) => `<div><b>${esc(b)}</b>${a}</div>`).join('')}</div>
      <div class="hint" style="margin:4px 0 0">Los choques y avisos de abajo se calculan con los datos de hoy, no los de la corrida.</div></div>`;
  }
  function bindTgl() { $m('sideTgl').onclick = () => toggleSide(false); }
  function toggleSide(open) { ui.side = open; renderSide(); }
  function profCard(pid) {
    const p = P[pid], c = carga(pid);
    const mine = groups.filter((g) => g.profs.includes(pid) && g.sessions.length).sort((a, b) => a.sessions[0].d - b.sessions[0].d || a.sessions[0].s - b.sessions[0].s);
    let verdes = 0; p.disp.forEach((row, d) => row.forEach((v, s) => { if (v === 'verde' && !p.maes.has(d * 100 + s) && diaOk(s, d)) verdes++; }));
    const pend = groups.filter((g) => g.profs.includes(pid) && !g.sessions.length);
    const pr = p.pref, est = !pr ? 'no abrió el formulario' : pr.estado === 'enviado' ? 'envió su formulario' : pr.estado === 'borrador' ? 'lo dejó en borrador' : 'no lo inició';
    const over = c.max != null && c.cursos > c.max, falta = c.max != null && c.cursos < c.max;
    const max = M.reglas.max_horas_asignatura ?? 10, topeMal = p.contrato === 'asignatura' && c.bl / 2 > max;
    return `<div class="tcardp"><h2>${esc(p.short)}</h2><div class="sub">${esc(titleCase(p.nombre))} · ${esc((M.deptos[p.depto] || {}).nombre || '')} · ${esc((p.contrato || 'sin contrato').replace('_', ' '))} · ${est}</div>
      <div class="sb"><div class="${over ? 'warn' : ''}"><b>${c.cursos}${c.max != null ? ' de ' + c.max : ''}</b>cursos${c.max != null ? (pr && pr.num_cursos_origen === 'jefatura' ? ' (lo fijó la jefatura)' : ' pedidos') : ''}${falta ? ' · le faltan ' + (c.max - c.cursos) : ''}</div>
      <div class="${topeMal ? 'bad' : ''}"><b>${horas(c.bl)} h</b>de clase por semana${p.contrato === 'asignatura' ? ' (tope ' + max + ')' : ''}</div>
      <div><b>${p.respondio ? horas(verdes) + ' h' : '—'}</b>${p.respondio ? 'en verde por semana' : 'sin disponibilidad capturada'}</div><div><b>${pend.length}</b>sin horario</div></div>
      ${p.ocup.length ? `<div class="hint">Ocupado en otro departamento: ${p.ocup.map((o) => esc(DC(o.d) + ' ' + range(o.s, o.len) + ' (' + o.motivo + ')')).join(' · ')}</div>` : ''}
      ${p.maes.size ? `<div class="hint">Materia de maestría: ${cellsTxt([...p.maes])}</div>` : ''}
      ${mine.map((g) => { const hu = hue(g), st = stOf(g.id); return `<div class="tg ${st.hard.length ? 'hard' : ''}" data-g="${esc(g.id)}" style="--bg-c:hsl(${hu} 70% 95%);--st-c:hsl(${hu} 55% 48%)"><div><b>${g.fijaId != null ? '◆ ' : ''}${g.locked ? '🔒 ' : ''}${esc(gLabel(g))}</b><div style="color:var(--ink2);font-size:11.5px">${esc(gName(g))}${ROOMS.length ? ' · ' + esc(rName(g.roomId)) : ''}</div></div><div class="s">${sesTxt(g).replace(' · ', '<br>')}</div></div>`; }).join('')}
      ${pend.map((g) => `<div class="tcard mini" data-g="${esc(g.id)}"><b>${esc(gLabel(g))}</b> · sin horario<div>${esc(gName(g))}</div></div>`).join('')}
      <button class="btn wide" data-m="clearProf">Ver todos los profesores</button></div>`;
  }
  function cfItem(c) {
    const t = cfText(c);
    return `<div class="cf ${c.sev}" data-i="${AN.list.indexOf(c)}"><span class="dot"></span><div><div class="t">${t.t}</div><div class="s">${t.s}</div></div></div>`;
  }
  const blocksOf = (id) => gb.querySelectorAll(`.blk[data-g="${CSS.escape(id)}"]`);
  function flash(ids) {
    ids.forEach((id) => blocksOf(id).forEach((el) => { el.classList.add('flash'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }));
  }
  function goTo(c) {
    const ids = c.ids.filter((id) => byId[id]);
    ui.sel = ids[0] || null;
    if (ui.view !== 'semana' && c.cells.length) ui.day = Math.floor(Math.min(...c.cells) / 100);
    else if (ui.view !== 'semana' && ui.sel && byId[ui.sel].sessions.length) ui.day = byId[ui.sel].sessions[0].d;
    render();
    flash(ids.slice(0, 6));
    ids.slice(1).forEach((id) => blocksOf(id).forEach((el) => el.classList.add('partner')));
  }

  function detailHTML(g) {
    const st = stOf(g.id), dep = gDep(g), m = mat(g);
    const a = g.fijaId != null ? M.asig[g.fijaId] : null;
    const head = `<button class="det-back" data-m="back">← Resumen de la malla</button>
      <div class="codes">${g.items.map((i) => `<span>${esc(i.clave)}${i.numero ? ' · ' + esc(i.numero) : ''}</span>`).join('')}</div>
      <h2>${esc(gName(g))}</h2>
      <div class="sub">${g.items.length > 1 ? 'Grupo espejo: ' + esc(gNames(g)) + ' · ' : ''}${m.cr ?? '–'} créditos · ${esc((M.deptos[dep] || {}).nombre || '')}${g.cupo != null ? ' · cupo ' + g.cupo : ''}</div>
      ${g.locked ? `<div class="tag lock">🔒 Publicado: ya no lo mueve el motor ni esta vista</div>` : ''}
      ${a ? `<div class="tag af">◆ Asignación directa de la jefatura: ${esc(pName(a.pid))}${a.conHorario ? ', con horario fijado' : ', el horario lo eligió el motor'}</div>` : ''}`;
    const sched = `<div class="field"><label>Horario</label><div class="sched">${g.sessions.length ? g.sessions.map((s) => `<div><span>${DN(s.d)}</span><b>${range(s.s, s.len)}</b></div>`).join('') : '<div><span>Sin horario</span></div>'}</div></div>`;
    if (g.locked) return `<div class="det">${head}<div class="field"><label>Profesor</label><div>${esc(gProfFull(g))}</div></div>${ROOMS.length ? `<div class="field"><label>Salón</label><div>${esc(rName(g.roomId))}</div></div>` : ''}${sched}</div>`;
    const pid = g.profs[0];
    const t = pid != null && P[pid];
    const load = t ? carga(pid) : null;
    let mini = '';
    if (t) {
      const own = new Set(g.sessions.flatMap(cellsOfSes)), otros = new Set();
      groups.forEach((x) => { if (x.id !== g.id && x.profs.includes(pid)) x.sessions.forEach((se) => cellsOfSes(se).forEach((c) => otros.add(c))); });
      const oc = new Set(t.ocup.flatMap(cellsOfSes));
      mini = `<div class="minigrid" style="--nd:${ND()}"><div></div>${M.dias.map((_, d) => `<div class="h">${DC(d)}</div>`).join('')}`;
      for (let s = 0; s < NS(); s++) {
        const gap = s > 0 && !contiguo(s - 1) ? ' gap' : '';
        mini += `<div class="${gap}" style="font-size:9px;line-height:7px">${M.F[s].inicio.endsWith(':00') && s % 2 === 0 ? lbl(s).replace(':00', '') : ''}</div>`;
        for (let d = 0; d < ND(); d++) {
          const c = d * 100 + s;
          const cls = !diaOk(s, d) ? 'mgx' : oc.has(c) ? 'mg-ocupado' : 'mg-' + nivel(t, d, s);
          mini += `<div class="c ${cls}${gap} ${own.has(c) ? 'on' : otros.has(c) ? 'otro' : ''}" title="${DC(d)} ${lbl(s)}: ${NIVEL_TXT[oc.has(c) ? 'ocupado' : nivel(t, d, s)]}"></div>`;
        }
      }
      mini += '</div>';
    }
    // A una asignación directa no se le sugieren otros profesores: cambiarlo la rompe.
    const cl = a || !g.sessions.length ? [] : candidatos(g).filter((x) => !x.cur).slice(0, 8);
    return `<div class="det">${head}
      <div class="field"><label>Profesor</label><div>${esc(gProfFull(g))}${t ? ` · ${load.cursos}${load.max != null ? ' de ' + load.max : ''} cursos` : ''}</div></div>
      ${cl.length ? `<div class="field"><label>Pueden darlo a esta hora</label><div class="cands">${cl.map((x) => `<div class="cand"><span>${esc(x.p.short)}</span><small>${x.nm || 'no la marcó'} · ${x.c.cursos}${x.c.max != null ? '/' + x.c.max : ''} cursos${x.amar ? ' · ' + x.amar + ' amarillas' : ''}</small></div>`).join('')}</div><div class="hint" style="margin-top:4px">Sin bloqueo, sin rojo a esa hora, libres y sin pasar su tope.</div></div>` : ''}
      ${ROOMS.length ? `<div class="field"><label>Salón</label><div>${esc(rName(g.roomId))}</div></div>` : ''}
      ${t && oneProf() !== pid ? `<button class="btn wide" data-m="seeProf" style="margin-bottom:12px">Ver la semana de ${esc(t.short)}</button>` : ''}
      ${sched}
      ${st.hard.length || st.soft.length ? `<h3 style="margin-top:14px">Problemas de este grupo</h3>${[...st.hard, ...st.soft].map(cfItem).join('')}` : `<div class="empty" style="margin:10px 0">✓ Este grupo no choca con nada</div>`}
      ${t ? `<h3 style="margin-top:16px">${esc(t.short)} <span class="n">${load.cursos}${load.max != null ? '/' + load.max : ''} cursos · ${horas(load.bl)} h/sem</span></h3>
        <div class="hint">Disponibilidad${t.respondio ? '' : ' (no la capturó: todo cuenta como ' + esc(sinComo()) + ')'} · contorno negro = este grupo, gris = sus otros grupos</div>${mini}` : ''}
    </div>`;
  }
  function bindDetail() {
    const g = byId[ui.sel];
    $m('back').onclick = () => { ui.sel = null; render(); };
    $m('side').querySelectorAll('.cf').forEach((el) => (el.onclick = () => goTo(AN.list[+el.dataset.i])));
    const sp = $m('seeProf'); if (sp) sp.onclick = () => { ui.profs.clear(); ui.profs.add(String(g.profs[0])); ui.view = 'semana'; render(); };
  }

  // ---------- Hover: resaltar con qué choca ----------
  const tip = $m('tip');
  function showTip(x, y, html) {
    tip.innerHTML = html; tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let left = x + 16, top = y + 16;
    if (left + r.width > innerWidth - 8) left = x - r.width - 16;
    if (top + r.height > innerHeight - 8) top = y - r.height - 16;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.style.display = 'none'; };
  const issuesHTML = (g, st) => {
    let h = st.hard.map((c) => { const o = other(c, g.id) && (byId[other(c, g.id)] || dragGroup(other(c, g.id))); return `<div class="bad">✕ ${cfText(c).t}${o ? `<br><span class="mut">choca con ${gFull(o)} · ${esc(gProf(o))}</span>` : ''}</div>`; }).join('');
    h += st.soft.slice(0, 6).map((c) => `<div class="warn">! ${cfText(c).t}</div>`).join('');
    if (st.soft.length > 6) h += `<div class="warn">! y ${st.soft.length - 6} avisos más</div>`;
    return h;
  };
  function hoverHTML(g) {
    const st = stOf(g.id);
    let h = `<div class="h">${g.locked ? '🔒 ' : ''}${esc(gLabel(g))}</div><div>${esc(gNames(g))}</div>
      <div class="mut">${esc(gProfFull(g))}${ROOMS.length ? ' · Salón ' + esc(rName(g.roomId)) : ''}</div><div class="mut">${sesTxt(g)}</div>`;
    if (g.fijaId != null) h += `<div class="mut">◆ Asignación directa de la jefatura</div>`;
    h += issuesHTML(g, st);
    if (!st.hard.length && !st.soft.length) h += `<div class="ok">✓ Sin choques</div>`;
    return h;
  }
  escuchar(gb, 'pointerover', (e) => {
    if (drag) return;
    const el = e.target.closest('.blk'); if (!el) return;
    const g = byId[el.dataset.g];
    const partners = new Set(stOf(g.id).hard.flatMap((c) => c.ids).filter((id) => id !== g.id));
    if (partners.size) gb.querySelectorAll('.blk').forEach((b) => { if (partners.has(b.dataset.g)) b.classList.add('partner'); });
  });
  escuchar(gb, 'pointermove', (e) => {
    if (drag) return;
    const el = e.target.closest('.blk');
    if (!el) { hideTip(); return; }
    showTip(e.clientX, e.clientY, hoverHTML(byId[el.dataset.g]));
  });
  escuchar(gb, 'pointerout', (e) => {
    if (drag) return;
    const el = e.target.closest('.blk');
    if (el && !el.contains(e.relatedTarget)) { gb.querySelectorAll('.blk.partner').forEach((b) => b.classList.remove('partner')); hideTip(); }
  });
  escuchar(gb, 'pointerdown', (e) => {
    const el = e.target.closest('.blk');
    if (!el) { closeCard(); return; }
    if (e.button !== 0) return;
    startDrag(e, el.dataset.g, +el.dataset.si);
  });

  // ---------- Arrastrar y soltar ----------
  // Un clic sin moverse abre la tarjeta del grupo. Moverlo solo se puede con
  // editable (todavía no: falta guardar en la base).
  let drag = null;
  function startDrag(e, gid, si) {
    e.preventDefault();
    const g = byId[gid];
    const se = g.sessions[si];
    const rect = gb.getBoundingClientRect();
    const grab = slotFromY(e.clientY - rect.top) - se.s;
    const col = Math.floor((e.clientX - rect.left - GUT) / geo.colW);
    drag = { gid, si, grab: Math.max(0, grab), col0: col, x0: e.clientX, y0: e.clientY, active: false, prop: null, fijo: g.locked || !ED };
    addEventListener('pointermove', onDragMove);
    addEventListener('pointerup', onDragEnd, { once: true });
  }
  function proposal(e) {
    const g = byId[drag.gid], dep = gDep(g);
    const rect = gb.getBoundingClientRect();
    const x = e.clientX - rect.left - GUT, y = e.clientY - rect.top;
    const wr = wrap.getBoundingClientRect();
    if (e.clientX < wr.left || e.clientX > wr.right || e.clientY < wr.top || e.clientY > wr.bottom || x < 0 || y < 0 || y > totalH()) return null;
    const col = Math.floor(x / geo.colW);
    if (col < 0 || col >= geo.cols.length) return null;
    const C = geo.cols[col];
    const slot = slotFromY(y);
    const p = { ...g, profs: [...g.profs], sessions: g.sessions.map((s) => ({ ...s })) };
    const ref = g.sessions[drag.si];
    const s0 = snapS(ref.d, slot - drag.grab, ref.len, dep) ?? ref.s;
    const ds = s0 - ref.s;
    let dd = 0;
    if (ui.view === 'semana') {
      dd = col - ref.d;
      const min = Math.min(...g.sessions.map((x) => x.d)), max = Math.max(...g.sessions.map((x) => x.d));
      dd = Math.max(-min, Math.min(ND() - 1 - max, dd));
    }
    const out = [];
    for (const x of g.sessions) { const s = snapS(x.d + dd, x.s + ds, x.len, dep); if (s == null) return null; out.push({ ...x, d: x.d + dd, s }); }
    p.sessions = out;
    if (ui.view === 'salon') { p.roomId = C.roomId; p.sessions.forEach((s) => delete s.roomId); }
    // en la vista por profesor, cambiar de columna cambia al profesor (el de la columna de donde se tomó)
    if (ui.view === 'prof' && col !== drag.col0) {
      const from = (geo.cols[drag.col0] || {}).profId;
      const rest = g.profs.filter((q) => q !== from && q !== C.profId);
      p.profs = C.profId != null ? [C.profId, ...rest] : rest;
    }
    return p;
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (drag.fijo || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      drag.active = true;
      hideTip();
      blocksOf(drag.gid).forEach((b) => b.classList.add('dragging'));
      document.body.style.cursor = 'grabbing';
    }
    // auto-scroll cerca de los bordes
    const wr = wrap.getBoundingClientRect();
    if (e.clientY > wr.bottom - 30) wrap.scrollTop += 12; else if (e.clientY < wr.top + 50) wrap.scrollTop -= 12;
    if (e.clientX > wr.right - 30) wrap.scrollLeft += 12; else if (e.clientX < wr.left + 70) wrap.scrollLeft -= 12;

    const p = proposal(e);
    drag.prop = p;
    const pv = $m('pv'), ov = $m('ov');
    if (!p) { pv.innerHTML = ''; ov.innerHTML = ''; showTip(e.clientX, e.clientY, `<div class="mut">Suelta sobre una franja válida de la malla</div>`); return; }
    const others = groups.map((x) => (x.id === p.id ? p : x));
    dragGroup = (id) => (id === p.id ? p : null);
    const saveById = byId; byId = Object.fromEntries(others.map((x) => [x.id, x]));
    const an = analyze(others);
    const st = an.per.get(p.id) || { hard: [], soft: [] };
    const sev = st.hard.length ? 'hard' : st.soft.length ? 'soft' : '';
    // vista previa
    let h = '';
    for (const se of p.sessions) {
      let cs;
      if (ui.view === 'salon') cs = se.d === ui.day ? [geo.cols.findIndex((c) => c.roomId === (roomOf(p, se) ?? null))] : [];
      else if (ui.view === 'prof') cs = se.d === ui.day ? (p.profs.length ? p.profs : [null]).map((q) => geo.cols.findIndex((c) => c.profId === q)) : [];
      else cs = [se.d];
      for (const col of cs) if (col >= 0) h += `<div class="pv ${sev}" style="left:${GUT + col * geo.colW + 3}px;top:${yOf(se.s) + 1}px;width:${geo.colW - 6}px;height:${yEnd(se.s, se.len) - yOf(se.s) - 2}px">${esc(gLabel(p))}</div>`;
    }
    pv.innerHTML = h;
    // de fondo: la disponibilidad del profesor y dónde ya da clase
    let o = '';
    const tp = p.profs[0];
    if (tp != null && ui.view !== 'prof') {
      o += availLayer(tp);
      const W = geo.cols.length * geo.colW;
      for (const x of groups) {
        if (x.id === p.id || !x.profs.includes(tp)) continue;
        for (const se of x.sessions) {
          if (ui.view === 'salon') { if (se.d === ui.day) o += `<div class="busy" style="left:${GUT}px;width:${W}px;top:${yOf(se.s)}px;height:${yEnd(se.s, se.len) - yOf(se.s)}px">${esc(pName(tp))} ya da ${esc(gLabel(x))}</div>`; }
          else o += `<div class="busy" style="left:${GUT + se.d * geo.colW}px;width:${geo.colW}px;top:${yOf(se.s)}px;height:${yEnd(se.s, se.len) - yOf(se.s)}px"></div>`;
        }
      }
    }
    ov.innerHTML = o;
    // tooltip
    let tt = `<div class="h">${esc(gLabel(p))} → ${ui.view === 'salon' ? 'Salón ' + esc(rName(p.roomId)) : esc(p.profs.length ? p.profs.map(pName).join(' / ') : 'Sin profesor')}</div><div class="mut">${sesTxt(p)}</div>`;
    tt += issuesHTML(p, st);
    if (!sev) tt += `<div class="ok">✓ Aquí no choca con nada</div>`;
    const pt = P[tp];
    if (pt) {
      const v = p.sessions.flatMap(cellsOfSes).map((c) => nivel(pt, Math.floor(c / 100), c % 100));
      const peor = v.includes('maestria') ? 'maestria' : v.some(esRojo) ? (v.includes('rojo') ? 'rojo' : 'sin') : v.some(esAmarillo) ? 'amarillo' : 'verde';
      tt += `<div class="mut">Disponibilidad de ${esc(pt.short)}: ${{ verde: 'todo en verde', amarillo: 'con horas en amarillo', rojo: 'con horas en rojo', sin: 'con horas que no marcó', maestria: 'encima de su maestría' }[peor]}</div>`;
    }
    if (ROOMS.length) {
      const fr = freeRoomsFor(p);
      tt += `<div style="margin-top:4px"><b>Salones libres y autorizados en ese horario (${fr.length}):</b><br>${fr.length ? fr.slice(0, 14).map((r) => esc(r.name) + (r.cap ? ' <span class="mut">(' + r.cap + ')</span>' : '')).join(' · ') + (fr.length > 14 ? ' …' : '') : 'ninguno'}</div>`;
    }
    byId = saveById;
    dragGroup = () => null;
    showTip(e.clientX, e.clientY, tt);
  }
  function onDragEnd() {
    removeEventListener('pointermove', onDragMove);
    document.body.style.cursor = '';
    const d = drag; drag = null; hideTip();
    if (!d) return;
    if (!d.active) { ui.sel = d.gid; render(); openCard(d.gid); return; }
    // Con editable, aquí se guardará el cambio (d.prop) en la base.
    render();
  }
  limpiezas.push(() => { removeEventListener('pointermove', onDragMove); removeEventListener('pointerup', onDragEnd); document.body.style.cursor = ''; });

  // ---------- Tarjeta del grupo ----------
  const card = $m('card');
  let cardId = null;
  function openCard(gid) { cardId = gid; drawCard(); }
  function closeCard() { cardId = null; card.style.display = 'none'; }
  function drawCard() {
    const g = cardId && byId[cardId];
    if (!g || !g.sessions.length) { closeCard(); return; }
    const st = stOf(g.id);
    let h = `<button class="x" data-m="cardX" title="Cerrar">×</button>
      <div class="cd">${g.items.map((i) => esc(i.clave) + (i.numero ? ' · ' + esc(i.numero) : '')).join('  +  ')}</div>
      <h4>${esc(gNames(g))}</h4>
      <div class="meta"><span>Profesor</span><b>${esc(gProfFull(g))}</b><span>Horario</span><b>${sesTxt(g)}</b>${ROOMS.length ? `<span>Salón</span><b>${esc(rName(g.roomId))}${g.roomId != null && R[g.roomId] && R[g.roomId].cap ? ' (cap. ' + R[g.roomId].cap + ')' : ''}</b>` : ''}</div>`;
    if (g.locked) h += `<div class="lockn">🔒 Publicado.</div>`;
    if (st.hard.length || st.soft.length) {
      h += `<div class="sec">Choques y avisos</div>`;
      h += st.hard.map((c) => { const o = other(c, g.id) && byId[other(c, g.id)]; return `<div class="ch1"><div class="t">${cfText(c).t}</div>${o ? `Choca con ${gFull(o)} de ${esc(gProf(o))}` : cfText(c).s}</div>`; }).join('');
      h += st.soft.map((c) => `<div class="ch1 soft"><div class="t">${cfText(c).t}</div>${cfText(c).s}</div>`).join('');
    } else h += `<div class="okc">✓ No choca con nada</div>`;
    if (!g.locked && ROOMS.length) {
      const free = freeRoomsFor(g).filter((r) => r.id !== g.roomId);
      h += `<div class="sec">Salones libres y autorizados en este horario (${free.length})</div>`;
      h += free.length ? `<div class="rooms">${free.map((r) => `<span>${esc(r.name)}<small>${r.cap ? 'cap. ' + r.cap + (g.cupo && r.cap < g.cupo ? ' < cupo' : '') : '&nbsp;'}</small></span>`).join('')}</div>` : `<div class="note">Ningún otro salón está libre y autorizado a esa hora.</div>`;
    }
    if (!g.locked && g.fijaId == null) {
      const cl = candidatos(g).filter((x) => !x.cur).slice(0, 6);
      h += `<div class="sec">Otros profesores que pueden darlo a esta hora (${cl.length}${cl.length === 6 ? '+' : ''})</div>`;
      h += cl.length ? `<div class="rooms">${cl.map((x) => `<span>${esc(x.p.short)}<small>${x.nm || 'no la marcó'} · ${x.c.cursos}${x.c.max != null ? '/' + x.c.max : ''} cursos</small></span>`).join('')}</div>
        <div class="note">Sin bloqueo, sin rojo a esa hora, libres y sin pasar su tope.</div>` : `<div class="note">Nadie más cumple: sin bloqueo, sin rojo a esa hora y libre.</div>`;
    }
    card.innerHTML = h;
    card.style.display = 'block';
    $m('cardX').onclick = closeCard;
    placeCard();
  }
  function placeCard() {
    if (!cardId || card.style.display === 'none') return;
    const els = [...blocksOf(cardId)];
    const wr = wrap.getBoundingClientRect();
    const el = els.find((e) => { const r = e.getBoundingClientRect(); return r.right > wr.left && r.left < wr.right && r.bottom > wr.top && r.top < wr.bottom; }) || els[0];
    const cw = card.offsetWidth, chh = card.offsetHeight;
    let left, top;
    if (el) {
      const r = el.getBoundingClientRect();
      left = r.right + 10; if (left + cw > innerWidth - 8) left = r.left - cw - 10;
      if (left < 8) left = Math.min(innerWidth - cw - 8, r.left + 20);
      top = r.top;
    } else { left = wr.right - cw - 12; top = wr.top + 12; }
    top = Math.max(8, Math.min(innerHeight - chh - 8, top));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  }
  escuchar(wrap, 'scroll', placeCard);

  // ---------- Controles ----------
  $m('viewSeg').onclick = (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; ui.view = b.dataset.v; render(); };
  $m('dayPills').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; ui.day = +b.dataset.d; render(); };
  // Menú de selección múltiple con casillas y buscador
  const msAll = [];
  function multiSelect(key, label, getItems, set, visible) {
    const root = $m(key);
    root.innerHTML = `<button class="ms-btn" type="button"></button>
      <div class="ms-pop" hidden><input class="ms-q" type="search" placeholder="Buscar…">
      <div class="ms-acts"><button type="button" data-a="all">Marcar todos</button><button type="button" data-a="none">Limpiar</button></div>
      <div class="ms-list"></div></div>`;
    const btn = root.querySelector('.ms-btn'), pop = root.querySelector('.ms-pop'), q = root.querySelector('.ms-q'), list = root.querySelector('.ms-list');
    const shown = () => { const qq = q.value.trim().toLowerCase(); return getItems().filter((it) => !qq || (it.label + ' ' + (it.sub || '')).toLowerCase().includes(qq)); };
    const draw = () => {
      list.innerHTML = shown().slice(0, 300).map((it) => `<label class="ms-it"><input type="checkbox" value="${esc(it.id)}" ${set.has(String(it.id)) ? 'checked' : ''}><span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></label>`).join('') || '<div class="ms-empty">Sin resultados</div>';
    };
    const sync = () => {
      root.hidden = visible ? !visible() : false;
      const n = set.size;
      btn.innerHTML = `${label}${n ? ` <span class="cnt">${n}</span>` : ''} <span class="car">▾</span>`;
      btn.classList.toggle('on', n > 0);
      if (!pop.hidden) draw();
    };
    btn.onclick = () => { const open = pop.hidden; msAll.forEach((m) => m.close()); if (open) { pop.hidden = false; q.value = ''; draw(); q.focus(); } };
    q.oninput = draw;
    list.onchange = (e) => { const v = e.target.value; if (e.target.checked) set.add(v); else set.delete(v); render(); };
    root.querySelector('.ms-acts').onclick = (e) => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'all') shown().forEach((it) => set.add(String(it.id))); else set.clear();
      render();
    };
    const m = { sync, close: () => { pop.hidden = true; } };
    msAll.push(m);
    return m;
  }
  const nGroups = (f) => groups.filter((g) => g.sessions.length && f(g)).length;
  const gr = (n) => plural(n, 'grupo');
  multiSelect('msDep', 'Departamentos', () => M.alcance.map((id) => ({ id, label: (M.deptos[id] || {}).nombre || id, sub: gr(nGroups((g) => gDep(g) === id)) })), ui.deps, () => M.alcance.length > 1);
  multiSelect('msProf', 'Profesores', () => Object.values(P)
    .filter((p) => groups.some((g) => g.profs.includes(p.id)) || (p.pref && p.pref.num_cursos_max))
    .sort((a, b) => natural(a.short, b.short))
    .map((p) => { const c = carga(p.id); return { id: p.id, label: p.short, sub: titleCase(p.nombre) + ' · ' + c.cursos + (c.max != null ? ' de ' + c.max : '') + ' cursos' }; }), ui.profs);
  multiSelect('msRoom', 'Salones', () => ROOMS.map((r) => ({ id: r.id, label: 'Salón ' + r.name, sub: (r.cap ? 'cap. ' + r.cap + ' · ' : '') + gr(nGroups((g) => g.sessions.some((se) => roomOf(g, se) === r.id))) })), ui.rooms, () => ROOMS.length > 0);
  multiSelect('msMat', 'Materias', () => {
    const n = new Map();
    for (const g of groups) for (const i of g.items) n.set(i.mid, (n.get(i.mid) || 0) + 1);
    return [...n.keys()].map((id) => M.mats[id]).filter(Boolean).sort((a, b) => natural(a.nombre, b.nombre)).map((m) => ({ id: m.id, label: m.nombre, sub: m.clave + ' · ' + gr(n.get(m.id)) }));
  }, ui.mats);
  multiSelect('msCoh', 'Plan y semestre', () => {
    const con = new Set(groups.filter((g) => g.sessions.length).flatMap((g) => g.items.map((i) => i.mid)));
    return M.cohortes.map((c) => ({ c, m: c.mids.filter((x) => con.has(x)) })).filter((x) => x.m.length > 1)
      .sort((a, b) => natural(a.c.key, b.c.key))
      .map(({ c, m }) => ({ id: c.key, label: c.key, sub: m.map((x) => M.mats[x].clave).join(', ') }));
  }, ui.cohs, () => M.cohortes.length > 0);
  escuchar(document, 'pointerdown', (e) => { if (!(e.target.closest && e.target.closest('.ms'))) msAll.forEach((m) => m.close()); });
  $m('clearF').onclick = () => { [ui.deps, ui.profs, ui.rooms, ui.mats, ui.cohs].forEach((s) => s.clear()); render(); };
  function syncFilters() { msAll.forEach((m) => m.sync()); $m('clearF').hidden = !filtering(); }
  escuchar(window, 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    msAll.forEach((m) => m.close());
    if (cardId) { closeCard(); return; }
    if (ui.sel) { ui.sel = null; render(); }
  });
  // La rejilla se vuelve a medir cuando cambia su tamaño: la ventana, el panel
  // que se colapsa o el alto que le da la página.
  let rt;
  const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { renderGrid(); placeCard(); }, 60); });
  ro.observe(wrap);
  limpiezas.push(() => ro.disconnect());

  cargar(datos.entrada, datos.grupos || [], datos.corrida || null);
  renderAcciones();
  render();

  return {
    destruir() {
      clearTimeout(rt);
      limpiezas.forEach((f) => f());
      raiz.innerHTML = '';
    },
  };
}
