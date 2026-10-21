# `api/` — el backend en PHP

Veinte endpoints y siete archivos de librería que corren en
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
| `registro.php` | GET / POST | GET → `{departamentos}`; POST `{cu, nombre, correo, password, departamento_id, tipo_contrato}` → `{ok}` (201). Sin sesión; el rol siempre es `profesor` y `estado_especial` queda NULL (solo lo captura un admin). Correo obligatorio y único desde 2026-10-02 (409 `correo_existente`) |
| `cambiar-password.php` | POST | `{password_actual, password_nueva}` → `{ok}` |
| `perfil.php` | POST | `{correo}` → `{ok, correo}`. Lo editable del perfil propio. Desde 2026-10-02 el correo es obligatorio (no se puede borrar) y único |
| `olvide-password.php` | POST | `{correo}` → `{ok}` **siempre**, exista o no la cuenta. Sin sesión. Si es de una cuenta activa, manda un enlace `/#restablecer=<token>` que vale 1 hora y una vez (2026-10-02) |
| `restablecer-password.php` | POST | `{token, password_nueva}` → `{ok, cu}`. Sin sesión; canjea el enlace. 400 `token_invalido` si venció, ya se usó o no existe |
| `catalogos.php` | GET | Perfil propio (con `correo`), departamentos, franjas, semestre actual y si el formulario propio está publicado. Manda **todas** las franjas con `dias` (null = todos los días, D31) y `departamento_id` (null = todos los departamentos, D32); el frontend filtra según el formulario que dibuja |
| `cuestionario.php` | GET | El formulario del profesor que llama, ya resuelto por audiencia. Vacío si no está publicado. Trae `ratio_horas_verde` ya resuelto para su contrato (asignatura = 1) y los `creditos` de cada materia, para calcular el mínimo de horas en verde (2026-10-13) |
| `preferencia.php` | GET, PUT | La propia preferencia. El PUT es una transacción, exige formulario publicado y revalida los mínimos. `num_cursos_max` se exige siempre (1-6): la pregunta es fija desde 2026-10-13. Al enviar, el mínimo de horas en verde se calcula con `horas_minimas_verde()` (`lib/catalogo.php`): 3 h por curso pedido, +1 h si hay una de 8 créditos en verde, × el ratio del contrato, hacia arriba a la media hora. Las celdas de disponibilidad en un día o un departamento en que su franja no existe se descartan en silencio; una franja inexistente es 400 |
| `panel.php` | GET | Roster + preferencia de cada quien (jefatura) |
| `reabrir.php` | POST | `estado` → `borrador` (jefatura) |
| `materias.php` | GET, POST, PATCH, PUT | Catálogo de materias y co-oferta (jefatura) |
| `configuracion.php` | GET, PUT, POST | El editor del formulario: leerlo, guardarlo completo, publicarlo (jefatura). Exige exactamente una sección de disponibilidad y una de número de cursos (fija desde 2026-10-13). Recibe `ratio_horas_verde` (1-5) en lugar de las horas mínimas fijas |
| `respuestas.php` | GET, POST | Matriz profesores × materias y bloqueos de jefatura (jefatura). `?recurso=num_cursos` `{profesor_id, num_cursos: 0-6 | null}`: la jefatura sobreescribe el número de cursos de un profesor en `ajuste_num_cursos` (null lo quita); `preferencia` no se toca y el profesor nunca lo ve (2026-10-12) |
| `asignaciones.php` | GET, POST, PUT, DELETE | Asignaciones directas de la jefatura antes del motor (`asignacion_fija` + `asignacion_fija_horario`, 2026-10-13): materia + profesor + horario opcional. `tipo: 'maestria'` (sin `materia_id`) aparta horas del profesor sin contar como curso: horario obligatorio y sin atar a créditos. Rechaza par bloqueado, horario que no sume `materia.creditos`, franja inválida para el día/departamento y choques entre fijas del mismo profesor; lo demás (rojo en disponibilidad, exceso de cursos) solo lo avisa la vista. `?recurso=disponibilidad&profesor_id=` da la rejilla de un profesor (jefatura) |
| `reporte.php` | GET | Por profesor: contrato, cursos solicitados, materias (con la lista) y horas en verde/amarillo/rojo (jefatura). Horas = suma de la duración de las franjas marcadas; sin bloqueos de jefatura. `?recurso=horas`: las celdas de disponibilidad de cada profesor, para el mapa de calor |
| `demanda.php` | GET, POST | Estimación de demanda de Servicios Escolares: leerla y reemplazarla (jefatura). Las materias agregadas a mano en la pantalla llegan como filas normales con las columnas del reporte en 0 |
| `semestres.php` | GET, POST | Ciclo de semestres: listar, abrir el siguiente, reactivar uno (admin y jefa de división) |
| `motor-entrada.php` | GET | `?semestre_id=&departamentos=1,2,3&salones=0|1` → el paquete `autoplanear-entrada/2` para el motor (convención en `malla-horarios/docs/convencion-datos-motor.md`). Registra la descarga y su huella en `motor_descarga`. `salones=0` manda `salones: []` (modo sin salones, D44). `?recurso=salones` cuenta los salones con disponibilidad. **Solo admin** (D43). Lo arma `lib/motor.php` (2026-10-13) |
| `motor-salida.php` | GET, POST | `POST ?accion=validar` revisa una `autoplanear-salida/2` contra §5 sin escribir; `?accion=aplicar` `{salida, confirmar_desfase}` revalida y, en una transacción, borra los grupos sin publicar del alcance y crea los nuevos (`grupo` con `crn` NULL, `imparte`, `imparte_profesor`, `imparte_co_oferta`, `imparte_horario`), sin publicar; 422 `salida_invalida`, 409 `desfasada` (cambió algo desde la descarga y no se confirmó), 409 `rechazado_por_la_base`. GET `?semestre_id=` → corridas aplicadas (`motor_corrida`) y grupos por estado. **Solo admin** (D43) |

Los que aceptan varias operaciones las distinguen con `?recurso=` (`materias.php?recurso=co_oferta`,
`configuracion.php?recurso=formulario|publicar`, `respuestas.php?recurso=bloqueo|num_cursos`, `reporte.php?recurso=horas`). Los de
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

(Comprobado en el navegador con las cuentas de Rumbos y Soto; confirmado por la usuaria el 2026-10-13.)

**Cuentas de admin (desde 2026-10-09).** `registro.php` siempre crea `profesor`, así que un admin
se da de alta a mano en phpMyAdmin: `rol = 'admin'`, con `departamento_id`, `tipo_contrato` y `correo`
en NULL (la app pide el correo en el primer inicio de sesión). Es la forma que describe
`chk_profesor_depto` para admin, servicios escolares y nómina, pero MariaDB 5.5 ignora ese CHECK y
nada lo valida. `password_hash` tiene que ser bcrypt: `php -r 'echo password_hash("…", PASSWORD_DEFAULT);'`
en el servidor, o `bcryptjs` en Node (no hay PHP local). Hay una: CU `1`, creada el 2026-10-09 con
contraseña temporal para cambiar al entrar.

**Semestre activo (desde 2026-09-29).** Hay exactamente uno; `lib/semestre.php` lo resuelve y
`exigir_semestre_activo()` hace que toda escritura que cuelga de un semestre (preferencias,
formulario, publicación, bloqueos, reabrir, demanda) responda **409 `semestre_cerrado`** si no es el
activo. Leer semestres cerrados sigue permitido. Abrir el siguiente copia el formulario de cada
departamento (sin publicar) y la disponibilidad de salones.

**Desde 2026-09-28** el armado del formulario vive en `lib/catalogo.php` (`cuestionario_de()`,
`formulario_completo()`, `faltantes_para_enviar()`), compartido por cuatro endpoints para que lo
que ve el profesor, lo que valida el servidor y lo que edita la jefatura no se desincronicen.
Los bloqueos (`bloqueo_profesor_materia`) y los verdes de jefatura (`verde_profesor_materia`,
2026-10-21) **solo** los leen los endpoints de la jefatura (`respuestas.php`, `asignaciones.php`) y
la descarga del motor: ningún endpoint que use un profesor los consulta, porque el profesor no debe
enterarse.

**Recuperar la contraseña (desde 2026-10-02).** `olvide-password.php` guarda en
`recuperacion_password` el SHA-256 de un token de 256 bits y manda el token por correo; pedir
otro invalida el anterior. Responde antes de mandar el correo (`fastcgi_finish_request`) para
que el tiempo de respuesta no delate si la cuenta existe. Límites: 5 solicitudes / 5 min por IP y
3 por correo. El correo sale por `lib/correo.php`: `mail()` del servidor por defecto, o SMTP si
`config.php` trae `'smtp' => ['host' => …]` (ver `lib/config.example.php`). **`mail()` sí entrega** desde
este servidor (probado el 2026-10-02), pero Outlook del ITAM lo manda a correo no deseado y lo
marca como remitente externo. Pendiente con la DSTI: autorizar `horariosdace.itam.mx` como
remitente (SPF/lista segura) o dar una cuenta SMTP institucional. Si un enlace no llega, revisar
el log de PHP (`correo.php: …`).

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

Cubre lo de la tabla y además: 403 en los 20 caminos de gestión con token de profesor, token
con `alg:"none"`, claim `rol` cambiado a admin y `exp` vencido → 401. Opcionales:
`AP_PROF2_*` + `AP_ESCRIBIR=1` para el `profesor_id` ajeno (escribe el borrador de la primera
cuenta), y `AP_JEFE_*` para comprobar que un jefe de departamento no puede pedir
`?departamento_id=` de otro.

**Rol y `activo` se leen de la base en cada petición** (2026-10-01, `sesion()` en
`lib/auth.php`). Antes salían del claim del JWT, así que a quien se le quitaba la jefatura o se
desactivaba conservaba sus permisos hasta que el token venciera (12 h).
