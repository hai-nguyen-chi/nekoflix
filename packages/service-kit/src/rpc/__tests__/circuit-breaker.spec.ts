import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakerOpenError, CircuitBreaker } from '../circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const fail = () => Promise.reject(new Error('boom'));
  const ok = () => Promise.resolve('ok');

  async function trip(breaker: CircuitBreaker, times = 5): Promise<void> {
    for (let i = 0; i < times; i++) {
      await breaker.execute(fail).catch(() => undefined);
    }
  }

  it('bắt đầu ở trạng thái closed và cho request đi qua', async () => {
    const breaker = new CircuitBreaker({ name: 'test' });
    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.currentState).toBe('closed');
  });

  it('chưa đủ volumeThreshold thì không mở mạch dù toàn lỗi', async () => {
    const breaker = new CircuitBreaker({ name: 'test', volumeThreshold: 5 });
    await trip(breaker, 4);
    expect(breaker.currentState).toBe('closed');
  });

  it('mở mạch khi tỉ lệ lỗi vượt ngưỡng', async () => {
    const breaker = new CircuitBreaker({ name: 'test', volumeThreshold: 5 });
    await trip(breaker, 5);
    expect(breaker.currentState).toBe('open');
  });

  it('mạch mở thì CHẶN request, không gọi xuống service', async () => {
    const breaker = new CircuitBreaker({ name: 'test', volumeThreshold: 5 });
    await trip(breaker, 5);

    const downstream = vi.fn(ok);
    await expect(breaker.execute(downstream)).rejects.toBeInstanceOf(BreakerOpenError);
    // Đây mới là điểm mấu chốt: không gọi xuống nữa, nên service đang ngắc
    // ngoải có cơ hội hồi phục thay vì bị dội tiếp lưu lượng.
    expect(downstream).not.toHaveBeenCalled();
  });

  it('chuyển sang half-open sau resetTimeout', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      volumeThreshold: 5,
      resetTimeoutMs: 10_000,
    });
    await trip(breaker, 5);
    expect(breaker.currentState).toBe('open');

    vi.advanceTimersByTime(10_001);
    expect(breaker.currentState).toBe('half-open');
  });

  it('half-open + thành công -> đóng mạch lại', async () => {
    const breaker = new CircuitBreaker({ name: 'test', volumeThreshold: 5, resetTimeoutMs: 1_000 });
    await trip(breaker, 5);
    vi.advanceTimersByTime(1_001);

    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.currentState).toBe('closed');
  });

  it('half-open + thất bại -> mở lại ngay, không chờ đủ ngưỡng', async () => {
    const breaker = new CircuitBreaker({ name: 'test', volumeThreshold: 5, resetTimeoutMs: 1_000 });
    await trip(breaker, 5);
    vi.advanceTimersByTime(1_001);

    await breaker.execute(fail).catch(() => undefined);
    expect(breaker.currentState).toBe('open');
  });

  it('half-open chỉ cho ĐÚNG MỘT request đi thử', async () => {
    const breaker = new CircuitBreaker({ name: 'test', volumeThreshold: 5, resetTimeoutMs: 1_000 });
    await trip(breaker, 5);
    vi.advanceTimersByTime(1_001);

    const downstream = vi.fn(() => new Promise<string>((r) => setTimeout(() => r('ok'), 100)));

    const first = breaker.execute(downstream);
    // Request thứ hai tới khi request thử nghiệm chưa xong -> phải bị chặn.
    // Cho cả loạt đi sẽ dội nguyên lưu lượng vào service vừa hồi phục.
    await expect(breaker.execute(downstream)).rejects.toBeInstanceOf(BreakerOpenError);

    vi.advanceTimersByTime(100);
    await first;
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('bỏ qua lỗi cũ đã rơi ra ngoài cửa sổ trượt', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      volumeThreshold: 5,
      rollingWindowMs: 10_000,
    });

    await trip(breaker, 4);
    vi.advanceTimersByTime(10_001); // 4 lỗi cũ rơi ra ngoài cửa sổ
    await trip(breaker, 4);

    expect(breaker.currentState).toBe('closed');
  });

  it('ném lỗi GỐC của downstream, không nuốt mất', async () => {
    const breaker = new CircuitBreaker({ name: 'test' });
    await expect(breaker.execute(() => Promise.reject(new Error('lỗi gốc')))).rejects.toThrow(
      'lỗi gốc',
    );
  });
});
