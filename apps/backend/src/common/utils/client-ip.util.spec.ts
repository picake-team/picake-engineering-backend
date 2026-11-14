import { describe, expect, it } from "vitest";
import { ipQuotaKey } from "@apps/backend/common/utils/client-ip.util";

describe("ipQuotaKey(접속 주소로 셀 때의 키)", () => {
  it("IPv4는 그대로, IPv6 모양으로 적은 IPv4도 IPv4로", () => {
    expect(ipQuotaKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipQuotaKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipQuotaKey("::FFFF:cb00:7107")).toBe("203.0.113.7");
    expect(ipQuotaKey("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("IPv6는 앞 64비트로 묶는다(줄여 쓴 모양·대소문자·앞자리 0이 달라도 같은 키)", () => {
    const key = "2001:db8:1:2::/64";
    expect(ipQuotaKey("2001:db8:1:2::1")).toBe(key);
    expect(ipQuotaKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(key);
    expect(ipQuotaKey("2001:0DB8:0001:0002:0000:0000:0000:0009")).toBe(key);
    expect(ipQuotaKey("2001:db8:1:2:ffff::1.2.3.4")).toBe(key);
    expect(ipQuotaKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    // 다른 /64는 다른 키
    expect(ipQuotaKey("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(ipQuotaKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipQuotaKey("::1")).toBe("0:0:0:0::/64");
  });

  it("비었으면 unknown, 알아볼 수 없는 모양은 그대로", () => {
    expect(ipQuotaKey(undefined)).toBe("unknown");
    expect(ipQuotaKey(null)).toBe("unknown");
    expect(ipQuotaKey("  ")).toBe("unknown");
    expect(ipQuotaKey("not-an-ip")).toBe("not-an-ip");
  });
});
