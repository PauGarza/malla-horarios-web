# `api/` — el backend en PHP

Doce endpoints y seis archivos de librería que corren en
`https://horariosdace.itam.mx/api/`, contra el MySQL del ITAM
(`../bd/mysql/`).

Esta carpeta es el reemplazo de dos cosas a la vez:

- **PostgREST**, que era el que respondía todas las lecturas y escrituras.
- **Row Level Security**, que era el que decidía quién veía qué. MySQL no la tiene, así que
  la autorización se volvió código. El mapa completo de política → guardia está en §7.4 de
  `plansql.md`, y cada endpoint abre nombrando la(s) política(s) que reemplaza.

## Instalación

```
1. Copiar lib/config.example.php a lib/config.php y llenarlo.
2. cd frontend && npm run deploy:api
```

El script sube los `.php`, pone `lib/config.php` en 644 la primera vez y **nunca lo
sobrescribe** después. `lib/config.php` está en el `.gitignore` de la raíz: **nunca se
commitea**, igual que `frontend/.env.deploy`.

## Tres cosas del servidor del ITAM que no son negociables

Las dos se descubrieron probando contra el servidor real el 2026-09-25, y las dos producen
fallos que no se parecen a su causa.

### `config.php` va en 644, no en 600

PHP corre como `apache`; el archivo lo sube el usuario de SFTP, que es otro uid. Con `600`
apache no puede leerlo y **todos los endpoints responden 500 con el cuerpo vacío**. Con `640`
tampoco: no comparten grupo. El detalle completo está en `lib/config.example.php`.

### El token va en `X-Autoplanear-Token`, no en `Authorization`

Hay un **proxy inverso delante de Apache** (se ve en `X-Forwarded-For`, `X-Real-Ip` y
`X-Forwarded-Proto`) que **descarta el header `Authorization`**. No llega a PHP por ninguna
vía: ni `$_SERVER['HTTP_AUTHORIZATION']`, ni `REDIRECT_HTTP_AUTHORIZATION`, ni
`getallheaders()`. Un `.htaccess` con la receta habitual de `mod_rewrite` tampoco lo
recupera, porque el header ya no existe cuando Apache lo ve.

Los headers propios sí pasan intactos. Por eso `lib/auth.php` lee `X-Autoplanear-Token`
primero, y deja `Authorization: Bearer` como respaldo por si el API se despliega algún día
detrás de algo que no lo toque. El frontend manda los dos.

### `PUT`, `PATCH` y `DELETE` van tunelados sobre `POST`

El mismo proxy **rechaza esos tres métodos** con un 405 propio (devuelve HTML de nginx, no el
JSON del API), así que ni siquiera llegan a PHP. Solo pasan `GET` y `POST`:

```
GET    -> llega a PHP
POST   -> llega a PHP
PUT    -> 405 de nginx
PATCH  -> 405 de nginx
DELETE -> 405 de nginx
```

Esto habría roto **todo el guardado**: `preferencia.php` (PUT), `materias.php` (PATCH y PUT) y
`configuracion.php` (PUT).

El frontend los manda como `POST` con la cabecera `X-HTTP-Method-Override`, y `metodo_http()`
en `lib/auth.php` los vuelve a resolver. Es el tunelado clásico para atravesar intermediarios
restrictivos. Dos límites deliberados: el override **solo se admite sobre POST** (sobre GET
permitiría convertir un enlace en una escritura) y solo para esos tres verbos.

Todo endpoint que necesite saber el método debe usar `metodo_http()`, **nunca**
`$_SERVER['REQUEST_METHOD']` directamente.

## Los endpoints

| Archivo | Métodos | Qué hace |
|---|---|---|
| `login.php` | POST | `{cu, password}` → `{token, expira_en, rol}` |
| `registro.php` | GET / POST | GET → `{departamentos}`; POST `{cu, nombre, password, departamento_id, tipo_contrato[, correo]}` → `{ok}` (201). Sin sesión; el rol siempre es `profesor` y `estado_especial` queda NULL (solo lo captura un admin) |
| `cambiar-password.php` | POST | `{password_actual, password_nueva}` → `{ok}` |
| `perfil.php` | POST | `{correo}` → `{ok, correo}`. Lo editable del perfil propio; `""` borra el correo (2026-10-02) |
| `catalogos.php` | GET | Perfil propio (con `correo`), departamentos, franjas, semestre actual y si el formulario propio está publicado |
| `cuestionario.php` | GET | El formulario del profesor que llama, ya resuelto por audiencia. Vacío si no está publicado |
| `preferencia.php` | GET, PUT | La propia preferencia. El PUT es una transacción, exige formulario publicado y revalida los mínimos. `num_cursos_max` solo se exige (1-6) si el formulario del profesor trae esa pregunta; si no, se guarda NULL (2026-10-02) |
| `panel.php` | GET | Roster + preferencia de cada quien (jefatura) |
| `reabrir.php` | POST | `estado` → `borrador` (jefatura) |
| `materias.php` | GET, POST, PATCH, PUT | Catálogo de materias y co-oferta (jefatura) |
| `configuracion.php` | GET, PUT, POST | El editor del formulario: leerlo, guardarlo completo, publicarlo (jefatura). Exige una sección de disponibilidad y a lo más una de número de cursos (opcional desde 2026-10-02) |
| `respuestas.php` | GET, POST | Matriz profesores × materias y bloqueos de jefatura (jefatura) |
| `demanda.php` | GET, POST | Estimación de demanda de Servicios Escolares: leerla y reemplazarla (jefatura). Las materias agregadas a mano en la pantalla llegan como filas normales con las columnas del reporte en 0 |
| `semestres.php` | GET, POST | Ciclo de semestres: listar, abrir el siguiente, reactivar uno (admin y jefa de división) |

Los que aceptan varias operaciones las distinguen con `?recurso=` (`materias.php?recurso=co_oferta`,
`configuracion.php?recurso=formulario|publicar`, `respuestas.php?recurso=bloqueo`). Los de
jefatura aceptan `&departamento_id=` para quien `ve_todos_los_departamentos()`; sin él usan el
departamento propio.

**Alcance de la jefatura de división (desde 2026-10-02, temporal).** Con
`DIVISION_SOLO_SU_DEPARTAMENTO = true` en `lib/auth.php`, `jefe_division` deja de ver los 3
departamentos y se comporta como jefatura de su `departamento_id` (Matemáticas): hoy solo `admin`
pasa `ve_todos_los_departamentos()`. Lo que es de toda la división —abrir y reactivar semestres—
lo conserva vía `administra_semestres()`, pero `semestres.php` ya solo le manda el avance de su
departamento. Para devolverle los 3 se pone en `false` aquí **y** en `frontend/src/lib/roles.js`.

| Cuenta | MAT | ACT | EST | semestres |
|---|---|---|---|---|
| Rumbos (`jefe_division`) | 200 | 403 | 403 | 200 (solo avance de MAT) |
| Soto (`jefe_departamento`) | 200 | 403 | 403 | 403 |
| admin | 200 | 200 | 200 | 200 |

(Lo esperado tras el deploy; falta comprobarlo contra producción.)

**Semestre activo (desde 2026-09-29).** Hay exactamente uno; `lib/semestre.php` lo resuelve y
`exigir_semestre_activo()` hace que toda escritura que cuelga de un semestre (preferencias,
formulario, publicación, bloqueos, reabrir, demanda) responda **409 `semestre_cerrado`** si no es el
activo. Leer semestres cerrados sigue permitido. Abrir el siguiente copia el formulario de cada
departamento (sin publicar) y la disponibilidad de salones.

**Desde 2026-09-28** el armado del formulario vive en `lib/catalogo.php` (`cuestionario_de()`,
`formulario_completo()`, `faltantes_para_enviar()`), compartido por cuatro endpoints para que lo
que ve el profesor, lo que valida el servidor y lo que edita la jefatura no se desincronicen.
Los bloqueos (`bloqueo_profesor_materia`) **solo** los lee `respuestas.php`: ningún endpoint que
use un profesor los consulta, porque el profesor no debe enterarse.

## Reglas que se respetan en todos

- **`password_hash` solo se selecciona en `login.php` y `cambiar-password.php`.** Nunca
  `SELECT *` sobre `profesor`: siempre lista explícita de columnas. Es el equivalente del
  `REVOKE ALL ON profesor` + `GRANT SELECT (...)` de `../bd/rls-policies.sql`.
- **El `profesor_id` sale del token, nunca del cuerpo ni del query string.** Es lo que impide
  que alguien lea o escriba la preferencia de otro mandando su id.
- **Todo el SQL va en sentencias preparadas de verdad** (`ATTR_EMULATE_PREPARES => false`).
- **El detalle de un error va al log, no al navegador**: un mensaje de MySQL puede revelar
  nombres de columnas y estructura.
- **Los errores devuelven `{error, codigo?}`**, donde `codigo` es un identificador estable
  (`clave_duplicada`, `ya_enviada`, …) para que el frontend no tenga que reconocer texto de
  errores de un motor concreto.

## Notas de portabilidad

Escrito para **PHP 7.4**, porque la versión del hosting no estaba confirmada (§2.2 de
`plansql.md`). No se usan `str_starts_with`, `match`, enums, operador nullsafe ni spread con
llaves de texto. Si resulta ser PHP 8.x, todo sigue funcionando igual.

Sin Composer y sin dependencias: el JWT HS256 son ~40 líneas en `lib/auth.php`. El algoritmo
se fija a HS256 y **se compara contra el header** del token — aceptar el `alg` que venga es la
vulnerabilidad clásica de JWT.

## Lo que ya no existe

- **Headers CORS.** El API vive en el mismo origen que la app. Las Edge Functions los
  necesitaban porque el frontend estaba en GitHub Pages y la base en Supabase.
- **Llave pública en el cliente.** No hay `apikey` que mandar, así que `VITE_DB_ANON_KEY`
  desapareció del frontend.
- **`trg_bloquear_automodificacion_modo_materias`** y **`trg_limitar_reapertura_jefe`**: los
  dos existían para acotar políticas RLS necesariamente más amplias que su intención. Un
  endpoint que no acepta el campo no necesita trigger.
- **La lista personalizada de materias por profesor** (`?recurso=modo_materias|elegibles`),
  eliminada el 2026-09-28: todos los profesores de un departamento ven el mismo formulario, y lo
  que se decide por persona se hace después como bloqueo, en `respuestas.php`.

## Verificación

Las pruebas de seguridad de §11.3 de `plansql.md` **no son opcionales**: RLS se reemplazó por
código y son lo único que dice si la traducción funcionó. Con el token de un profesor normal,
`panel.php` y `reabrir.php` deben dar 403; un token manipulado, uno con `alg:"none"` y uno
expirado deben dar 401; `password_hash` no debe aparecer en ninguna respuesta; y mandar el
`profesor_id` de alguien más en el cuerpo de un PUT no debe escribir nada suyo.

Corridas contra el servidor el 2026-09-25, con el token de un profesor:

| Prueba | Resultado |
|---|---|
| `panel.php`, `reabrir.php`, `materias.php`, `configuracion.php` | 403 ✅ |
| token con la firma alterada | 401 ✅ |
| sin token | 401 ✅ |
| `password_hash` en las respuestas | no aparece ✅ |

Falta la del `profesor_id` ajeno en el cuerpo del PUT, que se hace con dos cuentas.

**Desde 2026-10-01 estas pruebas son un script:** [`pruebas/autorizacion.mjs`](pruebas/autorizacion.mjs)
(Node 18+, sin dependencias; `deploy:api` no lo sube porque solo sube `.php`). Las
credenciales van por variable de entorno, nunca en el repo:

```sh
AP_URL=https://horariosdace.itam.mx/api AP_PROF_CU=... AP_PROF_PASS=... \
  node api/pruebas/autorizacion.mjs
```

Cubre lo de la tabla y además: 403 en los 16 caminos de gestión con token de profesor, token
con `alg:"none"`, claim `rol` cambiado a admin y `exp` vencido → 401. Opcionales:
`AP_PROF2_*` + `AP_ESCRIBIR=1` para el `profesor_id` ajeno (escribe el borrador de la primera
cuenta), y `AP_JEFE_*` para comprobar que un jefe de departamento no puede pedir
`?departamento_id=` de otro.

**Rol y `activo` se leen de la base en cada petición** (2026-10-01, `sesion()` en
`lib/auth.php`). Antes salían del claim del JWT, así que a quien se le quitaba la jefatura o se
desactivaba conservaba sus permisos hasta que el token venciera (12 h).
