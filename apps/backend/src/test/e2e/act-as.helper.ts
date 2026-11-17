import { randomBytes } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import * as speakeasy from "speakeasy";

import { PrismaService } from "@apps/backend/infra/database/prisma.service";
import { ACT_AS_ALLOWED_ADMINS_ENV } from "@apps/backend/modules/act-as/constants/act-as.constants";
import { AUDIENCE } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtUtil } from "@apps/backend/modules/auth/utils/jwt.util";
import { createTestSeller, createTestStore } from "@apps/backend/test/integration/factories";

/**
 * 운영자 대신 입력(기획 I-41) e2e 준비: OTP를 켠 관리자, 판매자·스토어, 관리자·사장님·대리 출입증.
 * 대리 출입증은 세션 행을 직접 만들고 서명한다(들어오기 코드 바꾸기는 분당 5번이라 그 경로를 따로 본다).
 */
export async function setupActAs(app: INestApplication, opts: { allowAdmin?: boolean } = {}) {
  const prisma = app.get(PrismaService);
  const jwtUtil = app.get(JwtUtil);

  const totpSecret = speakeasy.generateSecret().base32;
  const admin = await prisma.admin.create({
    data: {
      username: `ops_${randomBytes(4).toString("hex")}`,
      passwordHash: "x",
      totpSecret,
      isTotpEnabled: true,
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
    },
  });
  process.env[ACT_AS_ALLOWED_ADMINS_ENV] =
    opts.allowAdmin === false ? "" : `other,${admin.username}`;

  const seller = await createTestSeller(prisma);
  const store = await createTestStore(prisma, seller.id, {
    name: "구름 케이크",
    bankName: "KAKAO_BANK",
    bankAccountNumber: "3333000000000",
    accountHolderName: "김사장",
  });

  const adminAuth = `Bearer ${await jwtUtil.generateAccessToken({ sub: admin.id, aud: AUDIENCE.ADMIN })}`;
  const sellerAuth = `Bearer ${await jwtUtil.generateAccessToken({ sub: seller.id, aud: AUDIENCE.SELLER })}`;
  const otp = () => speakeasy.totp({ secret: totpSecret, encoding: "base32" });

  /** 세션 행 + 대리 출입증 */
  async function actAs(overrides: { storeId?: string; expiresAt?: Date } = {}) {
    const now = new Date();
    const session = await prisma.adminActAsSession.create({
      data: {
        adminId: admin.id,
        adminUsername: admin.username,
        sellerId: seller.id,
        storeId: overrides.storeId ?? store.id,
        reason: "테스트 대리 입력",
        startedAt: now,
        expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 60 * 60 * 1000),
      },
    });
    const token = await jwtUtil.generateActAsToken(
      { sellerId: seller.id, sessionId: session.id },
      3600,
    );
    return { session, auth: `Bearer ${token}` };
  }

  return { prisma, jwtUtil, admin, seller, store, adminAuth, sellerAuth, otp, actAs };
}
