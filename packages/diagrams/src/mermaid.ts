import type { MermaidApi } from './index.ts';

/**
 * Loads Mermaid from node_modules, for an app that bundles it (the admin, with Vite): a dynamic import, so it lands in
 * its own lazy chunks and the app does not grow at startup. The site does not use this: it loads the self-hosted
 * bundle at `MERMAID_SCRIPT_URL`.
 */
export const loadMermaid = async (): Promise<MermaidApi> => (await import('mermaid')).default;
