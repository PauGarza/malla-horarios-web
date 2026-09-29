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
| `src/components/` | `BarraSuperior` (menú de usuario y semestre activo), `SelectorDepartamento` (jefa de división / admin), `FormularioPiezas` (TriToggle, rejilla de disponibilidad: las comparten el formulario del profesor y el editor) |
| `src/lib/api.js` | Un wrapper por endpoint. `PUT`/`PATCH`/`DELETE` van tunelados sobre `POST` con `X-HTTP-Method-Override` y el token va en `X-Autoplanear-Token`: el proxy del ITAM bloquea esos métodos y descarta `Authorization` (ver `../api/README.md`) |
| `src/lib/roles.js` | Etiquetas de rol y contrato, `ROLES_GESTION` y `veTodosLosDepartamentos()`, espejo de `api/lib/auth.php` |
| `src/lib/formulario.js` | Reglas del formulario compartidas: audiencia por contrato, mínimos para enviar, vista previa por contrato. Espejo de `api/lib/catalogo.php` |
| `src/lib/parserDemanda.js` | Lector del PDF (o texto pegado) de estimación de demanda. Funciones puras |
| `src/context/AuthContext.jsx` | Sesión (JWT en `localStorage`), perfil, departamentos, franjas y **semestre activo** |

## Pantallas

El inicio (`HomePage`) se organiza en cuatro secciones:

| Sección | Quién la ve | Pantallas |
|---|---|---|
| **Mi formulario** | quien da clases | `FormularioPreferencias` — el formulario del profesor, armado por el servidor según su contrato |
| **Proceso del semestre** | jefatura | agrupado por fases del procedimiento: `CatalogoMaterias` → `EditorCuestionario` (editar y publicar) → `CargaDemanda` → `RespuestasCuestionario` (bloqueos) → pasos en construcción (asignar y revisar la malla, cartas, inscripciones) |
| **Reportes** | jefatura | `PanelPreferencias` (quién contestó, reabrir), `CargaDemanda` en solo lectura ("Demanda del semestre") |
| **Administración** | admin y jefa de división | `Semestres` — abrir el siguiente semestre, consultar y reactivar los anteriores |

Además, desde el menú de usuario de la barra superior: `PerfilUsuario` (datos de la cuenta y cambio
de contraseña).

El estado vivo de lo que falta está en el `TODO.md` del proyecto, fuera de este repo.
