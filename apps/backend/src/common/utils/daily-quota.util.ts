/**
 * 하루(한국 시간) 사용 횟수 제한. 서버 메모리에 두어 서버를 다시 켜면 처음부터 센다
 * (AI 기능의 비용을 막는 용도라 정확한 회계가 필요하지 않다 — 상세 설명 AI 초안과 같은 방식).
 */
export class DailyQuota {
  private readonly used = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private today(): string {
    return new Date(this.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  }

  /** 한 번 쓴다. 오늘 다 썼으면 false(세지 않음) */
  tryConsume(key: string): boolean {
    const day = this.today();
    const dayKey = `${key}:${day}`;
    const count = this.used.get(dayKey) ?? 0;
    if (count >= this.limit) return false;
    // 지난 날짜 기록은 지운다
    for (const k of this.used.keys()) {
      if (!k.endsWith(`:${day}`)) this.used.delete(k);
    }
    this.used.set(dayKey, count + 1);
    return true;
  }

  /** 우리 쪽 문제로 쓰지 못했으면 되돌린다 */
  refund(key: string): void {
    const dayKey = `${key}:${this.today()}`;
    const count = this.used.get(dayKey) ?? 0;
    if (count <= 1) this.used.delete(dayKey);
    else this.used.set(dayKey, count - 1);
  }
}
