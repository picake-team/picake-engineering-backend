import { Controller, Post, Body, Get, HttpCode, HttpStatus, Request, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiTags, ApiOperation, ApiConsumes } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "@apps/backend/modules/auth/auth.service";
import { FindAccountRequestDto } from "@apps/backend/modules/auth/dto/auth-find-account.dto";
import { ReviewLoginRequestDto } from "@apps/backend/modules/auth/dto/auth-review-login.dto";
import {
  GoogleLoginRequestDto,
  GoogleRegisterRequestDto,
} from "@apps/backend/modules/auth/dto/auth-google-oauth.dto";
import {
  KakaoLoginRequestDto,
  KakaoRegisterRequestDto,
} from "@apps/backend/modules/auth/dto/auth-kakao-oauth.dto";
import {
  NaverLoginRequestDto,
  NaverRegisterRequestDto,
} from "@apps/backend/modules/auth/dto/auth-naver-oauth.dto";
import {
  AppleLoginRequestDto,
  SellerAppleRegisterRequestDto,
} from "@apps/backend/modules/auth/dto/auth-apple-oauth.dto";
import {
  SendVerificationCodeRequestDto,
  VerifyPhoneCodeRequestDto,
} from "@apps/backend/modules/auth/dto/auth-phone-verification.dto";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
import { AllowActAs } from "@apps/backend/modules/auth/decorators/allow-act-as.decorator";
import { SwaggerResponse } from "@apps/backend/common/decorators/swagger-response.decorator";
import { SwaggerAuthResponses } from "@apps/backend/common/decorators/swagger-auth-responses.decorator";
import { JwtVerifiedPayload } from "@apps/backend/modules/auth/types/auth.types";
import {
  AUTH_ERROR_MESSAGES,
  AUTH_SUCCESS_MESSAGES,
  AUDIENCE,
  SWAGGER_EXAMPLES,
} from "@apps/backend/modules/auth/constants/auth.constants";
import { createMessageObject } from "@apps/backend/common/utils/message.util";

@ApiTags("[판매자] 인증")
@Controller(`${AUDIENCE.SELLER}/auth`)
@Auth({ isPublic: true })
export class SellerAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("google/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "구글 로그인 (판매자)",
    description:
      "프론트엔드에서 받은 Authorization Code로 구글 로그인을 처리합니다. 응답에서 accessToken과 refreshToken을 반환합니다. 400 PHONE_VERIFICATION_REQUIRED 오류가 발생했을 때는 가입표 registerToken(30분, 서버가 확인한 구글 ID·이메일이 들어 있음)을 반환하며, 휴대폰 인증 후 구글 회원가입 API에 registerToken을 보내 회원가입을 처리해야 합니다.",
  })
  @SwaggerResponse(200, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(400, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
      registerToken: SWAGGER_EXAMPLES.REGISTER_TOKEN,
    },
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED),
  })
  @SwaggerResponse(403, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE),
  })
  async googleAuth(@Body() authDto: GoogleLoginRequestDto) {
    return await this.authService.sellerGoogleLoginWithCode(authDto);
  }

  @Post("google/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "구글 회원가입 (판매자, 휴대폰 인증 후)",
    description:
      "새로운 구글 사용자를 등록합니다. 로그인 응답의 가입표 registerToken(30분)으로만 가입합니다(지났거나 위조됐으면 400 REGISTER_TICKET_INVALID, 빠졌으면 400 입력 오류). 번호·계정이 이미 있으면 409. 응답에서 accessToken과 refreshToken을 반환합니다. 휴대폰 인증이 완료된 상태여야 합니다. 동일한 구글 ID나 휴대폰 번호가 있으면 중복 에러가 발생합니다.",
  })
  @SwaggerResponse(201, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_GOOGLE_ACCOUNT_EXISTS,
      name: "김*매",
      phone: "010-****-5432",
    },
  })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_KAKAO_ACCOUNT_EXISTS,
      name: "김*매",
      phone: "010-****-5432",
    },
  })
  async googleRegisterWithPhone(@Body() registerDto: GoogleRegisterRequestDto) {
    return await this.authService.sellerGoogleRegisterWithPhone(registerDto);
  }

  @Post("kakao/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "카카오 로그인 (판매자)",
    description:
      "프론트엔드에서 받은 Authorization Code로 카카오 로그인을 처리합니다. 응답에서 accessToken과 refreshToken을 반환합니다. 400 PHONE_VERIFICATION_REQUIRED 오류가 발생했을 때는 가입표 registerToken(30분, 서버가 확인한 카카오 ID·이메일이 들어 있음)을 반환하며, 휴대폰 인증 후 카카오 회원가입 API에 registerToken을 보내 회원가입을 처리해야 합니다.",
  })
  @SwaggerResponse(200, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(400, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
      registerToken: SWAGGER_EXAMPLES.REGISTER_TOKEN,
    },
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.KAKAO_OAUTH_TOKEN_EXCHANGE_FAILED),
  })
  @SwaggerResponse(403, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE),
  })
  async kakaoAuth(@Body() authDto: KakaoLoginRequestDto) {
    return await this.authService.sellerKakaoLoginWithCode(authDto);
  }

  @Post("kakao/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "카카오 회원가입 (판매자, 휴대폰 인증 후)",
    description:
      "새로운 카카오 사용자를 등록합니다. 로그인 응답의 가입표 registerToken(30분)으로만 가입합니다(지났거나 위조됐으면 400 REGISTER_TICKET_INVALID, 빠졌으면 400 입력 오류). 번호·계정이 이미 있으면 409. 응답에서 accessToken과 refreshToken을 반환합니다. 휴대폰 인증이 완료된 상태여야 합니다. 카카오는 useTicketPhone=true면 가입표 안 카카오 번호로 휴대폰 인증 없이 가입하고, 간편가입에서 필수 약관에 동의했으면 약관 칸을 생략할 수 있습니다. 동일한 카카오 ID나 휴대폰 번호가 있으면 중복 에러가 발생합니다.",
  })
  @SwaggerResponse(201, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_KAKAO_ACCOUNT_EXISTS,
      name: "김*매",
      phone: "010-****-5432",
    },
  })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_GOOGLE_ACCOUNT_EXISTS,
      name: "김*매",
      phone: "010-****-5432",
    },
  })
  async kakaoRegisterWithPhone(@Body() registerDto: KakaoRegisterRequestDto) {
    return await this.authService.sellerKakaoRegisterWithPhone(registerDto);
  }

  @Post("naver/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "네이버 로그인 (판매자)",
    description:
      "프론트엔드에서 받은 Authorization Code와 state로 네이버 로그인을 처리합니다(state는 화면이 로그인 요청 때 만든 값 — 화면이 콜백에서 같은지 먼저 확인). 응답에서 accessToken과 refreshToken을 반환합니다. 400 PHONE_VERIFICATION_REQUIRED일 때는 가입표 registerToken(30분, 서버가 확인한 네이버 회원 식별자와 받은 경우 이름·휴대전화번호가 들어 있음)을 반환하며, 네이버 회원가입 API에 registerToken을 보내 가입합니다.",
  })
  @SwaggerResponse(200, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(400, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
      registerToken: SWAGGER_EXAMPLES.REGISTER_TOKEN,
    },
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.NAVER_OAUTH_TOKEN_EXCHANGE_FAILED),
  })
  @SwaggerResponse(403, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE),
  })
  async naverAuth(@Body() authDto: NaverLoginRequestDto) {
    return await this.authService.sellerNaverLoginWithCode(authDto);
  }

  @Post("naver/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "네이버 회원가입 (판매자)",
    description:
      "새로운 네이버 사용자를 등록합니다. 로그인 응답의 가입표 registerToken(30분)으로만 가입합니다(지났거나 위조됐으면 400 REGISTER_TICKET_INVALID). useTicketPhone=true면 가입표 안 네이버 휴대전화번호로 문자 인증 없이, 아니면 phone + 휴대폰 인증(naver_registration)으로 가입합니다. 약관은 늘 이 요청으로 받습니다(네이버 동의 화면에는 약관을 넣을 수 없음). 같은 네이버 계정이나 휴대폰 번호가 있으면 409.",
  })
  @SwaggerResponse(201, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_NAVER_ACCOUNT_EXISTS,
      name: "홍*동",
      phone: "010-****-5678",
    },
  })
  @SwaggerResponse(409, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.NAVER_ID_ALREADY_EXISTS),
  })
  async naverRegisterWithPhone(@Body() registerDto: NaverRegisterRequestDto) {
    return await this.authService.sellerNaverRegisterWithPhone(registerDto);
  }

  @Post("apple/callback")
  @HttpCode(HttpStatus.SEE_OTHER)
  @ApiConsumes("application/x-www-form-urlencoded")
  @ApiOperation({
    summary: "애플 Return URL (판매자, 애플이 form_post로 부름)",
    description:
      "애플 로그인 화면이 이 주소로 code·state(·처음 한 번 user 이름)를 form_post로 보냅니다. 판매자 웹은 정적 앱이라 서버가 받아 판매자 웹 콜백(`PUBLIC_SELLER_DOMAIN` + `/auth/login/apple?code=&state=&appleName=`, 취소면 `?error=`)으로 303 보냅니다. 토큰 교환은 하지 않습니다(판매자 웹이 apple/login으로 code를 보낼 때 서버가 함). 애플 Services ID에 이 주소(상용·staging)가 Return URL로 등록돼 있어야 합니다.",
  })
  appleCallback(@Body() form: Record<string, unknown>, @Res() res: Response) {
    // 본문은 애플이 정한 모양(code·state·user·id_token·error)이라 DTO 검사 없이 필요한 값만 꺼낸다
    res.redirect(HttpStatus.SEE_OTHER, this.authService.sellerAppleCallbackRedirectUrl(form));
  }

  @Post("apple/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "애플 로그인 (판매자)",
    description:
      "apple/callback이 판매자 웹에 넘긴 Authorization Code로 애플 로그인을 처리합니다(토큰 교환 redirect_uri는 서버 Return URL). 응답에서 accessToken과 refreshToken을 반환합니다. 400 PHONE_VERIFICATION_REQUIRED일 때는 가입표 registerToken(30분, 서버가 확인한 애플 ID·이메일이 들어 있음)을 반환하며, 휴대폰 인증(apple_registration) 후 애플 회원가입 API에 registerToken을 보내 가입합니다.",
  })
  @SwaggerResponse(200, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(400, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED,
      registerToken: SWAGGER_EXAMPLES.REGISTER_TOKEN,
    },
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.APPLE_OAUTH_TOKEN_EXCHANGE_FAILED),
  })
  @SwaggerResponse(403, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE),
  })
  async appleAuth(@Body() authDto: AppleLoginRequestDto) {
    return await this.authService.sellerAppleLoginWithCode(authDto);
  }

  @Post("apple/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "애플 회원가입 (판매자, 휴대폰 인증 후)",
    description:
      "새로운 애플 사용자를 등록합니다. 로그인 응답의 가입표 registerToken(30분)으로만 가입합니다(지났거나 위조됐으면 400 REGISTER_TICKET_INVALID). 휴대폰 인증(apple_registration, audience seller)이 끝나 있어야 합니다. 같은 애플 계정이나 휴대폰 번호가 있으면 409.",
  })
  @SwaggerResponse(201, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_GOOGLE_ACCOUNT_EXISTS,
      name: "홍*동",
      phone: "010-****-5678",
    },
  })
  @SwaggerResponse(409, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.APPLE_ID_ALREADY_EXISTS),
  })
  async appleRegisterWithPhone(@Body() registerDto: SellerAppleRegisterRequestDto) {
    return await this.authService.sellerAppleRegisterWithPhone(registerDto);
  }

  @Post("review-login")
  @HttpCode(HttpStatus.OK)
  // 심사관은 아이폰·아이패드, 탈퇴 확인 뒤 다시 로그인처럼 같은 IP로 여러 번 들어온다(6자리 코드라 20번이어도 맞히기 어려움, 11-26)
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @ApiOperation({
    summary: "심사용 로그인 (판매자 앱 App Store/Play 스토어 심사 대응)",
    description:
      "로그인 화면 로고를 2초 안에 10번 누르면 여는 창(SC-62)에서 부릅니다. 6자리 코드를 서버 환경값 `SELLER_REVIEW_LOGIN_CODE_SHA256`(코드의 SHA-256)과 비교하고, 값이 없으면 항상 401입니다. 맞으면 심사용 사장님 계정으로 로그인하고, 손님 목록에 보이지 않는 심사용 가게와 예시 상품을 없을 때 만들며, 상태별 예시 주문을 처음 상태로 되돌립니다. IP당 1시간에 20번까지.",
  })
  @SwaggerResponse(200, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(401, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.REVIEW_LOGIN_INVALID_CODE),
  })
  @SwaggerResponse(403, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE),
  })
  async reviewLogin(@Body() dto: ReviewLoginRequestDto) {
    return await this.authService.sellerReviewLogin(dto);
  }

  @Post("find-account")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "계정 찾기 (판매자)",
    description:
      "휴대폰 인증을 `audience: seller`, `purpose: find_account`로 완료한 뒤 호출합니다.",
  })
  @SwaggerResponse(200, {
    dataExample: {
      loginType: "google",
      loginId: SWAGGER_EXAMPLES.SELLER_DATA.googleId,
      loginEmail: SWAGGER_EXAMPLES.SELLER_DATA.googleEmail,
    },
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED),
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.ACCOUNT_NOT_FOUND_BY_PHONE),
  })
  async findAccount(@Body() dto: FindAccountRequestDto) {
    return await this.authService.findAccountSeller(dto);
  }

  @Post("send-verification-code")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "휴대폰 인증번호 발송",
    description: "요청의 `audience`는 이 경로에서 `seller`로 고정됩니다.",
  })
  @SwaggerResponse(200, {
    dataExample: {
      message: AUTH_SUCCESS_MESSAGES.PHONE_VERIFICATION_SENT,
      expiresAt: "2026-04-19T12:05:00.000Z",
    },
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.PHONE_INVALID_FORMAT),
  })
  async sendVerificationCode(@Body() sendCodeDto: SendVerificationCodeRequestDto) {
    const { expiresAt } = await this.authService.sendVerificationCode({
      ...sendCodeDto,
      audience: AUDIENCE.SELLER,
    });
    return {
      message: AUTH_SUCCESS_MESSAGES.PHONE_VERIFICATION_SENT,
      expiresAt: expiresAt.toISOString(),
    };
  }

  @Post("verify-phone-code")
  @HttpCode(HttpStatus.OK)
  // 인증번호 맞히기를 막는다(번호마다 5번 틀리면 다시 받기는 서비스에서)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "휴대폰 인증번호 확인",
    description: "요청의 `audience`는 이 경로에서 `seller`로 고정됩니다.",
  })
  @SwaggerResponse(200, {
    dataExample: createMessageObject(AUTH_SUCCESS_MESSAGES.PHONE_VERIFICATION_CONFIRMED),
  })
  async verifyPhoneCode(@Body() verifyCodeDto: VerifyPhoneCodeRequestDto) {
    await this.authService.verifyPhoneCode({
      ...verifyCodeDto,
      audience: AUDIENCE.SELLER,
    });
    return createMessageObject(AUTH_SUCCESS_MESSAGES.PHONE_VERIFICATION_CONFIRMED);
  }

  @AllowActAs()
  @Get("me")
  @Auth({ isPublic: false, audiences: ["seller"] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 액세스 토큰 유효 확인",
    description: "가드를 통과하면 `{ available: true }`만 반환합니다.",
  })
  @SwaggerResponse(200, { dataExample: { available: true } })
  @SwaggerAuthResponses()
  async getCurrentSeller(@Request() req: { user: JwtVerifiedPayload }) {
    return this.authService.getCurrentSeller(req.user);
  }
}
