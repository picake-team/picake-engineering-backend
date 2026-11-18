import { appendFileSync } from "node:fs";

import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { OrderStatus } from "@apps/backend/modules/order/constants/order.constants";
import { getTestApp } from "@apps/backend/test/e2e/app";
import {
  createTestConsumer,
  createTestOrder,
  createTestProduct,
  createTestSeller,
  createTestStore,
} from "@apps/backend/test/integration/factories";

/**
 * 로그인 없이 부를 수 있는 GET 응답에 개인정보가 실리지 않는지(검토 자동 검사, 11-18).
 * 11-17 검토에서 공개 후기 응답에 주문 전체(예약자·입금자·환불 계좌 칸)가 붙어 나간 것을 찾았다 —
 * 화면이 안 쓰는 칸이라 화면으로는 보이지 않았다. 그래서 길을 손으로 고르지 않고 앱에 등록된 GET 길을
 * 모두 로그인 없이 불러, 200이면 응답 전체에서 ① 개인정보 칸 이름 ② 심어 둔 개인정보 값이 있는지 본다.
 * 모르는 :값을 넣은 길이 500을 내는지도 본다(없는 값은 400·404여야 한다).
 * 새 공개 길이 생기면 저절로 같이 검사된다.
 *
 * 가게 정보(상호·대표자·사업자번호·가게 연락처)는 통신판매 고지라 공개 대상이다(여기서 찾지 않음).
 */

/** 공개 응답에 있으면 안 되는 칸 이름(대소문자 무시, 정확히 같은 이름) */
const PII_KEYS = [
  "phone",
  "reservationPhone",
  "reservationContactName",
  "depositorName",
  "bankAccountNumber",
  "accountHolderName",
  "refundBankName",
  "refundBankAccountNumber",
  "refundAccountHolderName",
  "email",
  "googleEmail",
  "kakaoEmail",
  "appleEmail",
  "naverEmail",
  "googleId",
  "kakaoId",
  "appleId",
  "naverId",
  "appleRefreshToken",
  "naverRefreshToken",
  "withdrawReason",
].map((k) => k.toLowerCase());

/** 심어 두는 값(어느 칸 이름으로든 나오면 안 됨) */
const MARK = {
  sellerPhone: "01077770001",
  consumerPhone: "01077770002",
  consumerRealName: "실명표식손님",
  storeAccount: "9990001112223",
  storeHolder: "예금주표식",
  reservationPhone: "01077770003",
  reservationName: "예약자표식",
  depositor: "입금자표식",
  refundAccount: "8880001112223",
  refundHolder: "환불예금주표식",
};

function findKeys(value: unknown, path = "$", out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v, i) => findKeys(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (PII_KEYS.includes(k.toLowerCase()) && v !== null && v !== "" && v !== undefined)
        out.push(`${path}.${k}`);
      findKeys(v, `${path}.${k}`, out);
    }
  }
  return out;
}

/** 앱에 등록된 GET 길(전역 prefix 포함) */
function listGetRoutes(app: INestApplication): string[] {
  const instance = app.getHttpAdapter().getInstance();
  const stack = instance?._router?.stack ?? instance?.router?.stack ?? [];
  const paths = stack
    .filter((l: any) => l.route?.path && l.route.methods?.get)
    .map((l: any) => String(l.route.path));
  return [...new Set<string>(paths)];
}

describe("로그인 없는 GET 응답에 개인정보가 없고 500이 나지 않는다 (e2e)", () => {
  it("모든 공개 GET 길을 심어 둔 데이터로 불러 개인정보 칸·값이 없는지 본다", async () => {
    const app = getTestApp();
    const prisma = app.get(PrismaService);
    const server = app.getHttpServer();

    const seller = await createTestSeller(prisma, { phone: MARK.sellerPhone });
    const store = await createTestStore(prisma, seller.id, {
      bankName: "KB_KOOKMIN",
      bankAccountNumber: MARK.storeAccount,
      accountHolderName: MARK.storeHolder,
    });
    const product = await createTestProduct(prisma, store.id);
    const consumer = await createTestConsumer(prisma, {
      phone: MARK.consumerPhone,
      name: MARK.consumerRealName,
      nickname: "닉네임",
    });
    const order = await createTestOrder(
      prisma,
      { consumerId: consumer.id, productId: product.id, storeId: store.id },
      {
        orderStatus: OrderStatus.PICKUP_COMPLETED,
        reservationPhone: MARK.reservationPhone,
        reservationContactName: MARK.reservationName,
        depositorName: MARK.depositor,
        refundBankName: "SHINHAN",
        refundBankAccountNumber: MARK.refundAccount,
        refundAccountHolderName: MARK.refundHolder,
      },
    );
    const review = await prisma.productReview.create({
      data: {
        productId: product.id,
        consumerId: consumer.id,
        orderId: order.id,
        rating: 5,
        content: "맛있어요",
      },
    });

    // 길 안의 :이름 채우기(모르는 이름은 아무 값 — 404면 건너뜀)
    const fill = (p: string) =>
      p.replace(/:(\w+)/g, (_, name: string, offset: number, whole: string) => {
        const before = whole.slice(0, offset);
        const n = name.toLowerCase();
        if (n === "storeid" || (n === "id" && /\/stores?\/$/.test(before))) return store.id;
        if (n === "productid" || (n === "id" && /\/products?\/$/.test(before))) return product.id;
        if (n === "reviewid" || (n === "id" && /\/reviews?\/$/.test(before))) return review.id;
        if (n === "orderid" || (n === "id" && /\/orders?\/$/.test(before))) return order.id;
        if (n === "sellerid") return seller.id;
        if (n === "consumerid") return consumer.id;
        return "x";
      });

    const routes = listGetRoutes(app);
    expect(routes.length).toBeGreaterThan(20); // 길을 못 읽으면 검사가 빈 채로 통과하지 않게

    const checked: string[] = [];
    const problems: string[] = [];
    for (const route of routes) {
      const url = fill(route);
      let res = await request(server).get(url);
      // 목록 길은 쪽 번호·정렬이 있어야 한다(없으면 400) — 붙여서 다시
      for (const query of ["page=1&limit=20&sortBy=latest", "page=1&limit=20"]) {
        if (res.status !== 400) break;
        res = await request(server).get(`${url}?${query}`);
      }
      // PII_DEBUG=<파일>이면 어떤 길을 어떤 상태로 봤는지 적는다(검사가 빈 채로 통과하지 않는지 볼 때)
      if (process.env.PII_DEBUG) appendFileSync(process.env.PII_DEBUG, `${res.status} ${url}\n`);
      // 이상한 값을 넣어도 서버 오류(500)가 아니라 400·404여야 한다(11-18: 없는 약관 종류가 500이었음)
      if (res.status >= 500) problems.push(`${route} → ${res.status}`);
      if (res.status !== 200) continue; // 로그인이 필요하거나(401·403) 없는 값(400·404)
      checked.push(route);
      for (const key of findKeys(res.body)) problems.push(`${route} → 칸 ${key}`);
      const text = JSON.stringify(res.body);
      for (const [what, value] of Object.entries(MARK))
        if (text.includes(value)) problems.push(`${route} → 값 ${what}`);
    }

    // 공개 길이 실제로 검사됐는지(가게·상품·후기 길은 늘 공개)
    expect(checked.some((r) => r.includes("/store/"))).toBe(true);
    expect(checked.some((r) => r.includes("/products/"))).toBe(true);
    expect(checked.some((r) => r.includes("/review/"))).toBe(true);
    expect(problems).toEqual([]);
  });
});
