/**
 * Guardián de medios: una imagen o un video que no carga (archivo que falta, red cortada, formato no soportado)
 * nunca tiene que verse roto — ni ícono de imagen rota, ni texto alternativo suelto, ni placeholder borroso estirado.
 * Se oculta su contenedor y queda el fondo oscuro de la página.
 *
 * - Contenedor = el ancestro marcado con `data-media` (el fondo del hero: foto, póster y video juntos), si no el
 *   <picture>, si no el propio elemento. Ocultar el contenedor también se lleva el placeholder (es su fondo).
 * - Un <video> solo falla cuando fallan TODAS sus <source>: el navegador prueba la siguiente (AV1 → H.264) y recién
 *   la última dispara el error definitivo. Las <source> de un <picture> no disparan errores (los dispara el <img>).
 * - Los errores de carga no burbujean: el listener va en fase de captura sobre la ventana, en el <head>, así ve
 *   también los medios que el script del hero inserta después.
 * - `style.display` y no el atributo `hidden`: el CSS del sitio pone `display: contents` a algunos <picture>, y
 *   eso le ganaría a `[hidden]`.
 */

/** Atributo que marca el contenedor que se oculta entero cuando falla cualquiera de sus medios. */
export const MEDIA_CONTAINER_ATTRIBUTE = 'data-media';

/** Contenido exacto del <script> en línea del <head> (constante: su hash CSP no cambia entre builds). */
export const MEDIA_GUARD_SCRIPT =
  'addEventListener("error",e=>{let t=e.target,n=t.tagName;' +
  // <source> de <video>: solo cuenta la última (ya no quedan alternativas). La de un <picture> se ignora.
  'if(n=="SOURCE"){t=t.parentNode;if(t.tagName!="VIDEO"||e.target!=t.lastElementChild)return}' +
  'else if(n!="IMG"&&n!="VIDEO")return;' +
  `(t.closest("[${MEDIA_CONTAINER_ATTRIBUTE}]")||t.closest("picture")||t).style.display="none"},true)`;
