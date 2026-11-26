/*
 * Los límites de validación de la API, en un solo lugar del admin (principio 1 de la auditoría, L4). El admin los usa
 * para avisar antes de enviar (validaciones, `maxLength`, contadores, guías); la API sigue siendo la autoridad.
 * test/limits.test.ts lee las constantes del dominio en C# (Blog.Domain) y las compara con estas: si cambia un lado y
 * no el otro, el test falla. Solo está lo que el admin usa (YAGNI): sumar un límite = sumarlo acá y en ese test.
 */
export const LIMITS = {
  /** PostContent y Slug. */
  post: { title: 200, slug: 120, summary: 400, coverAlt: 300 },
  /** SiteSettingsContent. Las versiones en inglés tienen los mismos límites que sus pares en español (L4). */
  settings: { name: 100, tagline: 200, bio: 2000, email: 254 },
  /** WebUrl: toda URL (enlaces, portada). */
  url: 2048,
  /** HeroImageContent: alt y crédito, en los dos idiomas. */
  heroImage: { alt: 300, credit: 200 },
  /** HeroFrame (L13, S10): una sola regla para fotos y videos. */
  heroFrame: {
    ideal: { width: 1920, height: 1080 },
    min: { width: 1280, height: 720 },
    // Ancho ≥ 6/5 del alto. Como fracción entera, igual que la API: comparar 1,2 × alto en coma flotante podría
    // rechazar (o aceptar) por un redondeo una medida que la API trata distinto.
    minAspect: { numerator: 6, denominator: 5 },
  },
  /** VideoEdit (L19, S12, S15): lo que dura el tramo y los fundidos que se pueden elegir. */
  video: { minSeconds: 1, maxSeconds: 15, fadeSeconds: [0.5, 1, 2], defaultFadeSeconds: 1 },
} as const;
