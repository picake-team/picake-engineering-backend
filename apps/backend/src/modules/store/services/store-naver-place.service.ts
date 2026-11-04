import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { StoreOwnershipUtil } from "@apps/backend/modules/store/utils/store-ownership.util";
import { NaverPlaceService } from "@apps/backend/modules/naver-place/naver-place.service";
import { NaverPlacePreviewResponseDto } from "@apps/backend/modules/naver-place/dto/naver-place-preview.dto";

/**
 * 스토어 네이버 플레이스 연결 서비스
 *
 * 연결은 "어느 네이버 매장 정보를 가져올지" 정해 두는 것이다. 매장 소유를 인증하지 않으며,
 * 연결하거나 끊어도 스토어 정보는 바뀌지 않는다(가져온 값은 판매자가 골라 저장한다).
 */
@Injectable()
export class StoreNaverPlaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly naverPlaceService: NaverPlaceService,
  ) {}

  /**
   * 스토어에 네이버 플레이스를 연결합니다. 이미 연결돼 있으면 새 플레이스로 바꿉니다.
   * 네이버에서 매장을 다시 확인한 뒤 저장하고, 확인한 매장 정보를 돌려줍니다.
   */
  async connectForSeller(
    storeId: string,
    placeId: string,
    user: JwtVerifiedPayload,
  ): Promise<NaverPlacePreviewResponseDto> {
    await StoreOwnershipUtil.verifyStoreOwnership(this.prisma, storeId, user.sub);

    const preview = await this.naverPlaceService.preview(placeId);

    await this.prisma.store.update({
      where: { id: storeId },
      data: { naverPlaceId: preview.placeId, naverPlaceConnectedAt: new Date() },
    });

    return preview;
  }

  /**
   * 스토어의 네이버 플레이스 연결을 끊습니다. 스토어 정보는 그대로 둡니다.
   */
  async disconnectForSeller(storeId: string, user: JwtVerifiedPayload): Promise<{ id: string }> {
    await StoreOwnershipUtil.verifyStoreOwnership(this.prisma, storeId, user.sub);

    await this.prisma.store.update({
      where: { id: storeId },
      data: { naverPlaceId: null, naverPlaceConnectedAt: null },
    });

    return { id: storeId };
  }
}
