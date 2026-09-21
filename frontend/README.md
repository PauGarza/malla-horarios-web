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
  Departamento que corren fuera de este sitio público (ver `../../BD/diseno-bd.md` §4.2/§10.3).
- `VITE_LOGIN_FUNCTION_URL` — endpoint de la función de login (`../backend/`).

## Estado actual

**Scaffold generado 2026-09-21** (`npm create vite@latest . -- --template react`, React 19 + Vite 8):
`npm install` corrido, `npm run dev` probado y responde 200. `.env.example` incluido con los valores
reales del proyecto (son públicos por diseño, ver arriba); copiar a `.env` para desarrollo local.

Sigue siendo el scaffold por defecto de Vite (`src/App.jsx` de ejemplo) — falta construir el cliente de
base de datos real (login vía la función del backend, guardar el JWT propio, mandarlo como
`Authorization: Bearer` en cada llamada) y el formulario en sí, reusando el contenido/flujo ya
validado de `../docs/mockup/mockup-cuestionario.html` pero conectado a datos reales en vez de
`localStorage`. Pendiente también el workflow de GitHub Actions para desplegar a Pages.
