import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiExtraModels } from "@nestjs/swagger";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { PaginationMetaResponseDto } from "@apps/backend/common/dto/pagination-response.dto";
import { AUDIENCE, AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { AuthenticatedUser } from "@apps/backend/modules/auth/types/auth.types";
import { AdminManagementService } from "@apps/backend/modules/admin-management/services/admin-management.service";
import {
  AdminAccountItemResponseDto,
  AdminAccountListQueryDto,
  AdminAccountListResponseDto,
  UpdateAdminApprovalDto,
} from "@apps/backend/modules/admin-management/dto/admin-management-account.dto";
import {
  AdminConfigResponseDto,
  UpdateAdminConfigDto,
} from "@apps/backend/modules/admin-management/dto/admin-management-config.dto";

/**
 * 관리자 계정 관리 컨트롤러
 *
 * 가입 설정·가입 승인을 바꾸는 것은 사람 관리자 로그인(JWT)으로만 한다. API 키로 열어 두면 키가 새었을 때
 * 승인 설정을 끄거나 스스로 가입한 계정을 승인해 사람 관리자가 될 수 있다(API 키 관리와 같은 이유, 2026-11-15 검토).
 * 조회는 운영 자동화가 설정을 확인할 수 있게 API 키도 허용한다.
 */
@ApiTags("[관리자] 계정 관리")
@ApiExtraModels(
  AdminConfigResponseDto,
  AdminAccountItemResponseDto,
  AdminAccountListResponseDto,
  PaginationMetaResponseDto,
  UpdateAdminConfigDto,
  UpdateAdminApprovalDto,
  AdminAccountListQueryDto,
)
@Controller(`${AUDIENCE.ADMIN}/admin-management`)
@Auth({ isPublic: false, audiences: [AUDIENCE.ADMIN] })
export class AdminManagementController {
  constructor(private readonly adminManagementService: AdminManagementService) {}

  private assertHumanAdmin(user: AuthenticatedUser) {
    if (user.isApiKey) {
      throw new ForbiddenException(AUTH_ERROR_MESSAGES.ADMIN_ACCOUNT_MANAGEMENT_HUMAN_ONLY);
    }
  }

  @Get("config")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 관리자 가입 설정 조회" })
  @SwaggerResponse(200, { dataDto: AdminConfigResponseDto })
  @SwaggerAuthResponses()
  async getConfig() {
    return await this.adminManagementService.getConfig();
  }

  @Patch("config")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 관리자 가입 설정 수정",
    description:
      "requireApproval: true이면 가입 후 기존 관리자 승인이 필요합니다. false이면 가입 즉시 로그인 가능합니다.",
  })
  @SwaggerResponse(200, { dataDto: AdminConfigResponseDto })
  @SwaggerAuthResponses()
  async updateConfig(
    @Request() req: { user: AuthenticatedUser },
    @Body() dto: UpdateAdminConfigDto,
  ) {
    this.assertHumanAdmin(req.user);
    return await this.adminManagementService.updateConfig(dto);
  }

  @Get("requests")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "(로그인 필요) 관리자 가입 신청 내역 조회 (PENDING 상태)" })
  @SwaggerResponse(200, { dataDto: AdminAccountListResponseDto })
  @SwaggerAuthResponses()
  async listRequests(@Query() query: AdminAccountListQueryDto) {
    return await this.adminManagementService.listRequests(query);
  }

  @Patch("requests/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 가입 신청 승인 또는 거절",
    description: "approvalStatus를 APPROVED 또는 REJECTED로 변경합니다.",
  })
  @SwaggerResponse(200, { dataDto: AdminAccountItemResponseDto })
  @SwaggerAuthResponses()
  async updateApproval(
    @Request() req: { user: AuthenticatedUser },
    @Param("id") id: string,
    @Body() dto: UpdateAdminApprovalDto,
  ) {
    this.assertHumanAdmin(req.user);
    return await this.adminManagementService.updateApproval(id, dto);
  }

  @Get("accounts")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 관리자 계정 목록 조회",
    description: "approvalStatus 쿼리로 상태 필터링 가능. 미입력 시 전체 조회.",
  })
  @SwaggerResponse(200, { dataDto: AdminAccountListResponseDto })
  @SwaggerAuthResponses()
  async listAccounts(@Query() query: AdminAccountListQueryDto) {
    return await this.adminManagementService.listAccounts(query);
  }
}
