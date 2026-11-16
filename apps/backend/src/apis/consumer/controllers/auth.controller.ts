import { Controller, Post, Body, Get, HttpCode, HttpStatus, Request } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "@apps/backend/modules/auth/auth.service";
import { FindAccountRequestDto } from "@apps/backend/modules/auth/dto/auth-find-account.dto";
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
  AppleRegisterRequestDto,
} from "@apps/backend/modules/auth/dto/auth-apple-oauth.dto";
import {
  SendVerificationCodeRequestDto,
  VerifyPhoneCodeRequestDto,
} from "@apps/backend/modules/auth/dto/auth-phone-verification.dto";
import { ReviewLoginRequestDto } from "@apps/backend/modules/auth/dto/auth-review-login.dto";
import { Auth } from "@apps/backend/modules/auth/decorators/auth.decorator";
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

@ApiTags("[구매자] 인증")
@Controller(`${AUDIENCE.CONSUMER}/auth`)
@Auth({ isPublic: true })
export class ConsumerAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("google/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "구글 로그인 (구매자)",
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
    return await this.authService.consumerGoogleLoginWithCode(authDto);
  }

  @Post("google/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "구글 회원가입 (구매자, 휴대폰 인증 후)",
    description:
      "새로운 구글 사용자를 등록합니다. 로그인 응답의 가입표 registerToken(30분)으로만 가입합니다(지났거나 위조됐으면 400 REGISTER_TICKET_INVALID, 빠졌으면 400 입력 오류). 번호·계정이 이미 있으면 409. 응답에서 accessToken과 refreshToken을 반환합니다. 휴대폰 인증이 완료된 상태여야 합니다. 동일한 구글 ID나 휴대폰 번호가 있으면 중복 에러가 발생합니다.",
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
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_KAKAO_ACCOUNT_EXISTS,
      name: "홍*동",
      phone: "010-****-5678",
    },
  })
  async googleRegisterWithPhone(@Body() registerDto: GoogleRegisterRequestDto) {
    return await this.authService.consumerGoogleRegisterWithPhone(registerDto);
  }

  @Post("kakao/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "카카오 로그인 (구매자)",
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
    return await this.authService.consumerKakaoLoginWithCode(authDto);
  }

  @Post("kakao/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "카카오 회원가입 (구매자, 휴대폰 인증 후)",
    description:
      "새로운 카카오 사용자를 등록합니다. 로그인 응답의 가입표 registerToken(30분)으로만 가입합니다(지났거나 위조됐으면 400 REGISTER_TICKET_INVALID, 빠졌으면 400 입력 오류). 번호·계정이 이미 있으면 409. 응답에서 accessToken과 refreshToken을 반환합니다. 휴대폰 인증이 완료된 상태여야 합니다. 카카오는 useTicketPhone=true면 가입표 안 카카오 번호로 휴대폰 인증 없이 가입하고, 간편가입에서 필수 약관에 동의했으면 약관 칸을 생략할 수 있습니다. 동일한 카카오 ID나 휴대폰 번호가 있으면 중복 에러가 발생합니다.",
  })
  @SwaggerResponse(201, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_KAKAO_ACCOUNT_EXISTS,
      name: "홍*동",
      phone: "010-****-5678",
    },
  })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_GOOGLE_ACCOUNT_EXISTS,
      name: "홍*동",
      phone: "010-****-5678",
    },
  })
  async kakaoRegisterWithPhone(@Body() registerDto: KakaoRegisterRequestDto) {
    return await this.authService.consumerKakaoRegisterWithPhone(registerDto);
  }

  @Post("naver/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "네이버 로그인 (구매자)",
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
    return await this.authService.consumerNaverLoginWithCode(authDto);
  }

  @Post("naver/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "네이버 회원가입 (구매자)",
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
    return await this.authService.consumerNaverRegisterWithPhone(registerDto);
  }

  @Post("apple/login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "애플 로그인 (구매자, web-user 전용)",
    description:
      "프론트엔드에서 받은 Authorization Code로 애플 로그인을 처리합니다. 응답에서 accessToken과 refreshToken을 반환합니다. 400 PHONE_VERIFICATION_REQUIRED 오류가 발생했을 때는 가입표 registerToken(30분, 서버가 확인한 애플 ID·이메일이 들어 있음)을 반환하며, 휴대폰 인증 후 애플 회원가입 API에 registerToken을 보내 회원가입을 처리해야 합니다.",
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
    return await this.authService.consumerAppleLoginWithCode(authDto);
  }

  @Post("apple/register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "애플 회원가입 (구매자, 휴대폰 인증 후)",
    description:
      "새로운 애플 사용자를 등록합니다. 로그인 응답의 가입표 registerToken(30분)으로만 가입합니다(지났거나 위조됐으면 400 REGISTER_TICKET_INVALID, 빠졌으면 400 입력 오류). 번호·계정이 이미 있으면 409. 응답에서 accessToken과 refreshToken을 반환합니다. 휴대폰 인증이 완료된 상태여야 합니다. 동일한 애플 ID나 휴대폰 번호가 있으면 중복 에러가 발생합니다.",
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
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_KAKAO_ACCOUNT_EXISTS,
      name: "홍*동",
      phone: "010-****-5678",
    },
  })
  @SwaggerResponse(409, {
    dataExample: {
      message: AUTH_ERROR_MESSAGES.PHONE_APPLE_ACCOUNT_EXISTS,
      name: "홍*동",
      phone: "010-****-5678",
    },
  })
  async appleRegisterWithPhone(@Body() registerDto: AppleRegisterRequestDto) {
    return await this.authService.consumerAppleRegisterWithPhone(registerDto);
  }

  @Post("find-account")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "계정 찾기 (구매자)",
    description:
      "휴대폰 인증을 `audience: consumer`, `purpose: find_account`로 완료한 뒤 호출합니다.",
  })
  @SwaggerResponse(200, {
    dataExample: {
      loginType: "google",
      loginId: SWAGGER_EXAMPLES.CONSUMER_DATA.googleId,
      loginEmail: SWAGGER_EXAMPLES.CONSUMER_DATA.googleEmail,
    },
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.PHONE_VERIFICATION_REQUIRED),
  })
  @SwaggerResponse(400, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.ACCOUNT_NOT_FOUND_BY_PHONE),
  })
  async findAccount(@Body() dto: FindAccountRequestDto) {
    return await this.authService.findAccountConsumer(dto);
  }

  @Post("send-verification-code")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "휴대폰 인증번호 발송",
    description: "요청의 `audience`는 이 경로에서 `consumer`로 고정됩니다.",
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
      audience: AUDIENCE.CONSUMER,
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
    description: "요청의 `audience`는 이 경로에서 `consumer`로 고정됩니다.",
  })
  @SwaggerResponse(200, {
    dataExample: createMessageObject(AUTH_SUCCESS_MESSAGES.PHONE_VERIFICATION_CONFIRMED),
  })
  async verifyPhoneCode(@Body() verifyCodeDto: VerifyPhoneCodeRequestDto) {
    await this.authService.verifyPhoneCode({
      ...verifyCodeDto,
      audience: AUDIENCE.CONSUMER,
    });
    return createMessageObject(AUTH_SUCCESS_MESSAGES.PHONE_VERIFICATION_CONFIRMED);
  }

  @Post("review-login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })
  @ApiOperation({
    summary: "심사용 로그인 (구매자, App Store/Play 스토어 대응)",
    description:
      "심사 대응용 임시 로그인 경로입니다. 코드는 서버에 하드코딩되어 있으며, 심사용 계정은 최초 호출 시 자동 생성됩니다.",
  })
  @SwaggerResponse(200, { dataExample: SWAGGER_EXAMPLES.TOKEN_RESPONSE })
  @SwaggerResponse(401, {
    dataExample: createMessageObject(AUTH_ERROR_MESSAGES.REVIEW_LOGIN_INVALID_CODE),
  })
  async reviewLogin(@Body() dto: ReviewLoginRequestDto) {
    return await this.authService.consumerReviewLogin(dto);
  }

  @Get("me")
  @Auth({ isPublic: false, audiences: ["consumer"] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "(로그인 필요) 액세스 토큰 유효 확인",
    description:
      "Authorization 헤더의 Access Token을 사용하여 인증된 사용자인지 검사합니다. 가드를 통과하면 `{ available: true }`만 반환합니다.",
  })
  @SwaggerResponse(200, { dataExample: { available: true } })
  @SwaggerAuthResponses()
  async getCurrentUser(@Request() req: { user: JwtVerifiedPayload }) {
    return this.authService.getCurrentUser(req.user);
  }
}
