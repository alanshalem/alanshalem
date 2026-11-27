/**
 * File watcher of the dev servers (the admin's Vite and the site's Astro).
 *
 * On Windows, file system change events are sometimes lost (bursts of writes, processes killed halfway through a
 * write). When that happens, Vite keeps the old version of a module in memory and serves it forever: the browser
 * sees, for example, a `client.ts` without the export the disk does have.
 * With polling, Vite does not depend on those events: it compares the files every `interval` ms and a lost change is
 * caught on the next round. It only affects dev mode; production builds watch nothing.
 */
export const reliableDevWatch = {
  usePolling: true,
  // Balance between reload speed and CPU: the project is small and 300 ms goes unnoticed while editing.
  interval: 300,
} as const;
