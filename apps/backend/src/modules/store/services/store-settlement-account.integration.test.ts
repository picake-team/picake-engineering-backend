import { describe, expect, it } from "vitest";

import { LikeStoreDetailService } from "@apps/backend/modules/like/services/like-store-detail.service";
import { StoreListService } from "@apps/backend/modules/store/services/store-list.service";
import type { GetStoresRequestDto } from "@apps/backend/modules/store/dto/store-list.dto";
import type { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { getTestPrisma } from "@apps/backend/test/integration/db";
import { createTestSeller, createTestStore } from "@apps/backend/test/integration/factories";

/**
 * 가게 정산 계좌(은행·계좌번호·예금주)는 사장님 본인 화면에만 준다(기획 I-40·P-07).
 * 손님용 가게 정보는 로그인 없이 누구나 부를 수 있어, 예금주가 사장님 본인 이름인 1인 가게의 계좌가 드러났다.
 */
describe("가게 정산 계좌 공개 범위 (integration)", () => {
  it("손님용 가게 상세·목록에는 정산 계좌가 없고, 사장님 본인 조회에는 있다", async () => {
    const prisma = getTestPrisma();
    const service = new StoreListService(prisma, new LikeStoreDetailService(prisma));
    const seller = await createTestSeller(prisma);
    const store = await createTestStore(prisma, seller.id, {
      bankName: "KAKAO_BANK",
      bankAccountNumber: "3333000000000",
      accountHolderName: "김사장",
    });

    const forUser = await service.getStoreByIdForUser(store.id);
    expect(forUser).not.toHaveProperty("bankAccountNumber");
    expect(forUser).not.toHaveProperty("bankName");
    expect(forUser).not.toHaveProperty("accountHolderName");

    const list = await service.getStoresForUser({ page: 1, limit: 50 } as GetStoresRequestDto);
    const inList = list.data.find((s) => s.id === store.id);
    if (inList) expect(inList).not.toHaveProperty("bankAccountNumber");
    expect(JSON.stringify(list.data)).not.toContain("3333000000000");

    const forSeller = await service.getStoreByIdForSeller(store.id, {
      sub: seller.id,
    } as JwtVerifiedPayload);
    expect(forSeller.bankAccountNumber).toBe("3333000000000");
    expect(forSeller.accountHolderName).toBe("김사장");
  });
});
