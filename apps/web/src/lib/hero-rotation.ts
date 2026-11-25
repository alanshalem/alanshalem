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
  /** Botón Reproducir/Pausar (WCAG 2.2.2): `hidden` en el HTML; el script lo muestra solo para un video. */
  toggle: 'hero-toggle',
} as const;

/**
 * Clase de estado del botón mientras el video corre. El CSS muestra "❚❚ Pausar" con ella y "▶ Reproducir" sin ella:
 * los dos textos (del diccionario) ya vienen en el HTML, así el script es el mismo en todos los idiomas.
 */
export const HERO_PLAYING_CLASS = 'is-playing';

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
  // L = localStorage, p = <picture>, a / w / m = <source> AVIF / <source> WebP / <img>,
  // b = botón Reproducir/Pausar, v = <video>, y = insertar y reproducir el video, u = sincronizar el botón.
  `let g=i=>document.getElementById(i),s=JSON.parse(g("${HERO_ELEMENT_IDS.slides}").text),l,L,p,a,w,m,b,v,y,u`,
  // localStorage puede no existir o tirar (modo privado, cookies bloqueadas): sin él solo se pierde el "no repetir".
  `try{L=localStorage;l=+L.${HERO_STORAGE_KEY}}catch{}`,
  `s=s[l=(${PICK_HERO_INDEX_JS})(s.length,l,Math.random())]`,
  `try{L.${HERO_STORAGE_KEY}=l}catch{}`,
  `p=g("${HERO_ELEMENT_IDS.picture}")`,
  `Object.assign(p.style,s.background)`,
  // Un video siempre trae el botón (WCAG 2.2.2: todo lo que se mueve solo se puede pausar). El texto sale del estado
  // real del <video> (`paused`) y no de lo que se pidió: si el navegador bloquea el autoplay (iOS en bajo consumo),
  // `play()` rechaza sin arrancar y el botón ofrece Reproducir en vez de mentir. `play()` pone `paused` en false en el
  // acto, así `u()` justo después ya muestra Pausar sin esperar al evento; los eventos cubren el resto (clics, pausas
  // del navegador). El video se inserta después del <picture> (encima), envuelto en un <div>: de ahí `.firstChild`.
  `if(s.video){b=g("${HERO_ELEMENT_IDS.toggle}");b.hidden=0;` +
    `u=()=>b.classList.toggle("${HERO_PLAYING_CLASS}",!v.paused);` +
    `y=()=>{p.insertAdjacentHTML("afterend",s.video);v=p.nextSibling.firstChild;v.onplay=v.onpause=u;v.play().catch(u);u()};` +
    `b.onclick=()=>v?v.paused?v.play():v.pause():y()}`,
  // Arranca solo si el visitante no pidió menos movimiento ni ahorro de datos (`connection` solo existe en Chrome).
  // Si no (o es una foto), el póster va por el mismo camino que una foto y el video espera al clic en Reproducir.
  // Nunca ambos de entrada: el póster no se baja dos veces.
  `if(y&&!matchMedia("${REDUCED_MOTION_QUERY}").matches&&!navigator.connection?.saveData)y();else{` +
    // Primero las <source> y después el <img> (con `src` al final): el navegador elige formato antes de pedir nada.
    `[a,w,m]=p.children;a.srcset=s.avif;w.srcset=s.webp;Object.assign(m,s.img)}`,
  `g("${HERO_ELEMENT_IDS.credit}").textContent=s.credit`,
];

/** Contenido exacto del <script> en línea (constante: su hash CSP no cambia entre builds). */
export const HERO_ROTATION_SCRIPT = `{${STATEMENTS.join(';')}}`;
