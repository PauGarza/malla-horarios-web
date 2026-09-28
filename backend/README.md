# backend — funciones del lado del servidor

> **Reemplazado por `../api/`.** La migración a MySQL + PHP del ITAM tradujo estas dos
> funciones a `api/login.php` y `api/cambiar-password.php`, con las mismas reglas, constantes
> y mensajes. Esta carpeta **no se borra todavía**: sigue siendo el backend vivo hasta el
> corte, y §10 de `plansql.md` deja apagar las funciones y pausar el proyecto de Supabase
> para *después* de verificar el sistema nuevo en producción — y no el mismo día.
>
> Lo que aquí era la parte "que migra de proveedor" ya migró: ver `../api/README.md`.

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
