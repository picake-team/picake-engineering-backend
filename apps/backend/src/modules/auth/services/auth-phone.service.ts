import { Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { PhoneUtil } from "@apps/backend/modules/auth/utils/phone.util";
import {
  AUTH_ERROR_MESSAGES,
  AudienceConst,
  PHONE_VERIFICATION_CODE_EXPIRY_MINUTES,
  PHONE_VERIFICATION_DAILY_MAX,
  PHONE_VERIFICATION_MAX_ATTEMPTS,
  PHONE_VERIFICATION_RESEND_COOLDOWN_MS,
  PhoneVerificationPurpose,
} from "@apps/backend/modules/auth/constants/auth.constants";
import {
  SendVerificationCodeRequestDto,
  VerifyPhoneCodeRequestDto,
} from "@apps/backend/modules/auth/dto/auth-phone-verification.dto";
import { AuthSmsService } from "@apps/backend/modules/auth/services/auth-sms.service";
import { LoggerUtil } from "@apps/backend/common/utils/logger.util";

/** 인증 완료 후 다음 단계(구글 가입·계정 찾기 등)에 사용할 수 있는 유효 시간 */
const VERIFIED_PURPOSE_VALID_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 로그에는 휴대폰 번호를 가려 남긴다(010****1234) */
const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");

/**
 * 휴대폰 인증 (발송·확인·상태 조회)
 */
@Injectable()
export class AuthPhoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authSmsService: AuthSmsService,
    private readonly configService: ConfigService,
  ) {}

  /** 개발 환경 여부 */
  private get isDevelopment(): boolean {
    return this.configService.get<string>("NODE_ENV") === "development";
  }

  /**
   * 인증번호 기록별 틀린 횟수. 번호는 5분 뒤 만료되므로 서버 메모리에 둔다(서버 한 대).
   * 서버를 다시 켜면 비워지지만 그때도 번호마다 최대 5번이라 충분하다
   */
  private readonly failedAttempts = new Map<string, number>();

  private recordFailedAttempt(verificationId: string, count: number) {
    if (this.failedAttempts.size > 5000) this.failedAttempts.clear();
    this.failedAttempts.set(verificationId, count);
  }

  /**
   * 휴대폰 인증번호 발송
   *
   * @param sendCodeDto 휴대폰 번호와 인증 목적
   * @throws BadRequestException 잘못된 휴대폰 번호 형식이거나 재발송 제한에 걸린 경우
   */
  async sendVerificationCode(
    sendCodeDto: SendVerificationCodeRequestDto,
  ): Promise<{ expiresAt: Date }> {
    const { phone, audience, purpose: kind } = sendCodeDto;
    const normalizedPhone = PhoneUtil.normalizePhone(phone);
    const storedPurpose = PhoneUtil.composeStoredPhoneVerificationPurpose(audience, kind);

    // 1. 인증번호 생성
    const verificationCode = PhoneUtil.generateVerificationCode();
    const expiresAt = PhoneUtil.getExpirationTime(PHONE_VERIFICATION_CODE_EXPIRY_MINUTES);

    // 2. 남용 막기: 같은 번호·목적은 30초 뒤에, 한 번호에 24시간 동안 10번까지
    const now = new Date();
    const dayAgo = new Date(now.getTime() - DAY_MS);
    const recentSends = await this.prisma.phoneVerification.findMany({
      where: { phone: normalizedPhone, createdAt: { gte: dayAgo } },
      select: { createdAt: true, purpose: true },
      orderBy: { createdAt: "desc" },
    });
    const lastSamePurpose = recentSends.find((r) => r.purpose === storedPurpose);
    if (
      lastSamePurpose &&
      now.getTime() - lastSamePurpose.createdAt.getTime() < PHONE_VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_RESEND_TOO_SOON);
    }
    if (recentSends.length >= PHONE_VERIFICATION_DAILY_MAX) {
      LoggerUtil.log(`휴대폰 인증번호 하루 한도 - phone: ${maskPhone(normalizedPhone)}`);
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_DAILY_LIMIT);
    }

    // 3. 트랜잭션으로 인증 정보 저장 - PhoneVerification 테이블
    await this.prisma.$transaction(
      async (tx) => {
        // 같은 목적의 이전 미인증 번호는 지우지 않고 만료시킨다(하루 보낸 횟수를 세려고). 확인은 가장 최근 것만 본다
        await tx.phoneVerification.updateMany({
          where: {
            phone: normalizedPhone,
            purpose: storedPurpose,
            isVerified: false,
            expiresAt: { gt: now },
          },
          data: { expiresAt: now },
        });
        // 하루 지난 미인증 기록은 지운다
        await tx.phoneVerification.deleteMany({
          where: { phone: normalizedPhone, isVerified: false, createdAt: { lt: dayAgo } },
        });

        // 새 인증 정보 생성
        await tx.phoneVerification.create({
          data: {
            phone: normalizedPhone,
            verificationCode,
            expiresAt,
            purpose: storedPurpose,
          },
        });
      },
      {
        maxWait: 5000, // 최대 대기 시간 (5초)
        timeout: 10000, // 타임아웃 (10초)
      },
    );

    // 4. SMS 발송 (SOLAPI) — 개발 환경에서는 비용 때문에 발송하지 않음
    if (!this.isDevelopment) {
      await this.authSmsService.sendVerificationCode(normalizedPhone, verificationCode);
    }

    return { expiresAt };
  }

  /**
   * 휴대폰 인증번호 확인
   *
   * @param verifyCodeDto 휴대폰 번호, 인증번호, 인증 목적
   * @throws BadRequestException 인증번호가 잘못되었거나 만료되었거나 시도 횟수를 초과한 경우
   */
  async verifyPhoneCode(verifyCodeDto: VerifyPhoneCodeRequestDto): Promise<void> {
    const { phone, verificationCode, audience, purpose: kind } = verifyCodeDto;
    const normalizedPhone = PhoneUtil.normalizePhone(phone);
    const storedPurpose = PhoneUtil.composeStoredPhoneVerificationPurpose(audience, kind);

    // 개발 환경에서는 인증 통과
    if (this.isDevelopment && verificationCode === "777777") {
      const existingVerification = await this.prisma.phoneVerification.findFirst({
        where: {
          phone: normalizedPhone,
          purpose: storedPurpose,
          isVerified: false, // 인증되지 않은 레코드만 조회
        },
        orderBy: { createdAt: "desc" }, // 가장 최근 순 정렬
      });

      // 인증 정보가 존재하지 않는 경우
      if (!existingVerification) {
        LoggerUtil.log(
          `휴대폰 인증 실패: 인증 정보 없음 - phone: ${maskPhone(normalizedPhone)}, purpose: ${storedPurpose}`,
        );
        throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_FAILED);
      }

      // 2. 만료 시간 확인 - 5분 후 자동 만료
      if (existingVerification.expiresAt < new Date()) {
        LoggerUtil.log(
          `휴대폰 인증 실패: 인증번호 만료 - phone: ${maskPhone(normalizedPhone)}, purpose: ${storedPurpose}, expiresAt: ${existingVerification.expiresAt}`,
        );
        throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_EXPIRED);
      }

      await this.prisma.$transaction(
        async (tx) => {
          await tx.phoneVerification.update({
            where: { id: existingVerification.id },
            data: {
              isVerified: true, // is_verified 플래그로 본인인증 상태 관리
            },
          });
        },
        {
          maxWait: 5000, // 최대 대기 시간 (5초)
          timeout: 10000, // 타임아웃 (10초)
        },
      );
      return;
    }

    // 1. 이 번호·목적의 가장 최근 미인증 기록 하나와만 비교한다(틀린 횟수를 세려고 번호로 찾지 않음)
    const phoneVerification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone: normalizedPhone,
        purpose: storedPurpose,
        isVerified: false, // 인증되지 않은 레코드만 조회
      },
      orderBy: { createdAt: "desc" }, // 가장 최근 순 정렬
    });

    // 인증 정보가 존재하지 않는 경우
    if (!phoneVerification) {
      LoggerUtil.log(
        `휴대폰 인증 실패: 인증 정보 없음 - phone: ${maskPhone(normalizedPhone)}, purpose: ${storedPurpose}`,
      );
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_FAILED);
    }

    // 2. 만료 시간 확인 - 5분 후 자동 만료(다시 받으면 이전 번호는 바로 만료)
    if (phoneVerification.expiresAt < new Date()) {
      LoggerUtil.log(
        `휴대폰 인증 실패: 인증번호 만료 - phone: ${maskPhone(normalizedPhone)}, purpose: ${storedPurpose}`,
      );
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_EXPIRED);
    }

    // 3. 틀린 횟수: 5번 틀리면 이 번호를 만료시키고 다시 받게 한다
    const failed = this.failedAttempts.get(phoneVerification.id) ?? 0;
    if (failed >= PHONE_VERIFICATION_MAX_ATTEMPTS) {
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_TOO_MANY_ATTEMPTS);
    }
    if (phoneVerification.verificationCode !== verificationCode) {
      this.recordFailedAttempt(phoneVerification.id, failed + 1);
      if (failed + 1 >= PHONE_VERIFICATION_MAX_ATTEMPTS) {
        await this.prisma.phoneVerification.update({
          where: { id: phoneVerification.id },
          data: { expiresAt: new Date() },
        });
        LoggerUtil.log(
          `휴대폰 인증 실패: 여러 번 틀림 - phone: ${maskPhone(normalizedPhone)}, purpose: ${storedPurpose}`,
        );
        throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_TOO_MANY_ATTEMPTS);
      }
      throw new BadRequestException(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_FAILED);
    }
    this.failedAttempts.delete(phoneVerification.id);

    // 4. 인증 성공 처리 - 트랜잭션으로 안전하게 처리
    await this.prisma.$transaction(
      async (tx) => {
        // 현재 인증을 완료 상태로 업데이트
        await tx.phoneVerification.update({
          where: { id: phoneVerification.id },
          data: {
            isVerified: true, // is_verified 플래그로 본인인증 상태 관리
          },
        });
      },
      {
        maxWait: 5000, // 최대 대기 시간 (5초)
        timeout: 10000, // 타임아웃 (10초)
      },
    );
  }

  /**
   * 휴대폰 인증 상태 확인
   *
   * `verifyPhoneCode`로 `isVerified: true`가 된 뒤, 그 시점(`updatedAt`)으로부터
   * 1시간 이내에만 유효한 것으로 봅니다 (`VERIFIED_PURPOSE_VALID_MS`와 동일).
   * (코드 입력 단계의 유효성은 `verifyPhoneCode`에서 `expiresAt`으로 검증합니다.)
   *
   * @param phone 휴대폰 번호
   * @param audience 인증 주체 (consumer | seller)
   * @param kind 인증 종류 (`PhoneVerificationPurpose`)
   * @returns 인증 상태 유효 여부
   */
  async checkPhoneVerificationStatus(
    phone: string,
    audience: AudienceConst,
    kind: PhoneVerificationPurpose,
  ): Promise<boolean> {
    const normalizedPhone = PhoneUtil.normalizePhone(phone);
    const validSince = new Date(Date.now() - VERIFIED_PURPOSE_VALID_MS);
    const composed = PhoneUtil.composeStoredPhoneVerificationPurpose(audience, kind);

    const phoneVerification = await this.prisma.phoneVerification.findFirst({
      where: {
        phone: normalizedPhone,
        purpose: composed,
        isVerified: true,
        updatedAt: { gte: validSince },
      },
      orderBy: { updatedAt: "desc" },
    });

    return !!phoneVerification;
  }
}
