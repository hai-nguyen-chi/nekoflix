import { getLogger } from '../observability/logger';

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Tên dùng trong log và metric */
  name: string;
  /** % lỗi để mở mạch */
  errorThresholdPercent?: number;
  /** Số request tối thiểu trong cửa sổ trước khi xét mở mạch */
  volumeThreshold?: number;
  /** Độ dài cửa sổ trượt (ms) */
  rollingWindowMs?: number;
  /** Thời gian mở mạch trước khi thử lại (ms) */
  resetTimeoutMs?: number;
}

/**
 * Circuit breaker tối giản.
 *
 * Không có nó: catalog-service chậm -> request dồn ở gateway -> gateway hết
 * connection pool -> CẢ HỆ THỐNG chết vì một service chậm. Đây là kiểu sập
 * lan truyền kinh điển của microservices, và nó không cần service nào *chết*
 * mới xảy ra — chỉ cần chậm.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private openedAt = 0;
  private results: { at: number; ok: boolean }[] = [];
  private halfOpenInFlight = false;

  private readonly errorThresholdPercent: number;
  private readonly volumeThreshold: number;
  private readonly rollingWindowMs: number;
  private readonly resetTimeoutMs: number;

  constructor(private readonly opts: BreakerOptions) {
    this.errorThresholdPercent = opts.errorThresholdPercent ?? 50;
    this.volumeThreshold = opts.volumeThreshold ?? 5;
    this.rollingWindowMs = opts.rollingWindowMs ?? 10_000;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 10_000;
  }

  get currentState(): BreakerState {
    this.refreshState();
    return this.state;
  }

  /**
   * @throws lỗi gốc của `fn`, hoặc `BreakerOpenError` khi mạch đang mở
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.refreshState();

    if (this.state === 'open') {
      throw new BreakerOpenError(this.opts.name);
    }

    // Ở half-open chỉ cho ĐÚNG MỘT request đi thử. Cho cả loạt đi sẽ dội
    // nguyên lưu lượng vào service vừa hồi phục và đánh sập nó lần nữa.
    if (this.state === 'half-open') {
      if (this.halfOpenInFlight) throw new BreakerOpenError(this.opts.name);
      this.halfOpenInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    } finally {
      if (this.state === 'half-open') this.halfOpenInFlight = false;
    }
  }

  private refreshState(): void {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'half-open';
      this.halfOpenInFlight = false;
      getLogger().info({ breaker: this.opts.name }, 'circuit breaker -> half-open');
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.close();
      return;
    }
    this.record(true);
  }

  private onFailure(): void {
    if (this.state === 'half-open') {
      this.open();
      return;
    }
    this.record(false);
    this.evaluate();
  }

  private record(ok: boolean): void {
    const now = Date.now();
    this.results.push({ at: now, ok });
    const cutoff = now - this.rollingWindowMs;
    while (this.results.length && this.results[0]!.at < cutoff) this.results.shift();
  }

  private evaluate(): void {
    if (this.results.length < this.volumeThreshold) return;
    const failures = this.results.filter((r) => !r.ok).length;
    const percent = (failures / this.results.length) * 100;
    if (percent >= this.errorThresholdPercent) this.open();
  }

  private open(): void {
    this.state = 'open';
    this.openedAt = Date.now();
    this.results = [];
    getLogger().warn({ breaker: this.opts.name }, 'circuit breaker -> OPEN');
  }

  private close(): void {
    this.state = 'closed';
    this.results = [];
    getLogger().info({ breaker: this.opts.name }, 'circuit breaker -> closed');
  }
}

export class BreakerOpenError extends Error {
  constructor(public readonly target: string) {
    super(`Circuit breaker đang mở cho "${target}".`);
    this.name = 'BreakerOpenError';
  }
}
