import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { BusinessService } from "@apps/backend/modules/business/business.service";
import { CreateStoreRequestDto } from "@apps/backend/modules/store/dto/store-create.dto";
import { STORE_ERROR_MESSAGES } from "@apps/backend/modules/store/constants/store.constants";
import { BUSINESS_ERROR_MESSAGES } from "@apps/backend/modules/business/constants/business.contants";

import { StoreCreateService } from "./store-create.service";

const BUSINESS = {
  b_no: "123-45-67890",
  start_dt: "20200101",
  p_nm: "홍길동",
  b_nm: "달콤케이크",
  b_sector: "제조업",
  b_type: "제과점",
};

const buildDto = (over: Partial<CreateStoreRequestDto> = {}) =>
  ({
    businessValidation: BUSINESS,
    name: "달콤케이크",
    phoneNumber: "010-1234-5678",
    bankAccountNumber: "110-302-1234567",
    bankName: "KAKAO_BANK",
    accountHolderName: "홍길동",
    address: "서울특별시 강남구 역삼동 1",
    roadAddress: "서울특별시 강남구 테헤란로 1",
    detailAddress: "1층",
    zonecode: "06234",
    latitude: 37.5,
    longitude: 127.03,
    refundCancellationPolicy: {
      rules: [{ daysBeforePickup: 1, refundDescription: "결제액의 50% 환불" }],
    },
    ...over,
  }) as unknown as CreateStoreRequestDto;

describe("StoreCreateService 통신판매업 정보(선택)", () => {
  const prismaMock = mockDeep<PrismaService>();
  const businessServiceMock = {
    verifyBusinessRegistration: vi.fn(),
    getOnlineTradingCompanyDetail: vi.fn(),
  };
  const txStoreMock = { create: vi.fn(), findFirst: vi.fn() };
  const txExecuteRaw = vi.fn();
  const txSellerMock = { update: vi.fn() };
  let service: StoreCreateService;

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((fn: any) =>
      fn({ store: txStoreMock, seller: txSellerMock, $executeRaw: txExecuteRaw } as any),
    );
    txStoreMock.create.mockResolvedValue({ id: "store-1" });
    txStoreMock.findFirst.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StoreCreateService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BusinessService, useValue: businessServiceMock },
      ],
    }).compile();
    service = moduleRef.get(StoreCreateService);
  });

  it("통신판매업 정보 없이도 만들고, 신고번호는 null로 저장한다", async () => {
    await expect(service.createStoreForSeller("seller-1", buildDto())).resolves.toEqual({
      id: "store-1",
    });
    expect(businessServiceMock.verifyBusinessRegistration).toHaveBeenCalled();
    expect(businessServiceMock.getOnlineTradingCompanyDetail).not.toHaveBeenCalled();
    expect(txStoreMock.create.mock.calls[0][0].data.permissionManagementNumber).toBeNull();
  });

  it("통신판매업 정보를 보내면 공정위 조회로 확인하고 신고번호를 저장한다", async () => {
    const detail = { brno: "1234567890", prmmiMnno: "2026-서울강남-0001" };
    await service.createStoreForSeller(
      "seller-1",
      buildDto({ onlineTradingCompanyDetail: detail } as Partial<CreateStoreRequestDto>),
    );
    expect(businessServiceMock.getOnlineTradingCompanyDetail).toHaveBeenCalledWith(detail);
    expect(txStoreMock.create.mock.calls[0][0].data.permissionManagementNumber).toBe(
      "2026-서울강남-0001",
    );
  });

  it("보낸 통신판매업 정보의 사업자번호가 1단계와 다르면 막는다", async () => {
    const detail = { brno: "999-99-99999", prmmiMnno: "2026-서울강남-0001" };
    await expect(
      service.createStoreForSeller(
        "seller-1",
        buildDto({ onlineTradingCompanyDetail: detail } as Partial<CreateStoreRequestDto>),
      ),
    ).rejects.toThrow(STORE_ERROR_MESSAGES.BUSINESS_REGISTRATION_NUMBER_MISMATCH);
    expect(txStoreMock.create).not.toHaveBeenCalled();
  });

  it("같은 사업자등록번호 스토어가 그사이 생겼으면(등록 두 번 누름) 막는다", async () => {
    txStoreMock.findFirst.mockResolvedValue({ id: "store-0" });
    await expect(service.createStoreForSeller("seller-1", buildDto())).rejects.toThrow(
      BUSINESS_ERROR_MESSAGES.BUSINESS_REGISTRATION_NUMBER_ALREADY_EXISTS,
    );
    expect(txExecuteRaw).toHaveBeenCalled();
    expect(txStoreMock.create).not.toHaveBeenCalled();
  });
});
