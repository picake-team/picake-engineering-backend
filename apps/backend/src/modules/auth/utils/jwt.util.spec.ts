import { ConfigModule } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { AUDIENCE, AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import { JwtPayload } from "@apps/backend/modules/auth/types/auth.types";

import { JwtUtil } from "./jwt.util";

describe("JwtUtil", () => {
  let jwtUtil: JwtUtil;
  let jwtService: JwtService;
  const payload: JwtPayload = { sub: "consumer-id", aud: AUDIENCE.CONSUMER };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        JwtModule.register({ secret: "test-secret" }),
      ],
      providers: [JwtUtil],
    }).compile();

    jwtUtil = moduleRef.get(JwtUtil);
    jwtService = moduleRef.get(JwtService);
  });

  it("액세스·리프레시 토큰 쌍을 발급하고, 각 토큰의 type 클레임이 다르다", async () => {
    const { accessToken, refreshToken } = await jwtUtil.generateTokenPair(payload);

    expect(accessToken).not.toBe(refreshToken);

    const verifiedAccess = await jwtUtil.verifyToken(accessToken);
    const verifiedRefresh = await jwtUtil.verifyToken(refreshToken);
    expect(verifiedAccess.type).toBe("access");
    expect(verifiedRefresh.type).toBe("refresh");
    expect(verifiedAccess.sub).toBe(payload.sub);
    expect(verifiedAccess.aud).toBe(payload.aud);
  });

  it("generateAccessToken은 type=access인 토큰만 발급한다", async () => {
    const accessToken = await jwtUtil.generateAccessToken(payload);
    const verified = await jwtUtil.verifyToken(accessToken);
    expect(verified.type).toBe("access");
  });

  it("generateTotpPendingToken은 type=totp_pending인 토큰을 발급한다", async () => {
    const token = await jwtUtil.generateTotpPendingToken(payload);
    const verified = await jwtUtil.verifyToken(token);
    expect(verified.type).toBe("totp_pending");
  });

  it("변조되거나 잘못된 서명의 토큰은 검증에 실패한다", async () => {
    await expect(jwtUtil.verifyToken("not-a-valid-jwt")).rejects.toThrow();
  });

  describe("가입표(registerToken)", () => {
    const ticket = {
      aud: AUDIENCE.CONSUMER,
      provider: "kakao" as const,
      providerId: "kakao-123",
      email: "user@kakao.com",
    };
    const expected = { aud: AUDIENCE.CONSUMER, provider: "kakao" as const };

    it("만든 가입표를 확인하면 서버가 담은 ID·이메일이 나온다", async () => {
      const token = await jwtUtil.generateRegisterTicket(ticket);
      await expect(jwtUtil.verifyRegisterTicket(token, expected)).resolves.toEqual({
        providerId: "kakao-123",
        email: "user@kakao.com",
      });
      const decoded = await jwtUtil.verifyToken(token);
      expect(decoded.type).toBe("register");
      expect(decoded.exp! - decoded.iat!).toBe(30 * 60);
    });

    it.each([
      ["사장님 가입에 손님 가입표", { aud: AUDIENCE.SELLER, provider: "kakao" as const }],
      ["구글 가입에 카카오 가입표", { aud: AUDIENCE.CONSUMER, provider: "google" as const }],
    ])("%s는 거절한다", async (_, wrong) => {
      const token = await jwtUtil.generateRegisterTicket(ticket);
      await expect(jwtUtil.verifyRegisterTicket(token, wrong)).rejects.toThrow(
        AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID,
      );
    });

    it("로그인 출입증(액세스 토큰)은 가입표로 쓸 수 없다", async () => {
      const access = await jwtUtil.generateAccessToken({
        sub: "kakao-123",
        aud: AUDIENCE.CONSUMER,
      });
      await expect(jwtUtil.verifyRegisterTicket(access, expected)).rejects.toThrow(
        AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID,
      );
    });

    it("다른 열쇠로 서명한 가짜 가입표는 거절한다", async () => {
      const forged = await new JwtService({ secret: "attacker-secret" }).signAsync({
        type: "register",
        ...ticket,
      });
      await expect(jwtUtil.verifyRegisterTicket(forged, expected)).rejects.toThrow(
        AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID,
      );
    });

    it("시간이 지난 가입표는 거절한다", async () => {
      const expired = await jwtService.signAsync(
        { type: "register", ...ticket, exp: Math.floor(Date.now() / 1000) - 1 },
        {},
      );
      await expect(jwtUtil.verifyRegisterTicket(expired, expected)).rejects.toThrow(
        AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID,
      );
    });

    it("ID나 이메일이 빠진 가입표는 거절한다", async () => {
      const noId = await jwtService.signAsync({ type: "register", ...ticket, providerId: "" });
      await expect(jwtUtil.verifyRegisterTicket(noId, expected)).rejects.toThrow(
        AUTH_ERROR_MESSAGES.REGISTER_TICKET_INVALID,
      );
    });
  });
});
