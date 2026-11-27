/**
 * Build queue with "debounce" and no concurrency.
 *
 *  - Several requests in a row (e.g. save and publish within 2 seconds) merge into ONE build.
 *  - Never two builds at once: a request that arrives during a build asks for ONE more when it ends
 *    (the content may have changed after the running build read the posts).
 *  - An error does not stop the queue: it is reported and the next request builds again.
 */
export class BuildQueue {
  private readonly run: () => Promise<void>;
  private readonly debounceMs: number;
  private readonly onError: (error: unknown) => void;

  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private idleWaiters: Array<() => void> = [];

  constructor(run: () => Promise<void>, debounceMs: number, onError: (error: unknown) => void) {
    this.run = run;
    this.debounceMs = debounceMs;
    this.onError = onError;
  }

  get isBusy(): boolean {
    return this.running !== undefined || this.timer !== undefined;
  }

  /** Requests a build. Returns right away; the build runs in the background. */
  request(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.schedule();
  }

  /** Resolves when nothing is building or scheduled (useful for tests and for a clean shutdown). */
  whenIdle(): Promise<void> {
    if (!this.isBusy) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.running = this.execute();
    }, this.debounceMs);
  }

  private async execute(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = undefined;
      if (this.pending) {
        this.pending = false;
        this.schedule();
      } else {
        this.notifyIdle();
      }
    }
  }

  private notifyIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
