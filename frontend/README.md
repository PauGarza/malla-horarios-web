# frontend — Autoplanear (app real)

La app que usan profesores y jefatura, servida desde **https://horariosdace.itam.mx/**. Habla
con el API propio en PHP que vive en el mismo origen (`../api/`, en `/api`). Reemplaza a
`../docs/mockup/mockup-cuestionario.html`, que se queda como referencia histórica del contenido que
ya validaron los Jefes de Departamento.

## Stack

React 19 + Vite. La navegación entre vistas es por estado de React (`src/App.jsx`), no por rutas
de URL, así que recargar nunca cae en una ruta que el servidor no conozca. `vite.config.js` usa
`base: './'` (rutas relativas) por la misma razón.

Única dependencia además de React: **`pdfjs-dist`**, para leer en el navegador el PDF de
estimación de demanda de Servicios Escolares. Se carga solo cuando alguien sube un PDF (chunks
aparte, ~1.7 MB), no en el arranque de la app.

## Desarrollo y despliegue

```sh
npm install
npm run dev          # localhost; /api se reenvía a horariosdace.itam.mx (proxy en vite.config.js)
npm run build        # dist/
npm run lint         # oxlint
npm run deploy:itam  # build + sube dist/ al servidor del ITAM por SFTP
npm run deploy:api   # sube ../api/*.php (nunca sobrescribe api/lib/config.php)
```

El build **no necesita variables de entorno**: el API está en `/api` del mismo origen.
`VITE_API_URL` (ver `.env.example`) solo sirve para apuntar a otro origen, y eso volvería a
necesitar CORS en el PHP. Los dos scripts de despliegue leen las credenciales de SFTP de
`.env.deploy` (plantilla en `.env.deploy.example`), que **nunca se commitea**.

GitHub Pages ya no se usa (su workflow se eliminó el 2026-09-28): la app necesita el API en PHP, que
Pages no puede servir.

`scripts/probar-parser-demanda.mjs` prueba el lector del PDF de demanda contra archivos reales, sin
navegador. Úsalo cuando llegue un reporte nuevo, para saber si cambió el formato antes de subirlo.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `src/pages/` | Una pantalla por archivo (ver abajo) |
| `src/components/` | `BarraSuperior` (menú de usuario y semestre activo), `SelectorDepartamento` (jefa de división / admin), `FormularioPiezas` (TriToggle, rejilla de disponibilidad: las comparten el formulario del profesor y el editor), `EtiquetaFlotante` (el detalle que se abre al hacer clic en un número de los reportes), `NumCursos` (número de cursos con el marcador **J** cuando la jefatura lo ajustó) |
| `src/lib/api.js` | Un wrapper por endpoint. `PUT`/`PATCH`/`DELETE` van tunelados sobre `POST` con `X-HTTP-Method-Override` y el token va en `X-Autoplanear-Token`: el proxy del ITAM bloquea esos métodos y descarta `Authorization` (ver `../api/README.md`) |
| `src/lib/roles.js` | Etiquetas de rol y contrato, `ROLES_GESTION` y `veTodosLosDepartamentos()`, espejo de `api/lib/auth.php` |
| `src/lib/formulario.js` | Reglas del formulario compartidas: audiencia por contrato, mínimos para enviar (incluido `horasMinimasVerde`, el mínimo de horas en verde calculado con los cursos y el ratio), vista previa por contrato. Espejo de `api/lib/catalogo.php` |
| `src/lib/numCursos.js` | El número de cursos que cuenta (el ajuste de jefatura si lo hay, si no el del profesor) y su descripción |
| `src/lib/parserDemanda.js` | Lector del PDF (o texto pegado) de estimación de demanda. Funciones puras |
| `src/context/AuthContext.jsx` | Sesión (JWT en `localStorage`), perfil, departamentos, franjas y **semestre activo** |

## Pantallas

El inicio (`HomePage`) se organiza en cuatro secciones:

| Sección | Quién la ve | Pantallas |
|---|---|---|
| **Mi formulario** | quien da clases | `FormularioPreferencias` — el formulario del profesor, armado por el servidor según su contrato |
| **Proceso del semestre** | jefatura | agrupado por fases del procedimiento: `CatalogoMaterias` → `EditorCuestionario` (editar y publicar) → `CargaDemanda` → `RespuestasCuestionario` (bloqueos y ajuste del número de cursos) → `AsignacionesDirectas` (fijar profesor, materia y horario antes del algoritmo; incluye la Materia de Maestría) → pasos en construcción (asignar y revisar la malla, cartas, inscripciones) |
| **Reportes** | jefatura | `PanelPreferencias` (quién contestó, reabrir), `ReportePreferencias` (por profesor: contrato, cursos, materias y horas por color; CSV), `ReporteHoras` (mapa de calor de las horas pedidas) |
| **Administración** | admin y jefa de división | `Semestres` — abrir el siguiente semestre, consultar y reactivar los anteriores |
| **Probar el formulario** | solo admin | `ProbarFormulario` — elige departamento y contrato y monta `FormularioPreferencias` con `prueba`: el formulario sale del editor (`configuracion.php`) recortado con `cuestionarioParaContrato()`, se llena y se valida como el real, y ni el borrador ni el envío llegan al servidor (2026-10-13) |

**El admin** ve las mismas pantallas que la jefatura, pero de los 3 departamentos: cada una lleva
`SelectorDepartamento` arriba y muestra un departamento a la vez (`CatalogoMaterias`,
`EditorCuestionario`, `CargaDemanda`, `RespuestasCuestionario`, `PanelPreferencias`). Como no tiene
departamento propio, arrancan en el primero (`departamentoInicial()` de `lib/roles.js`). Su vista
de conjunto es `Semestres`: publicado, enviados, borradores y demanda por departamento.

Además, desde el menú de usuario de la barra superior: `PerfilUsuario` (datos de la cuenta y cambio
de contraseña).

El estado vivo de lo que falta está en el `TODO.md` del proyecto, fuera de este repo.
