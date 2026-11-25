# Sistema de diseño — extraído de federicocarrone.com

Medido el 2026-11-24 sobre la home, en 5 viewports (390 · 768 · 1024 · 1440 · 1920). Los valores salen de `main.css` (`:root`) y de los estilos computados del DOM, no de estimaciones visuales.

Archivos:
- `tokens.json` — tokens en formato W3C DTCG (para Style Dictionary, Tokens Studio, etc.)
- `tokens.css` — los mismos tokens como CSS custom properties + `@font-face` + base tipográfica
- `../screenshots/` — full-page por viewport (`*-fullpage.png`) y versiones livianas (`*-preview.jpg`)

---

## 1. Carácter del diseño

Editorial, sobrio, oscuro. Tres ideas que sostienen todo lo demás:

1. **Tres voces tipográficas con roles fijos**: Gloock (display) para títulos de contenido, Pagella (serif de lectura) para texto y para el H1 del hero, Hanken Grotesk (UI) para todo lo "de interfaz" (nav, labels, meta, footer).
2. **Casi sin decoración**: radios `0`, sin sombras, sin gradientes salvo el overlay de imágenes. La jerarquía la dan tamaño, tipografía, color de texto y reglas de 1px.
3. **Tres niveles de texto** sobre fondo casi negro: principal `#ededea`, secundario `#c8c8c2`, terciario `#8e8e88`.

## 2. Color

| Token semántico | Valor | Uso |
|---|---|---|
| `bg-page` | `#0a0a0b` | Fondo de página (coincide con `theme-color`) |
| `bg-surface` | `#141416` | Tiles, paneles, mapa del grafo |
| `bg-surface-alt` | `#1b1b1e` | Superficie alternativa |
| `bg-code` | `#131316` | Bloques de código |
| `text-primary` | `#ededea` | Títulos y cuerpo |
| `text-secondary` | `#c8c8c2` | Dek / bajadas |
| `text-tertiary` | `#8e8e88` | Labels, meta, créditos, footer |
| `border-subtle` | `#2a2a2d` | Reglas de sección, listas, footer |
| `link-accent` | `#9db2ff` | Links dentro de artículos |
| `link-underline-hover` | `#c4d0ff` | Subrayado en hover/focus |
| dataviz | `#a9c98a` `#8fa7d9` `#e08f6a` | Nodos del grafo de ideas |

Overlay de imágenes (hero y tiles): degradé vertical de `rgba(10,10,11,.55)` arriba → transparente a 22% → `.1` a 45% → `.94` abajo, para que el texto se lea sobre cualquier foto.

## 3. Tipografía

| Rol | Familia | Peso | Tamaño | Interlineado |
|---|---|---|---|---|
| H1 hero | Pagella | 400 | `clamp(2.4rem, 5.6vw, 4.6rem)` | 1.02 |
| Dek hero | Pagella | 400 | `clamp(1.05rem, 1.35vw, 1.25rem)` | 1.45–1.55 |
| Título nota destacada | Gloock | 400 | `clamp(2rem, 3.6vw, 3rem)` | 1.05 |
| Título card | Gloock | 400 | 1.6rem (25.6px) | 1.12 |
| Título tile / serie | Gloock | 400 | 1.8rem (28.8px) | 1.08 |
| Título lista numerada | Gloock | 400 | 1.4rem (22.4px) | 1.2 |
| Marca (header / footer) | Gloock | 400 | 1.5rem / 1.75rem | — |
| Cuerpo | Pagella | 400 | 1.1875rem (19px) | 1.55 |
| Dek de card | Pagella | 400 | 1rem | 1.5 |
| Dek nota destacada | Pagella | 400 | 1.15rem | 1.5 |
| Nav / links de entrada | Hanken Grotesk | 500 / 400 | 0.95rem | 1.55 |
| Label (eyebrow, h2 de sección) | Hanken Grotesk | 600 | 0.75rem, MAYÚSCULAS, tracking .12em | 1.55 |
| Meta (fecha · lectura) | Hanken Grotesk | 400 | 0.8125rem | 1.55 |
| Crédito de foto | Hanken Grotesk | 400 | 0.75rem | 1.5 |
| Footer | Hanken Grotesk | 400 | 0.9rem | 1.55 |

Nota sobre las fuentes: el sitio las sirve self-hosted (`/fonts/*.woff2`, subset latin, `font-display: swap`). Gloock y Hanken Grotesk son OFL (están en Google Fonts / Fontsource). "Pagella" probablemente sea TeX Gyre Pagella (clon de Palatino, licencia libre GUST) pero **no lo pude verificar**; confirmalo antes de usarla, o usá Palatino/TeX Gyre Pagella directamente.

## 4. Espaciado y layout

Escala en rem, con los valores que realmente aparecen: `0.25 · 0.5 · 0.7 · 0.9 · 1 · 1.1 · 1.25 · 1.5 · 1.75 · 2 · 2.5 · 2.75 · 3 · 3.5 · 5 · 7`.

- **Gutter lateral**: `clamp(1rem, 3.75vw, 3rem)` → 16px en mobile, 48px desde ~1280px.
- **Secciones**: `padding-top: 5rem`, gap de `1.75rem` entre el encabezado de sección (label + link a la derecha + regla de 1px) y el contenido.
- **Hero**: ocupa todo el viewport (`min-height: 100vh`), contenido pegado abajo, `padding: 7rem gutter 3.5rem`, texto con `max-width: 58rem`, imagen `object-fit: cover` a pantalla completa con el overlay.
- **Ancho de contenido**: fluido, **sin max-width** en la home (a 1920 el contenido mide 1824px). Las páginas de lectura usan una columna de `35em` (~665px).
- **Esquinas**: `0`. **Sombras**: ninguna. **Bordes**: 1px `#2a2a2d`.

### Comportamiento por viewport (observado)

| Elemento | 390 | 768 | 1024 | 1440 | 1920 |
|---|---|---|---|---|---|
| Gutter | 16 | 28.8 | 38.4 | 48 | 48 |
| H1 hero | 38.4px | 43px | 57.3px | 73.6px | 73.6px |
| Nav | botón ☰ | botón ☰ | links visibles | links | links |
| "Start here" | 1 col | 1 col | 1 col | 2 col | 3 col |
| Nota destacada | 1 col | 1 col | 2 col (1.5fr / 1fr) | 2 col | 2 col |
| Cards | 1 col | 2 col (la 3ª baja) | 2 col (la 3ª baja) | 3 en fila | 3 en fila |
| Explore (grafo + 3 paneles) | 1 col | 1 col | 2 col (1.5fr / 1fr) | 2 col | 2 col |
| "Try an idea" (paneles) | 1 col | 2 col (el 3º baja) | 3 col | 3 col | 3 col |
| Series (tiles) | 1 col | 2×2 | 3 + 1 | 4 en fila | 4 en fila |
| Library (posters) | 8 en fila (≈32px c/u) | 8 en fila | 8 en fila | 8 en fila | 8 en fila |
| Footer | 2 col | 2 col | 4 col (2fr 1fr 1fr 1fr) | 4 col | 4 col |

Reglas CSS detectadas que lo explican: `cards` = `auto-fill minmax(18rem,1fr)` a partir de `75em` y 2 columnas por debajo; `tiles` = `auto-fill minmax(16rem,1fr)`, gap 1.25rem; `start-list` = `auto-fill minmax(min(100%,22rem),1fr)` con gap `0 2.5rem`. En el 1024 y en la lista numerada hay overrides por media query cuyo valor exacto no terminé de aislar: los números de la tabla son lo **observado**, no necesariamente la regla.

## 5. Componentes

**Header / nav.** Fila flex, `padding: 1.5rem gutter`, transparente sobre el hero. Links Hanken 15.2px peso 500, color `text-primary`, sin subrayado. A la derecha, selector de idioma `EN | ES` separado por una línea vertical; el idioma activo en blanco, el otro atenuado. Por debajo de ~900px los links se reemplazan por un botón ☰ cuadrado con borde `1px rgba(237,237,234,.4)`.

**Hero.** Foto a pantalla completa + overlay. H1 en Pagella, bajada de 2 párrafos (links con subrayado fino), tres links de entrada en Hanken 15.2px ("More about me", "Latest writing", "Simulations") y crédito de foto alineado abajo a la derecha (12px, `text-tertiary`). En mobile el crédito pasa abajo a la izquierda.

**Encabezado de sección.** Flex `space-between`, label a la izquierda (estilo label), link o descripción a la derecha (Hanken 14px, `text-secondary`), regla inferior de 1px `border-subtle`, `padding-bottom: .9rem`.

**Lista numerada ("Start here").** Cada ítem: número `01–04` en `text-tertiary`, título en Gloock 22.4px, dek en Pagella `text-tertiary`; `padding: 20px 0` y regla inferior de 1px.

**Nota destacada.** Imagen 16:9 + cuerpo (eyebrow "SERIES · ONE PATH", título Gloock grande, dek, meta, crédito con regla superior). Sin hover más allá del subrayado de links.

**Card.** Imagen 16:10, eyebrow, título Gloock 25.6px, dek Pagella 16px (truncado a ~3 líneas con "…"), meta. Gap interno 11.2px. En hover/focus **no** se subraya el título (el sitio lo desactiva explícitamente).

**Panel (Explore / Try an idea).** Fondo `bg-surface`, `padding: 1.25rem`, sin borde ni radio. Título Gloock + dek Pagella. El panel grande del grafo usa los tres colores dataviz sobre `bg-surface`; al hacer hover las líneas suben a opacidad .22.

**Tile (serie).** Imagen a sangre completa, aspecto 6:5, overlay degradé, texto abajo a la izquierda: título Gloock 28.8px, subtítulo Hanken 15.2px, meta 13px ("4 episodes · in progress").

**Poster strip.** 8 columnas iguales, gap .9rem, aspecto 2:3.

**Footer.** `border-top: 1px`, `padding: 2.5rem gutter 3rem`, fondo de página. Columna de marca (Gloock 28px + tagline + nota "Written with an LLM…") y 3 columnas de links bajo labels en mayúsculas (Contact me · Companies · Browse).

**Links.** Heredan color; subrayado de 1px con `underline-offset` ~.22em; en hover/focus el subrayado sube a 3px y toma `#c4d0ff`. Los links de marca pasan a blanco en hover. Los links dentro de artículos usan el acento `#9db2ff`.

**Movimiento.** Casi nulo: transiciones cortas (150ms) y `prefers-reduced-motion` respetado.

## 6. Qué no pude verificar

- Solo medí la **home**. Páginas de artículo, búsqueda, series, simulaciones y Explore (grafo interactivo) no están relevadas. El CSS global ya trae reglas de lectura (barra de progreso, botón copiar código, anclas de títulos) que no están documentadas acá.
- **Corrección:** en la primera versión dije que el sitio es solo oscuro. Es falso para las páginas de lectura (artículos, episodios, About, detalle de serie): ahí el cuerpo va sobre una "hoja" blanca. Está documentado en la sección 8. La home y los listados sí son oscuros.
- Estados `:hover` de cards/tiles: el CSS los neutraliza (sin subrayado); no vi cambios visuales más allá de eso.
- Las capturas de 1440 y 1920 están **reescaladas** (la herramienta las entrega al ~96% y ~82% del tamaño nativo), así que tienen algo menos de nitidez que las de 390/768/1024. Las grillas y tamaños de este documento salen del DOM, no de esas imágenes.
- Las capturas tienen costuras de ~1px entre tramos y el cursor del mouse visible en algunos. En mobile la foto de la Tierra queda detrás del texto del hero tal como renderiza la página.
- Los 8 posters en mobile miden ~32px: es lo que calcula el CSS, no verifiqué si es intencional o un efecto de carga diferida.

## 8. Tema "papel" de las páginas de lectura (agregado tras relevar el resto del sitio)

Las páginas con `body.has-hero` + `.reading` (artículos, episodios de serie, About, Explore/temas, plan de estudios) combinan **dos superficies**: hero oscuro a pantalla completa arriba, y debajo una hoja blanca (`.paper`) con el texto. Al final vuelve el fondo oscuro para "Read next" y el footer.

| Token | Valor | Uso |
|---|---|---|
| `paper-bg` | `#ffffff` | Fondo de la hoja de lectura |
| `paper-text` | `#2c2724` | Texto |
| `paper-muted` | `#656565` | Links del cuerpo, TOC, tags, labels |
| `paper-rule` | `#ece9e4` | Reglas, bordes de cita/newsletter/código inline |
| `paper-border-ui` | `#d9d9d6` | Borde de tags, chips y botones de compartir |
| `paper-code-bg` | `#f9f9f9` | Código inline y bloque BibTeX |
| `code-block-bg` / `fg` | `#24292e` / `#e1e4e8` | Bloques de código (tema oscuro tipo GitHub) |

Medidas (a 1440px):
- Cuerpo: Pagella **17px / 27.2px**, columna de **640px**; padding de la hoja `72px 0 80px`.
- H1 del hero de artículo: **80px** (`clamp(2.5rem, 6vw, 5rem)`, line-height 1.02). La home usa un tamaño menor (73.6px).
- H2 del cuerpo: Pagella 25.6px / 28.2px, peso 400.
- TOC lateral: columna de 224px a la izquierda del texto, Pagella 14px, link activo en negrita y color de texto. Desaparece en mobile y pasa a un índice en línea arriba del texto.
- Cita en bloque: borde izquierdo 4px, `padding-left: 25.6px`. "Key takeaways" y "The problem / Why existing approaches fail": caja con fondo gris muy claro y borde izquierdo.
- Código inline: mono 14px, fondo `#f9f9f9`, borde 1px, radio 4px. Bloque: mono 12.8px / 19.2px, radio 2px, scroll horizontal.
- Cierre del artículo (`.end-matter`, regla superior + 32px): bloque "Cite this" (label 12px mayúsculas + texto + BibTeX), nota "Written with an LLM…" (Hanken 14px), tags (borde 1px, sin radio, 14px), chips "Ideas in this piece" (radio 999px, 13.6px), barra "Share" (X · LinkedIn · Email · Copy link, altura 36px) y caja de newsletter (padding 28px, título Pagella 22.4px, input + botón oscuro).
- Navegación de serie: dos cajas "Previous episode / Next episode" lado a lado en desktop, apiladas en mobile.
- "Read next": vuelve al tema oscuro, 3 cards en desktop, 1 columna en mobile.

## 9. Cómo se organiza cada pantalla

El sitio tiene ~147 páginas en inglés (más una copia completa en `/es/`) pero solo ~12 plantillas. Todas comparten header + footer; cambian el hero y el cuerpo.

| Plantilla | Rutas | Estructura (de arriba hacia abajo) |
|---|---|---|
| Home | `/` | Hero foto fullscreen → Start here → Latest (1 destacada + 3 cards) → Explore (grafo + 3 paneles) → Try an idea → Series → From the library → footer |
| Artículo | `/articles/*`, `/about/`, `/talks/*`, `/explore/*`, `/data/*`, `/licenciatura-*` | Hero con foto + título + dek + meta + tags → franja "On the image" (descripción + crédito) → hoja blanca con TOC lateral + texto → cierre (cita, tags, ideas, compartir, newsletter) → Read next → footer |
| Episodio de serie | `/series/<serie>/<episodio>/` | Igual que artículo + nota de serie, navegación anterior/siguiente y "From the series" |
| Listado de artículos | `/articles/` | Título + bajada → bloques por año (año grande atenuado a la izquierda, grilla de cards a la derecha) → "Index" en texto con listas por serie |
| Listado de series | `/series/` | Título + bajada → grilla de tiles verticales (4 por fila en desktop, 2 en tablet, 1 en mobile) |
| Detalle de serie | `/series/<serie>/` | Hero + franja de imagen → hoja con progreso (puntos, nº de episodios, minutos, estado) → intro → resumen de la tesis en cajas → Reference → Episodes (número + miniatura + título + fecha + dek) |
| Talks | `/talks/` | Título → grilla de miniaturas de video con título y evento |
| Library | `/library/` | Título + bajada → una fila por categoría (Anime, Movies, Series, Games, Reading, Music) con título, botones y carrusel horizontal de portadas + contador "+N" → 3 tarjetas finales (Podcasts, Sources, Quotes) |
| Catálogo (anime, movies, games, music…) | `/anime/`, `/movies/`, … y `/*/backlog/` | Título + intro → chips "On this page" → secciones con tarjetas de portada, puntaje (IMDb / Metacritic), tags y una línea de opinión |
| Reading | `/reading/` | Columna angosta, filtros por tema, libros apilados con portada grande |
| Explore | `/explore/` | Hero chico → "Learn the foundations" (3 recorridos numerados) → grafo de ideas → Simulations (por familia, con lista de simulaciones y botón Open) |
| Topics | `/keywords/`, `/keywords/<tag>/` | Nube de chips con contador; el detalle lista los artículos de ese tag |
| Search | `/search/` | Título + input; los resultados aparecen al escribir |
| Quotes | `/quotes/` | Lista centrada de citas grandes en Gloock con autor en mayúsculas |

Chequeo técnico relevante para el stack: el sitio está generado con **Zola** (se ve por la clase `zola-anchor` en los títulos) y es 100% estático. La búsqueda se resuelve en el navegador (`/js/search.js`), el newsletter manda un `POST` a Buttondown, las analíticas son Umami y hay feeds RSS y Atom. Es decir: no tiene backend propio.

## 7. Sobre reutilizar el contenido

Esto es el sistema visual (tipografía, color, espaciado, estructura). Los textos, las ilustraciones y los pósters son de su autor o de terceros (los pósters son material con derechos), así que para tu sitio conviene usar el sistema con contenido y fotos propios. La foto Earthrise sí es de dominio público (NASA).
