import { logger } from '../utils/logger.js';

export interface JobQueue {
  enqueue(task: () => Promise<void>): void;
}

export class InProcessJobQueue implements JobQueue {
  private readonly waiting: Array<() => Promise<void>> = [];
  private active = 0;

  constructor(private readonly concurrency = 2) {}

  enqueue(task: () => Promise<void>): void {
    this.waiting.push(task);
    this.runNext();
  }

  private runNext(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift();
      if (!task) return;
      this.active += 1;
      void task()
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Background job failed');
        })
        .finally(() => {
          this.active -= 1;
          this.runNext();
        });
    }
  }
}
