/**
 * Rotación del hero (S1, L10, L13): en cada visita, una foto o video al azar de la galería, nunca el último que
 * se vio. Es JS plano en línea, sin librerías ni red: corre apenas el navegador parsea el hero, antes de pintar,
 * así la foto empieza a bajar enseguida y no hay saltos. El HTML estático trae los datos (JSON) y un
 * <picture> vacío; sin JS se ve la primera foto (o el póster del primer video) dentro de <noscript>.
 */

/** Ids compartidos entre el marcado de index.astro y el script. */
export const HERO_ELEMENT_IDS = {
  /** <script type="application/json"> con las diapositivas (HeroSlide[]). */
  slides: 'hero-slides',
  /**
   * <picture> vacío con sus hijos en orden fijo: <source> AVIF, <source> WebP, <img>. Lleva el fondo.
   * Un video se inserta justo después (encima) y el <picture> queda vacío, solo con el fondo.
   */
  picture: 'hero-picture',
  /** Línea de crédito de la foto. */
  credit: 'hero-credit',
} as const;

/** Clave de localStorage con el índice de la última foto mostrada. */
export const HERO_STORAGE_KEY = 'hero';

/**
 * Selector puro (n fotos, l = última vista, r = Math.random()) → índice a mostrar.
 * - n < 2: siempre 0, sin azar.
 * - l válida: sortea entre las n - 1 restantes y saltea l (r < l queda igual; r ≥ l corre uno).
 * - l inválida (primera visita, NaN, galería que se achicó): sortea entre las n.
 * Viaja tal cual dentro del script: los tests ejecutan exactamente este código.
 */
export const PICK_HERO_INDEX_JS = '(n,l,r)=>n<2?0:l>=0&&l<n?(r=r*--n|0)<l?r:r+1:r*n|0';

/** Quien la activa en el sistema ve el póster en vez del video. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// Sentencias del script, en orden. Minificado a mano para quedar bajo 800 bytes (L13): viaja en cada visita a la home.
const STATEMENTS = [
  // g = buscar por id, s = diapositivas (`.text` de un <script> es su contenido), l = última vista,
  // L = localStorage, p = <picture>, a / w / m = <source> AVIF / <source> WebP / <img>.
  `let g=i=>document.getElementById(i),s=JSON.parse(g("${HERO_ELEMENT_IDS.slides}").text),l,L,p,a,w,m`,
  // localStorage puede no existir o tirar (modo privado, cookies bloqueadas): sin él solo se pierde el "no repetir".
  `try{L=localStorage;l=+L.${HERO_STORAGE_KEY}}catch{}`,
  `s=s[l=(${PICK_HERO_INDEX_JS})(s.length,l,Math.random())]`,
  `try{L.${HERO_STORAGE_KEY}=l}catch{}`,
  `p=g("${HERO_ELEMENT_IDS.picture}")`,
  `Object.assign(p.style,s.background)`,
  // Video solo si el visitante no pidió menos movimiento ni ahorro de datos (`connection` solo existe en Chrome).
  // Si no, su póster va por el mismo camino que una foto. Nunca ambos: el póster no se baja dos veces.
  `if(s.video&&!matchMedia("${REDUCED_MOTION_QUERY}").matches&&!navigator.connection?.saveData)` +
    `p.insertAdjacentHTML("afterend",s.video);else{` +
    // Primero las <source> y después el <img> (con `src` al final): el navegador elige formato antes de pedir nada.
    `[a,w,m]=p.children;a.srcset=s.avif;w.srcset=s.webp;Object.assign(m,s.img)}`,
  `g("${HERO_ELEMENT_IDS.credit}").textContent=s.credit`,
];

/** Contenido exacto del <script> en línea (constante: su hash CSP no cambia entre builds). */
export const HERO_ROTATION_SCRIPT = `{${STATEMENTS.join(';')}}`;
