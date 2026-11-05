// El horario de un profesor: su lista de clases y la semana en cuadrícula. Lo usan
// Mi perfil y las vistas previas de la jefatura. Sin salón: lo asigna Servicios
// Escolares después, y lo que hay hoy en la base es de prueba.
//
// clases: [{ etiqueta, materia, sesiones: [{ dia, inicio, fin }] }] de api/lib/aviso.php.

const DIAS = [
  ['lunes', 'Lun'],
  ['martes', 'Mar'],
  ['miercoles', 'Mié'],
  ['jueves', 'Jue'],
  ['viernes', 'Vie'],
];
const CORTO = Object.fromEntries(DIAS);
const orden = Object.fromEntries(DIAS.map(([d], i) => [d, i]));

const minutos = (h) => {
  const [a, b] = h.split(':').map(Number);
  return a * 60 + b;
};
const hora = (h) => h.replace(/^0(\d)/, '$1');
const FRANJA = 30;

/** 'Lun Mié 10:00–11:30', una línea por cada hora distinta. */
export function textoSesiones(sesiones) {
  const por = new Map();
  for (const s of [...sesiones].sort((a, b) => orden[a.dia] - orden[b.dia])) {
    const horas = `${hora(s.inicio)}–${hora(s.fin)}`;
    if (!por.has(horas)) por.set(horas, []);
    por.get(horas).push(CORTO[s.dia] ?? s.dia);
  }
  return [...por].map(([horas, dias]) => `${dias.join(' ')} ${horas}`);
}

export default function HorarioProfesor({ clases }) {
  const sesiones = clases.flatMap((c, i) => c.sesiones.map((s) => ({ ...s, clase: c, indice: i })));

  return (
    <div className="horario-profesor">
      <ul className="horario-lista">
        {clases.map((c) => (
          <li key={c.etiqueta}>
            <strong>{c.materia}</strong>
            <span className="horario-clave">{c.etiqueta}</span>
            <span>{c.sesiones.length ? textoSesiones(c.sesiones).join(' · ') : 'Horario por definir'}</span>
          </li>
        ))}
      </ul>
      {sesiones.length > 0 && <Cuadricula sesiones={sesiones} />}
      <p className="formulario-nota">Salón por asignar: lo hará Servicios Escolares.</p>
    </div>
  );
}

function Cuadricula({ sesiones }) {
  // Solo las horas que hace falta ver, redondeadas a la hora completa.
  const desde = Math.floor(Math.min(...sesiones.map((s) => minutos(s.inicio))) / 60) * 60;
  const hasta = Math.ceil(Math.max(...sesiones.map((s) => minutos(s.fin))) / 60) * 60;
  const filas = (hasta - desde) / FRANJA;
  const fila = (m) => (m - desde) / FRANJA + 2;

  const etiquetas = [];
  for (let m = desde; m < hasta; m += 60) {
    etiquetas.push(m);
  }

  return (
    <div className="horario-cuadricula-marco">
      <div
        className="horario-cuadricula"
        role="img"
        aria-label="Horario de la semana"
        style={{ gridTemplateRows: `auto repeat(${filas}, minmax(16px, 1fr))` }}
      >
        {DIAS.map(([dia, corto], i) => (
          <div key={dia} className="horario-dia" style={{ gridColumn: i + 2, gridRow: 1 }}>
            {corto}
          </div>
        ))}
        {etiquetas.map((m) => (
          <div
            key={m}
            className="horario-hora"
            style={{ gridColumn: 1, gridRow: `${fila(m)} / span 2` }}
          >
            {m / 60}:00
          </div>
        ))}
        {DIAS.map(([dia], i) =>
          etiquetas.map((m) => (
            <div
              key={dia + m}
              className="horario-celda"
              style={{ gridColumn: i + 2, gridRow: `${fila(m)} / span 2` }}
            />
          )),
        )}
        {sesiones.map((s) => (
          <div
            key={`${s.indice}-${s.dia}-${s.inicio}`}
            className={`horario-sesion horario-sesion-${s.indice % 6}`}
            style={{
              gridColumn: orden[s.dia] + 2,
              gridRow: `${fila(minutos(s.inicio))} / ${fila(minutos(s.fin))}`,
            }}
            title={`${s.clase.materia} · ${hora(s.inicio)}–${hora(s.fin)}`}
          >
            <strong>{s.clase.materia}</strong>
            <span>
              {hora(s.inicio)}–{hora(s.fin)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
