import { Injectable } from "@nestjs/common";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { ADMIN_CONFIG_ID } from "@apps/backend/modules/admin-management/constants/admin-management.constants";
import {
  AdminConfigResponseDto,
  UpdateAdminConfigDto,
} from "@apps/backend/modules/admin-management/dto/admin-management-config.dto";

/**
 * 관리자 가입 설정(AdminConfig) 서비스
 */
@Injectable()
export class AdminConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 가입 설정 조회 — Row가 없으면 requireApproval=true(승인 필요)로 만든다(upsertDefault). 2026-05 migration이 넣은 행은 false였으니
   * 상용 값은 picake-hq 점검 스크립트(prod-admin-check.sh)로 확인한다(11-16 검토 — 주석이 반대로 적혀 있었다)
   */
  async getConfig(): Promise<AdminConfigResponseDto> {
    const config = await this.upsertDefault();
    return this.toResponse(config);
  }

  /**
   * 가입 설정 수정
   */
  async updateConfig(dto: UpdateAdminConfigDto): Promise<AdminConfigResponseDto> {
    const config = await this.prisma.adminConfig.upsert({
      where: { id: ADMIN_CONFIG_ID },
      create: { id: ADMIN_CONFIG_ID, requireApproval: dto.requireApproval },
      update: { requireApproval: dto.requireApproval },
    });
    return this.toResponse(config);
  }

  /**
   * 회원가입 시 승인 정책 조회
   */
  async getRequireApproval(): Promise<boolean> {
    const config = await this.upsertDefault();
    return config.requireApproval;
  }

  private async upsertDefault() {
    return this.prisma.adminConfig.upsert({
      where: { id: ADMIN_CONFIG_ID },
      // 설정 행이 없으면 "승인 필요"로 만든다(가입 API가 공개라 꺼진 채로 시작하면 누구나 바로 관리자가 된다)
      create: { id: ADMIN_CONFIG_ID, requireApproval: true },
      update: {},
    });
  }

  private toResponse(config: {
    requireApproval: boolean;
    updatedAt: Date;
  }): AdminConfigResponseDto {
    return { requireApproval: config.requireApproval, updatedAt: config.updatedAt };
  }
}
