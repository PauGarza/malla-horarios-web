import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // La app no se sirve desde la raíz de un dominio, sino desde un subdirectorio
  // (GitHub Pages publica un repo en <usuario>.github.io/<repo>/). Sin esto Vite
  // genera rutas absolutas del tipo /assets/index-abc.js, que ahí dan 404 — y el
  // síntoma es una pantalla en blanco sin ningún error legible, porque lo que
  // falla es la carga del propio JavaScript. Con `base` se reescriben tanto los
  // assets del build como el href del favicon en index.html.
  //
  // Se puede probar en local sin desplegar: `npm run build && npm run preview`
  // sirve en http://localhost:4173/malla-horarios-web/, o sea con el mismo
  // subdirectorio que producción.
  //
  // Si algún día el proyecto se mueve a su propio dominio o a la raíz, esto
  // vuelve a ser '/'.
  base: '/malla-horarios-web/',
})
