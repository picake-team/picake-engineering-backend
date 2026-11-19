import {
  STORE_CONTACT_VISIBILITY_SELECT,
  pickContactVisibility,
} from "@apps/backend/modules/store/utils/store-contact-visibility.util";
import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { UpdateStoreRequestDto } from "@apps/backend/modules/store/dto/store-update.dto";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import { StoreOwnershipUtil } from "@apps/backend/modules/store/utils/store-ownership.util";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";
import { StoreBankName } from "@apps/backend/modules/store/constants/store.constants";
import { Prisma } from "@apps/backend/infra/database/prisma/generated/client";
import { sanitizeRefundCancellationPolicyForDb } from "@apps/backend/modules/store/utils/store-refund-cancellation-policy.util";
import { ACT_AS_ERROR_MESSAGES } from "@apps/backend/modules/act-as/constants/act-as.constants";

/**
 * 스토어 수정 서비스
 *
 * 스토어 수정 로직을 담당하는 서비스입니다.
 */
import { SellerStoreNoticeService } from "@apps/backend/modules/notification/services/seller-store-notice.service";

@Injectable()
export class StoreUpdateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeNotice: SellerStoreNoticeService,
  ) {}

  /**
   * 스토어 수정 (판매자용)
   * @param storeId 스토어 ID
   * @param updateStoreDto 수정할 스토어 정보
   * @param user 인증된 사용자 정보
   * @returns 수정된 스토어 ID
   */
  async updateStoreForSeller(
    storeId: string,
    updateStoreDto: UpdateStoreRequestDto,
    user: JwtVerifiedPayload,
  ) {
    // 스토어 소유권 확인
    await StoreOwnershipUtil.verifyStoreOwnership(this.prisma, storeId, user.sub);

    // 운영자 대신 입력 중(기획 I-41)에는 정산 계좌를 바꿀 수 없다 — 손님 입금이 다른 곳으로 가는 가장 큰 위험.
    // 판매자 폼은 계좌 칸을 늘 같이 보내므로 지금 값과 같으면 통과한다
    if (user.actor) {
      await this.assertBankAccountUnchanged(storeId, updateStoreDto);
    }
    // 정산 계좌가 바뀌면 사장님에게 알린다(운영자 11-18) — 저장 전 값과 비교
    const before = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        bankName: true,
        bankAccountNumber: true,
        accountHolderName: true,
        ...STORE_CONTACT_VISIBILITY_SELECT,
      },
    });
    // 손님 연락 채널 "손님에게 보이기"는 사장님만 바꾼다(기획 I-01·P-93, 상품의 손님에게 보이기와 같게).
    // 판매자 폼은 지금 값을 늘 같이 보내므로 같으면 통과하고 쓰지 않는다
    const visibility = pickContactVisibility(updateStoreDto);
    if (user.actor && before) {
      const changed = (Object.keys(visibility) as (keyof typeof visibility)[]).some(
        (key) => visibility[key] !== before[key],
      );
      if (changed) {
        throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.VISIBILITY_OWNER_ONLY);
      }
    }

    // 업데이트할 데이터 준비
    const updateData: {
      logoImageUrl?: string;
      description?: string;
      phoneNumber: string;
      kakaoChannelId?: string;
      instagramId?: string;
      name: string;
      address: string;
      roadAddress: string;
      detailAddress: string;
      zonecode: string;
      latitude: number;
      longitude: number;
      bankAccountNumber?: string;
      bankName?: StoreBankName;
      accountHolderName?: string;
      refundCancellationPolicy: Prisma.InputJsonValue;
      chatInquiryVisible?: boolean;
      kakaoChannelVisible?: boolean;
      instagramVisible?: boolean;
      phoneVisible?: boolean;
    } = {
      // 필수 필드
      name: updateStoreDto.name,
      address: updateStoreDto.address,
      roadAddress: updateStoreDto.roadAddress,
      detailAddress: updateStoreDto.detailAddress,
      zonecode: updateStoreDto.zonecode,
      latitude: updateStoreDto.latitude,
      longitude: updateStoreDto.longitude,
      bankAccountNumber: updateStoreDto.bankAccountNumber.trim(),
      bankName: updateStoreDto.bankName,
      accountHolderName: updateStoreDto.accountHolderName.trim(),
      phoneNumber: updateStoreDto.phoneNumber.trim(),
      refundCancellationPolicy: sanitizeRefundCancellationPolicyForDb(
        updateStoreDto.refundCancellationPolicy,
      ),
    };

    // 대리 입력 중에는 계좌를 아예 쓰지 않는다 — 위 비교와 저장 사이에 사장님이 바꾼 새 계좌를 옛 값으로 덮지 않게
    if (user.actor) {
      delete updateData.bankAccountNumber;
      delete updateData.bankName;
      delete updateData.accountHolderName;
    }

    // 선택적 필드: 값이 제공된 경우에만 업데이트
    if (updateStoreDto.logoImageUrl !== undefined) {
      updateData.logoImageUrl = updateStoreDto.logoImageUrl;
    }
    if (updateStoreDto.description !== undefined) {
      updateData.description = updateStoreDto.description;
    }
    if (updateStoreDto.kakaoChannelId !== undefined) {
      updateData.kakaoChannelId = updateStoreDto.kakaoChannelId.trim();
    }
    if (updateStoreDto.instagramId !== undefined) {
      updateData.instagramId = updateStoreDto.instagramId.trim();
    }
    // 손님에게 보이기(기획 I-01 2026-11-19): 보낸 것만 바꾼다(옛 화면은 보내지 않아 그대로). 대신 입력 중에는 쓰지 않는다
    if (!user.actor) Object.assign(updateData, visibility);

    try {
      // 스토어 수정
      const updatedStore = await this.prisma.store.update({
        where: {
          id: storeId,
        },
        data: updateData,
      });

      const accountChanged =
        !user.actor &&
        !!before &&
        ((before.bankName ?? null) !== (updatedStore.bankName ?? null) ||
          (before.bankAccountNumber ?? "").trim() !==
            (updatedStore.bankAccountNumber ?? "").trim() ||
          (before.accountHolderName ?? "").trim() !==
            (updatedStore.accountHolderName ?? "").trim());
      if (accountChanged && updatedStore.bankAccountNumber) {
        void this.storeNotice.bankAccountChanged({
          sellerId: updatedStore.sellerId,
          storeId: updatedStore.id,
          storeName: updatedStore.name,
          bankName: updatedStore.bankName,
          bankAccountNumber: updatedStore.bankAccountNumber,
        });
      }

      return {
        id: updatedStore.id,
      };
    } catch (error: unknown) {
      LoggerUtil.log(
        `스토어 수정 실패: 트랜잭션 에러 - userId: ${user.sub}, storeId: ${storeId}, error: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async assertBankAccountUnchanged(
    storeId: string,
    dto: Pick<UpdateStoreRequestDto, "bankName" | "bankAccountNumber" | "accountHolderName">,
  ): Promise<void> {
    const current = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { bankName: true, bankAccountNumber: true, accountHolderName: true },
    });
    const same =
      !!current &&
      (current.bankName ?? null) === (dto.bankName ?? null) &&
      (current.bankAccountNumber ?? "").trim() === dto.bankAccountNumber.trim() &&
      (current.accountHolderName ?? "").trim() === dto.accountHolderName.trim();
    if (!same) {
      LoggerUtil.log(`대리 입력 막음: 정산 계좌 바꾸기 - storeId: ${storeId}`);
      throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.BANK_ACCOUNT_LOCKED);
    }
  }
}
