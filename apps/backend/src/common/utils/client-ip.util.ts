import { isIPv4, isIPv6 } from "node:net";

/**
 * 접속 주소로 횟수를 셀 때 쓰는 키.
 *
 * - IPv4는 주소 그대로. IPv4를 IPv6 모양으로 적은 주소(`::ffff:1.2.3.4`)도 IPv4로 본다
 * - IPv6는 앞 64비트(/64)로 묶는다. 집·휴대폰 한 회선이 보통 /64 하나를 통째로 받아
 *   주소를 바꿔 가며 부르면 주소마다 따로 세게 되기 때문이다
 * - 비었으면 "unknown", 알아볼 수 없는 모양은 그대로
 */
export function ipQuotaKey(ip: string | null | undefined): string {
  // 링크 로컬 주소의 영역 표시(%eth0)는 뗀다
  const addr = (ip ?? "").trim().toLowerCase().split("%")[0];
  if (!addr) return "unknown";
  if (isIPv4(addr)) return addr;
  if (!isIPv6(addr)) return addr;

  const h = expandIpv6(addr);
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join(".");
  }
  return `${h
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(":")}::/64`;
}

/** 줄여 쓴 IPv6(`::`, 끝에 붙은 IPv4)를 16비트 칸 8개로 편다. isIPv6를 통과한 값만 넣는다 */
function expandIpv6(addr: string): number[] {
  let text = addr;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4[1].split(".").map(Number);
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const zeros = text.includes("::") ? 8 - headParts.length - tailParts.length : 0;
  return [...headParts, ...Array<string>(zeros).fill("0"), ...tailParts].map((x) =>
    parseInt(x, 16),
  );
}
