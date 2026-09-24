# frontend — Autoplanear (app real)

Reemplaza a `../docs/mockup/mockup-cuestionario.html` (que se queda como referencia histórica de
contenido/flujo, ya validado con los Jefes de Departamento). Esta carpeta es el código fuente de la
app real que se conecta a la base de datos del proyecto y se publica en GitHub Pages.

## Stack

React + Vite (RNF01 de `../../REQUERIMIENTOS.md`, ya decidido desde 2026-08-07). Vite porque produce
un build 100% estático — encaja directo con GitHub Pages, sin necesitar servidor propio.


## Variables de entorno necesarias (build-time, públicas por diseño)

Nombradas de forma genérica a propósito — el proveedor de base de datos es una decisión que se puede
revisitar (ver `../backend/README.md`), y no queremos que el nombre de un proveedor específico quede
regado por el código del frontend si el día de mañana migramos.

- `VITE_DB_URL` — URL del proyecto/instancia de base de datos.
- `VITE_DB_ANON_KEY` — clave pública (anon/anónima). **Nunca** la clave de administrador aquí — esa
  nunca debe llegar al frontend, solo la usan la función de login y las herramientas de admin/Jefe de
  Departamento que corren fuera de este sitio público (ver `../bd/diseno-bd.md` §4.2/§10.3).
- `VITE_LOGIN_FUNCTION_URL` — endpoint de la función de login (`../backend/`).

### Dónde viven esos valores

| Archivo | Para qué | ¿Se commitea? |
| --- | --- | --- |
| `.env.example` | plantilla que documenta las 3 variables | sí |
| `.env` | desarrollo local de cada quien | **no** (está en `.gitignore`) |
| `.env.production` | el build que se publica | **sí, a propósito** |

`.env.production` existe porque `.env` está ignorado y el build de GitHub Actions no lo ve: sin él,
las 3 variables saldrían en `undefined` y el síntoma sería un "Failed to fetch" al iniciar sesión —
idéntico al del bug de CORS ya resuelto, o sea fácil de diagnosticar mal. Que esté commiteado no es
un descuido: las 3 son públicas por diseño y de todas formas quedan legibles en el JavaScript que el
navegador descarga, así que esconderlas en *secrets* de CI daría una sensación de seguridad sin
agregar ninguna. La protección real vive en RLS (`../bd/rls-policies.sql`).

## Despliegue

Se publica en GitHub Pages con `../.github/workflows/deploy-pages.yml`, que buildea y despliega en
cada push a `main` que toque `frontend/`. `dist/` nunca se commitea: el artefacto lo produce CI.

Como Pages sirve el repo desde un subdirectorio (`<usuario>.github.io/<repo>/`), `vite.config.js`
fija `base`. Sin eso el build genera rutas absolutas tipo `/assets/index-abc.js` que ahí dan 404, y
el síntoma es una pantalla en blanco sin error legible. Para probarlo sin desplegar:

```sh
npm run build && npm run preview   # sirve en /malla-horarios-web/, igual que producción
```

Ese `preview` usa el build de producción, así que también sirve para confirmar que
`.env.production` entró bien: si no, el login truena ahí y no en Pages.

No hace falta `404.html` ni trucos de ruteo: la navegación entre vistas es por estado de React
(`src/App.jsx`), no por rutas de URL, así que recargar nunca cae en una ruta que Pages no conozca.

## Estado actual

App real y funcionando contra la base de datos del proyecto (React 19 + Vite 8). Ya construido:

- login con el JWT propio de la función del backend, sesión persistida en `localStorage`
  (`src/lib/api.js`, `src/context/AuthContext.jsx`).
- `HomePage` con opciones según el perfil de cada quien.
- cuestionario de preferencias completo (`src/pages/FormularioPreferencias.jsx`): las dos secciones
  con mínimos que bloquean el envío, validación de horas en verde, y rejilla de horarios con pintado
  por arrastre.
- vistas de Jefe de Departamento: panel de preferencias recibidas, configuración del cuestionario y
  catálogo de materias.

Falta, entre otras cosas, la pantalla de carga de catálogo y el panel "grande" de Jefe de
Departamento — la lista viva está en el `TODO.md` del proyecto, fuera de este repo.
