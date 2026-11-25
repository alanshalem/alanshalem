/**
 * Cola de construcciones con "debounce" y sin concurrencia.
 *
 *  - Varios pedidos seguidos (ej: guardar y publicar en 2 segundos) se juntan en UNA construcción.
 *  - Nunca hay dos construcciones a la vez: un pedido que llega mientras se construye pide UNA más al terminar
 *    (el contenido pudo cambiar después de que la construcción en curso leyó los posts).
 *  - Un error no frena la cola: se informa y el siguiente pedido construye de nuevo.
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

  /** Pide una construcción. Retorna enseguida; la construcción ocurre en segundo plano. */
  request(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.schedule();
  }

  /** Se resuelve cuando no hay nada construyéndose ni agendado (útil para tests y para apagar limpio). */
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
