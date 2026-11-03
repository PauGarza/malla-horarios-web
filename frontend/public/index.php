<?php
// Puente para que https://horariosdace.itam.mx/ (sin "index.html") cargue la app.
//
// El nginx del ITAM tiene index.php como índice de directorio, no index.html:
// pedir /index.html daba 200, pero pedir / daba 404 con "File not found." —el
// mensaje de php-fpm cuando nginx le pasa un index.php que no existe. O sea que
// el servidor SÍ busca este archivo; basta con que esté y devuelva el HTML.
//
// Este archivo vive en public/ para que Vite lo copie tal cual a dist/ en cada
// build (public/ se copia sin procesar), y así el despliegue no tenga un paso
// manual aparte que se pueda olvidar.
//
// La alternativa limpia es pedirle al webmaster de la DSTI que agregue
// index.html a la directiva `index` del server block. Si algún día pasa, este
// archivo se puede borrar sin tocar nada más.
header('Content-Type: text/html; charset=UTF-8');
// Que el navegador pregunte siempre por el HTML: es el que dice qué bundle
// cargar, y si se queda con uno viejo, tras un despliegue se sigue viendo la
// versión anterior. Los assets llevan hash en el nombre y esos sí se cachean.
header('Cache-Control: no-cache');
readfile(__DIR__ . '/index.html');
