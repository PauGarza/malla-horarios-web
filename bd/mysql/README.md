# Esquema MySQL (destino: `horariosdace.itam.mx`)

Traducción del esquema de PostgreSQL de `../` al MySQL que entregó la DSTI del ITAM.
El razonamiento de cada tabla y cada columna sigue viviendo en `../diseno-bd.md`; aquí solo
está lo que cambia al cambiar de motor.

A diferencia de `../`, que es una **copia** sincronizada desde el original privado, estos
archivos son material nuevo y se editan aquí.

## Orden de carga

```
1. schema-mysql.sql
2. checks-como-triggers.sql      <- OBLIGATORIO en MariaDB 5.5 (ver abajo)
3. triggers-mysql.sql
4. seed-mysql.sql
5. datos-matematicas-mysql.sql
6. datos-matematicas-cuestionario-mysql.sql
7. cargar-profesores.php         <- por SFTP, se abre una vez y se borra
```

### Los datos reales

`seed-mysql.sql` es el catálogo base (departamentos, franjas, semestres, salones). Encima van
los datos reales de Matemáticas, traducidos de los originales de PostgreSQL que viven en
`DACE/BD/`:

```
5. datos-matematicas-mysql.sql               51 materias + 54 pares de co-oferta
6. datos-matematicas-cuestionario-mysql.sql  51 filas de configuracion del cuestionario
7. cargar-profesores.php                     los 45 profesores (NO es SQL, ver abajo)
```

**Los originales son los de `DACE/BD/`.** Si cambian los datos, se cambian allá y se vuelve a
generar la traducción; estos archivos no se editan a mano.

Tres diferencias mecánicas con el original, todas por MariaDB 5.5:

| Postgres | Aquí |
|---|---|
| `FROM (VALUES (...)) AS v(a,b)` | derivado con `SELECT ... UNION ALL` (5.5 no tiene el constructor `VALUES`) |
| `ON CONFLICT DO NOTHING` | `INSERT IGNORE` |
| `::text`, `::rol_enum` | se quitan |

### El collation, que costó un error 1267

Si alguien regenera estos archivos, esto se vuelve a romper con
`Illegal mix of collations (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_general_ci,IMPLICIT)`.

Un literal de texto en MySQL es **coercible**: se adapta al collation de la columna con la que
se compara. Pero un `CAST(NULL AS CHAR)` —que hace falta para fijar el tipo de esa columna en
el `UNION`— deja de serlo, y se queda con el collation de la **conexión**. Como `SET NAMES
utf8mb4` a secas deja la conexión en `utf8mb4_general_ci` y las tablas son
`utf8mb4_unicode_ci`, el `JOIN ... ON materia.clave = v.alias_de` ya no puede ceder de ningún
lado y falla.

Por eso los archivos llevan las tres cosas, y las tres son a propósito:

```sql
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;        -- la conexion
CAST(NULL AS CHAR) COLLATE utf8mb4_unicode_ci        -- la columna del derivado
JOIN materia m ON m.clave = v.clave COLLATE utf8mb4_unicode_ci   -- la comparacion
```

La tercera sobra si las dos primeras están, pero sobrevive a que phpMyAdmin reponga el
collation de la conexión por su cuenta.

### Por qué los profesores no son SQL

`datos-matematicas.sql` inserta el hash con `crypt(cu, gen_salt('bf'))`, que es **pgcrypto**.
MySQL no tiene bcrypt: ni función, ni extensión. La única forma de generar esos hashes es
desde la aplicación, y conviene que sea con `password_hash()` de PHP — la misma función cuyo
`password_verify()` los lee después en `api/login.php`.

`cargar-profesores.php` es de **un solo uso**: se sube a la raíz del sitio, se abre una vez, y
se borra. Es idempotente (`INSERT IGNORE` por `cu`), así que correrlo dos veces no duplica ni
pisa una contraseña ya cambiada.

### La trampa del semestre

`datos-matematicas-cuestionario-mysql.sql` cuelga de **primavera 2027**. Por eso
`seed-mysql.sql` inserta dos semestres y no uno. Si ese semestre faltara, el archivo del
cuestionario insertaría **cero filas sin dar ningún error**, porque su `CROSS JOIN` no
encontraría nada.

## El servidor: MariaDB 5.5.68

Confirmado el 2026-09-25 con `SELECT VERSION()`. Es una versión de 2020, y eso no es un
detalle de trivia: **le faltan tres cosas** que el esquema daba por hechas, y cada una está
resuelta y anotada en `schema-mysql.sql`.

| Lo que falta en 5.5 | Qué se hizo |
|---|---|
| `CHECK` de verdad (llegó en MariaDB 10.2) | Se **parsean y se ignoran en silencio**. Los 10 `CHECK` se quedan escritos porque documentan la intención, pero hoy no protegen nada: `checks-como-triggers.sql` es **obligatorio**, y cada endpoint valida además en PHP. |
| Columnas calculadas con la sintaxis de MySQL (`AS (...) STORED`) | `semestre.etiqueta` **deja de ser columna**. Se arma al leerla, en `api/catalogos.php`, que es el único lugar que la consulta. |
| Tipo `JSON` (llegó en MariaDB 10.2) | `imparte.overrides` es `LONGTEXT`. La columna está vacía hoy. |
| `DATETIME DEFAULT CURRENT_TIMESTAMP` (llegó en MariaDB 10.0), y solo **un** TIMESTAMP automático por tabla | `imparte.updated_at` es `TIMESTAMP` con `ON UPDATE CURRENT_TIMESTAMP` (que es la mejora que se buscaba); `created_at` es `DATETIME` y lo escribe la aplicación. |

Una más que **sí** funciona y conviene saber: `SIGNAL SQLSTATE` existe desde MariaDB 5.5, así
que los triggers cargan tal cual.

### Comprobar que los `CHECK` efectivamente no aplican

Después de cargar todo, esto **debe insertar la fila sin protestar** (y luego la borras). Si
diera error, este servidor no es el que creemos y hay que revisar el resto de las decisiones
de esta tabla:

```sql
INSERT INTO preferencia (profesor_id, semestre_id, num_cursos_max) VALUES (1, 1, 9);
```

Y con `checks-como-triggers.sql` cargado, **debe fallar** con
`num_cursos_max debe estar entre 1 y 6`. Ese es el que importa: es el trigger, no el `CHECK`,
lo que está protegiendo el dato.

## Qué cambió al traducir

| Postgres (`../schema.sql`) | MySQL | Nota |
|---|---|---|
| 9 × `CREATE TYPE ... AS ENUM` | `ENUM(...)` inline en cada columna | MySQL no tiene tipos enum reutilizables. `dia_semana_enum` se repite en 3 tablas, `nivel_preferencia_enum` en 2. Agregar un valor (como pasó con `medio_tiempo`) ahora obliga a un `ALTER` **por tabla**. |
| `serial PRIMARY KEY` | `INT AUTO_INCREMENT PRIMARY KEY` | |
| `text` con `UNIQUE` | `VARCHAR(191)` | MySQL no indexa `TEXT` sin longitud de prefijo. 191 y no 255 porque con `utf8mb4` el índice de 767 bytes de InnoDB antiguo topa ahí. Solo afecta `departamento.nombre`. |
| `semestre.etiqueta GENERATED ... STORED` con `CASE` | `VARCHAR(20) AS (CONCAT(tipo,'-',anio)) STORED` | El `CASE` existía solo porque el cast enum→text no es `IMMUTABLE` en Postgres y una columna generada lo exige. En MySQL un `ENUM` en contexto de cadena da su etiqueta directamente. |
| `timestamptz` | `DATETIME` en UTC | MySQL no tiene tipo con zona horaria. `DATETIME` y no `TIMESTAMP` para no cargar con el límite de 2038 ni con la conversión por zona de sesión. La conexión fija `SET time_zone = '+00:00'` (`api/lib/db.php`). |
| `jsonb` | `JSON` | Sin operadores ni índices GIN. Solo afecta `imparte.overrides`, hoy vacío. |
| `COMMENT ON TABLE/COLUMN` | `COMMENT '...'` inline | Tope de 1024 caracteres por columna y 2048 por tabla. Varios comentarios del original lo pasan (la tabla `profesor`, `profesor.password_hash`, `materia_cuestionario.alias_de_id`, `materia_cuestionario.seccion`), así que aquí van cortos y apuntan a `../diseno-bd.md`. **El original no se recortó.** |
| `imparte.updated_at DEFAULT now()` sin trigger | `ON UPDATE CURRENT_TIMESTAMP` | Mejora que sale gratis: en Postgres la columna existe pero **nunca cambia después del INSERT** porque no hay trigger que la actualice. |
| 38 `CREATE POLICY` + `GRANT` por columna | — | No hay equivalente. Se vuelven autorización explícita en `api/*.php`. Ver §7.4 de `DACE/plansql.md` para el mapa política → guardia. |

## El bug que apareció al traducir: `plan_estudio_id` nullable dentro de una PK

`materia_prerequisito` y `materia_equivalencia` declaran en `../schema.sql`:

```sql
plan_estudio_id int NULL REFERENCES plan_estudio(id),
PRIMARY KEY (materia_id, prerequisito_id, plan_estudio_id)
```

con el comentario *"plan_estudio_id NULL = aplica en todos los planes"*.

**Esas filas nunca se pudieron guardar.** Postgres fuerza `NOT NULL` en toda columna que
forme parte de una `PRIMARY KEY`, sin avisar: el `NULL` de la declaración se ignora. MySQL
hace exactamente lo mismo. El bug ya existe hoy en producción; la migración solo lo hizo
visible.

Aquí se arregla con `id INT AUTO_INCREMENT` más `UNIQUE (materia_id, prerequisito_id,
plan_estudio_id)`. Salvedad honesta: un índice `UNIQUE` de MySQL **admite varios `NULL`
repetidos**, así que protege contra duplicados entre planes concretos pero no contra dos
filas "aplica a todos" idénticas. Se aceptó porque preserva la semántica documentada; la
alternativa era una fila centinela en `plan_estudio`, que mete un valor falso en un catálogo
real.

No es urgente (ninguna pantalla usa todavía estas dos tablas), pero **el esquema de Postgres
lo sigue teniendo** y conviene arreglarlo allá también si alguna vez se vuelve a usar.

## Tabla que no existe en Postgres: `intento_login`

Las dos Edge Functions limitaban los intentos de login con un `Map` en memoria del proceso.
PHP no tiene estado entre peticiones: cada request arranca de cero, así que ese código no se
puede portar. El límite se guarda en `intento_login` y lo consultan `api/login.php` y
`api/cambiar-password.php` (ver `api/lib/rate-limit.php`). Mismos números que las Edge
Functions: ventana de 5 minutos, 8 intentos para login, 5 para cambio de contraseña.

## Nota sobre GitHub Pages

El frontend consume el API en `/api` (mismo origen que el sitio del ITAM), así que después
del corte **el build de GitHub Pages deja de funcionar**: ahí `/api` no existe. Es
intencional — GitHub Pages era el entorno de pruebas mientras la base vivía en Supabase.
Si alguna vez hace falta revivirlo, `VITE_API_URL` permite apuntar a otro origen, pero eso
reintroduce CORS y habría que volver a poner los headers en el PHP.
