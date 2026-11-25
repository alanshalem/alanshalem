/**
 * Observador de archivos de los servidores de desarrollo (Vite del admin y Astro del sitio).
 *
 * En Windows los eventos de cambio del sistema de archivos a veces se pierden (escrituras en ráfaga, procesos
 * cortados a mitad de una escritura). Cuando pasa, Vite se queda con la versión vieja de un módulo en memoria y
 * la sirve para siempre: el navegador ve, por ejemplo, un `client.ts` sin el export que el disco sí tiene.
 * Con polling Vite no depende de esos eventos: compara los archivos cada `interval` ms y un cambio perdido se
 * detecta en la vuelta siguiente. Solo afecta al modo desarrollo; los builds de producción no observan nada.
 */
export const reliableDevWatch = {
  usePolling: true,
  // Equilibrio entre rapidez del recargado y CPU: el proyecto es chico y 300 ms no se nota al editar.
  interval: 300,
} as const;
