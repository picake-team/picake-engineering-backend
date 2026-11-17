import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import * as speakeasy from "speakeasy";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import type { ActAsActor, AuthenticatedUser } from "@apps/backend/modules/auth/types/auth.types";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { REVIEW_STORE_BUSINESS_NO } from "@apps/backend/modules/store/constants/store.constants";
import { OpsAlertService } from "@apps/backend/modules/ops-alert/ops-alert.service";
import {
  ACT_AS_ALLOWED_ADMINS_ENV,
  ACT_AS_ENDED_BY,
  ACT_AS_ERROR_MESSAGES,
  ACT_AS_LIMITS,
  ACT_AS_SELLER_ENTRY_PATH,
} from "@apps/backend/modules/act-as/constants/act-as.constants";
import type {
  ActAsActionItemDto,
  ActAsMeResponseDto,
  ActAsSessionItemDto,
  ExchangeActAsCodeResponseDto,
  StartActAsSessionRequestDto,
  StartActAsSessionResponseDto,
} from "@apps/backend/modules/act-as/dto/act-as.dto";
import { summarizeActAsActions } from "@apps/backend/modules/act-as/utils/act-as-audit.util";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 쉼표 목록 환경값 → 아이디 목록(빈 칸 무시) */
export function parseActAsAllowedAdmins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 운영자가 가게 대신 입력하는 짧은 접속(기획 I-41)의 시작·바꾸기·끝내기·기록 보기.
 *
 * 시작(관리자): 사람 관리자 + 환경값에 적은 관리자 + OTP 다시 확인 + 사유. 심사용 가게·꺼진 판매자는 거절한다.
 * 세션(60분)과 한 번만 쓰는 코드(60초)를 만들고 판매자 화면 주소를 돌려준다. 디스코드 【PICAKE】운영에 알린다.
 * 바꾸기(판매자 화면): 코드를 한 번만 대리 출입증으로 바꾼다 — 출입증을 주소창·관리자 화면에 싣지 않으려는 장치다.
 */
@Injectable()
export class ActAsSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly jwtUtil: JwtUtil,
    private readonly opsAlert: OpsAlertService,
  ) {}

  async start(
    admin: AuthenticatedUser,
    storeId: string,
    dto: StartActAsSessionRequestDto,
  ): Promise<StartActAsSessionResponseDto> {
    // 자동화용 관리자 API 키(AI 루틴)로는 열 수 없다
    if (admin.isApiKey) throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.HUMAN_ONLY);

    const row = await this.prisma.admin.findUnique({
      where: { id: admin.id },
      select: {
        id: true,
        username: true,
        isActive: true,
        approvalStatus: true,
        isTotpEnabled: true,
        totpSecret: true,
      },
    });
    if (!row || !row.isActive || row.approvalStatus !== "APPROVED") {
      throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.ADMIN_NOT_ALLOWED);
    }
    const allowed = parseActAsAllowedAdmins(
      this.configService.get<string>(ACT_AS_ALLOWED_ADMINS_ENV),
    );
    if (!allowed.includes(row.username)) {
      throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.ADMIN_NOT_ALLOWED);
    }
    // 관리자 출입증은 30일 산다 — 새어도 가게 대리 접속까지 열리지 않게 들어갈 때마다 OTP를 다시 받는다
    const otpOk =
      row.isTotpEnabled &&
      !!row.totpSecret &&
      speakeasy.totp.verify({
        secret: row.totpSecret,
        encoding: "base32",
        token: dto.totpCode,
        window: 1,
      });
    if (!otpOk) throw new BadRequestException(AUTH_ERROR_MESSAGES.OTP_CODE_INVALID);

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        businessNo: true,
        sellerId: true,
        seller: { select: { isActive: true } },
      },
    });
    if (!store) throw new NotFoundException(ACT_AS_ERROR_MESSAGES.STORE_NOT_FOUND);
    if (store.businessNo === REVIEW_STORE_BUSINESS_NO) {
      throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.REVIEW_STORE);
    }
    if (!store.seller.isActive) {
      throw new ForbiddenException(ACT_AS_ERROR_MESSAGES.SELLER_INACTIVE);
    }

    const now = new Date();
    const code = randomBytes(32).toString("base64url");
    const session = await this.prisma.adminActAsSession.create({
      data: {
        adminId: row.id,
        adminUsername: row.username.slice(0, 40),
        sellerId: store.sellerId,
        storeId: store.id,
        reason: dto.reason,
        codeHash: sha256(code),
        codeExpiresAt: new Date(now.getTime() + ACT_AS_LIMITS.CODE_SECONDS * 1000),
        startedAt: now,
        expiresAt: new Date(now.getTime() + ACT_AS_LIMITS.SESSION_MINUTES * 60 * 1000),
      },
      select: { id: true, expiresAt: true },
    });

    void this.opsAlert.notifyActAsStarted({
      storeId: store.id,
      storeName: store.name,
      adminUsername: row.username,
      reason: dto.reason,
      startedAt: now,
      expiresAt: session.expiresAt,
    });

    const sellerDomain = (this.configService.get<string>("PUBLIC_SELLER_DOMAIN") ?? "").replace(
      /\/$/,
      "",
    );
    return {
      sessionId: session.id,
      sellerUrl: `${sellerDomain}${ACT_AS_SELLER_ENTRY_PATH}?code=${encodeURIComponent(code)}`,
      expiresAt: session.expiresAt,
    };
  }

  /** 판매자 화면: 한 번만 쓰는 코드(60초)를 대리 출입증으로 바꾼다 */
  async exchange(code: string): Promise<ExchangeActAsCodeResponseDto> {
    const codeHash = sha256(code);
    const now = new Date();
    const session = await this.prisma.adminActAsSession.findUnique({
      where: { codeHash },
      select: {
        id: true,
        sellerId: true,
        storeId: true,
        codeExpiresAt: true,
        expiresAt: true,
        endedAt: true,
      },
    });
    if (
      !session ||
      !session.codeExpiresAt ||
      session.codeExpiresAt.getTime() <= now.getTime() ||
      session.endedAt ||
      session.expiresAt.getTime() <= now.getTime()
    ) {
      throw new BadRequestException(ACT_AS_ERROR_MESSAGES.CODE_INVALID);
    }
    // 같은 코드를 동시에 두 번 보내도 한 번만 바뀐다
    const { count } = await this.prisma.adminActAsSession.updateMany({
      where: { id: session.id, codeHash },
      data: { codeHash: null, codeExpiresAt: null },
    });
    if (count !== 1) throw new BadRequestException(ACT_AS_ERROR_MESSAGES.CODE_INVALID);

    const accessToken = await this.jwtUtil.generateActAsToken(
      { sellerId: session.sellerId, sessionId: session.id },
      (session.expiresAt.getTime() - now.getTime()) / 1000,
    );
    await this.prisma.adminActAsAction.create({
      data: {
        sessionId: session.id,
        method: "POST",
        route: "/seller/act-as/exchange",
        targetId: session.storeId,
        status: 200,
        createdAt: now,
      },
    });
    return { accessToken, storeId: session.storeId, expiresAt: session.expiresAt };
  }

  /** 판매자 화면 위 띠: 가게 이름·끝나는 시각 */
  async me(actor: ActAsActor): Promise<ActAsMeResponseDto> {
    const [session, store] = await Promise.all([
      this.prisma.adminActAsSession.findUnique({
        where: { id: actor.sessionId },
        select: { id: true, expiresAt: true },
      }),
      this.prisma.store.findUnique({ where: { id: actor.storeId }, select: { name: true } }),
    ]);
    if (!session) throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACT_AS_SESSION_ENDED);
    return {
      sessionId: session.id,
      storeId: actor.storeId,
      storeName: store?.name ?? "",
      expiresAt: session.expiresAt,
    };
  }

  /** 판매자 화면 띠의 [끝내기] */
  async endSelf(actor: ActAsActor): Promise<{ ended: true }> {
    await this.prisma.adminActAsSession.updateMany({
      where: { id: actor.sessionId, endedAt: null },
      data: { endedAt: new Date(), endedBy: ACT_AS_ENDED_BY.SELF },
    });
    return { ended: true };
  }

  /** 관리자: 세션 바로 끝내기(다른 탭·다른 관리자 것도) */
  async endByAdmin(sessionId: string, adminId: string): Promise<{ ended: true }> {
    const session = await this.prisma.adminActAsSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException(ACT_AS_ERROR_MESSAGES.SESSION_NOT_FOUND);
    await this.prisma.adminActAsSession.updateMany({
      where: { id: sessionId, endedAt: null },
      data: { endedAt: new Date(), endedBy: ACT_AS_ENDED_BY.admin(adminId) },
    });
    return { ended: true };
  }

  /** 관리자 스토어 상세 "대리 입력 기록": 최근 세션과 무엇을 몇 번 했는지 */
  async listForStore(storeId: string): Promise<ActAsSessionItemDto[]> {
    const sessions = await this.prisma.adminActAsSession.findMany({
      where: { storeId },
      orderBy: { startedAt: "desc" },
      take: ACT_AS_LIMITS.SESSIONS_MAX,
      select: {
        id: true,
        adminUsername: true,
        reason: true,
        startedAt: true,
        expiresAt: true,
        endedAt: true,
        endedBy: true,
        actions: { select: { method: true, route: true, status: true } },
      },
    });
    const now = Date.now();
    return sessions.map(({ actions, ...s }) => {
      const status: ActAsSessionItemDto["status"] = s.endedAt
        ? "ENDED"
        : s.expiresAt.getTime() <= now
          ? "EXPIRED"
          : "ACTIVE";
      return { ...s, status, summary: summarizeActAsActions(actions) };
    });
  }

  async listActions(sessionId: string): Promise<ActAsActionItemDto[]> {
    const session = await this.prisma.adminActAsSession.findUnique({
      where: { id: sessionId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException(ACT_AS_ERROR_MESSAGES.SESSION_NOT_FOUND);
    return await this.prisma.adminActAsAction.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
      take: ACT_AS_LIMITS.ACTIONS_MAX,
      select: {
        id: true,
        method: true,
        route: true,
        targetId: true,
        fields: true,
        status: true,
        createdAt: true,
      },
    });
  }
}
