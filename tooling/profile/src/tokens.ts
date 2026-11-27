/**
 * Reads colors from the site's design tokens (packages/tokens/src/tokens.css, their only source): the custom
 * properties of the `:root` block, following `var(--x)` references down to the final value.
 */
export function cssColors(css: string): (name: string) => string {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = code.indexOf(':root');
  const root = start === -1 ? '' : code.slice(start, code.indexOf('}', start));
  const declarations = root.matchAll(/--([\w-]+):\s*([^;]+);/g);
  const properties = new Map([...declarations].map(([, name, value]) => [name!, value!.trim()]));

  const colorOf = (name: string, seen: readonly string[] = []): string => {
    if (seen.includes(name)) {
      const chain = [...seen, name].map((property) => `--${property}`).join(' -> ');
      throw new Error(`tokens.css has a var() cycle: ${chain}`);
    }
    const value = properties.get(name);
    if (value === undefined) throw new Error(`tokens.css has no --${name}`);
    const reference = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
    if (reference) return colorOf(reference, [...seen, name]);
    return value.toLowerCase().replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, '#$1$1$2$2$3$3');
  };
  return (name) => colorOf(name);
}
