import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Rutas RELATIVAS a index.html en vez de absolutas. Un mismo build tiene que
  // servir en dos lugares que cuelgan de rutas distintas:
  //
  //   - GitHub Pages (entorno de pruebas): <usuario>.github.io/malla-horarios-web/
  //   - horariosdace.itam.mx (sitio institucional): la raíz del dominio
  //
  // Con el default ('/') Vite genera /assets/index-abc.js, que en Pages da 404;
  // con '/malla-horarios-web/' da 404 en el dominio del ITAM. En ambos casos el
  // síntoma es una pantalla en blanco sin error legible, porque lo que falla es
  // la carga del propio JavaScript. './' sirve para los dos sin recompilar por
  // destino, y reescribe tanto los assets del build como el href del favicon.
  //
  // Esto funciona porque la app navega por estado de React, no por rutas del
  // navegador: index.html siempre se sirve desde la raíz del sitio, así que las
  // rutas relativas nunca se resuelven contra una profundidad distinta. Si algún
  // día se mete un router con URLs reales (/catalogo, /cuestionario), './' deja
  // de alcanzar y hay que volver a un `base` absoluto por destino.
  base: './',

  // El API vive en /api del mismo origen que la app. En producción eso lo
  // resuelve el servidor del ITAM, que sirve el build y los .php desde la misma
  // raíz; en `npm run dev` no hay PHP local, así que las peticiones a /api se
  // reenvían al servidor real. Sin esto habría que poner VITE_API_URL con el
  // dominio completo, y entonces el navegador exigiría CORS — que es justo lo
  // que la migración quitó.
  //
  // changeOrigin porque el vhost del ITAM responde por nombre: sin reescribir
  // el Host, nginx no sabe qué sitio servir.
  server: {
    proxy: {
      '/api': {
        target: 'https://horariosdace.itam.mx',
        changeOrigin: true,
      },
    },
  },
})
