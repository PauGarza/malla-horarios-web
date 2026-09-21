# backend — funciones del lado del servidor

Código que corre fuera del navegador: hoy, la función de login (verifica `password_hash`, firma el
JWT propio — ver `BD/rls-policies.sql` en el repo de trabajo para el porqué). El frontend nunca ve la
clave de administrador de la base de datos; solo este backend la usa.


`backend/supabase/`: es una carpeta
que la herramienta de línea de comandos del proveedor actual espera encontrar con ese nombre exacto
para poder desplegar las funciones (`supabase/functions/<nombre>/index.ts`). Si el proyecto migra de
proveedor más adelante, esa subcarpeta se reemplaza por la que el nuevo proveedor requiera — el resto
del repo (`frontend/`, `docs/`, este README) no debería necesitar cambios de nombre.

## Estructura

```
backend/
└── supabase/
    └── functions/
        └── login/
            └── index.ts   — valida cu/correo + password, firma el JWT propio
```
