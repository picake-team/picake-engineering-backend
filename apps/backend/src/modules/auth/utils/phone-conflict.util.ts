import { ConflictException } from "@nestjs/common";
import { AUTH_ERROR_MESSAGES } from "@apps/backend/modules/auth/constants/auth.constants";
import type { SocialProvider } from "@apps/backend/modules/auth/types/auth.types";
import { PhoneUtil } from "@apps/backend/modules/auth/utils/phone.util";
import {
  maskDisplayNameForPrivacy,
  maskLoginEmail,
} from "@apps/backend/modules/auth/utils/display-name.util";

/** 가입하려는 번호를 이미 쓰는 계정(손님·사장님 공용 — 사장님은 애플 칸이 없다) */
export interface PhoneOwner {
  name: string | null;
  phone: string;
  googleId?: string | null;
  googleEmail?: string | null;
  kakaoId?: string | null;
  kakaoEmail?: string | null;
  appleId?: string | null;
  appleEmail?: string | null;
  naverId?: string | null;
}

const EXISTS_MESSAGE: Record<SocialProvider, string> = {
  google: AUTH_ERROR_MESSAGES.PHONE_GOOGLE_ACCOUNT_EXISTS,
  kakao: AUTH_ERROR_MESSAGES.PHONE_KAKAO_ACCOUNT_EXISTS,
  apple: AUTH_ERROR_MESSAGES.PHONE_APPLE_ACCOUNT_EXISTS,
  naver: AUTH_ERROR_MESSAGES.PHONE_NAVER_ACCOUNT_EXISTS,
};

function linkedEmail(owner: PhoneOwner, provider: SocialProvider): string | null | undefined {
  if (provider === "google") return owner.googleEmail;
  if (provider === "kakao") return owner.kakaoEmail;
  if (provider === "apple") return owner.appleEmail;
  return null; // 네이버는 이메일을 받지 않는다
}

function isLinked(owner: PhoneOwner, provider: SocialProvider): boolean {
  if (provider === "google") return Boolean(owner.googleId);
  if (provider === "kakao") return Boolean(owner.kakaoId);
  if (provider === "apple") return Boolean(owner.appleId);
  return Boolean(owner.naverId);
}

/**
 * 가입하려는 번호를 이미 쓰는 계정이 있으면 409를 만든다(없으면 null).
 * 그 계정의 로그인 수단을 메시지로("이미 등록된 ○○ 계정") 알리고 이름·번호·이메일은 가려서 준다 —
 * 화면은 "이미 가입한 계정이 있어요"와 그 수단의 로그인 버튼을 보인다.
 * `order`는 메시지를 고르는 순서(한 계정에 소셜이 둘 이상 붙은 드문 경우만 영향). 소셜 연결이 없는 계정(심사용 등)이면 PHONE_ALREADY_EXISTS.
 */
export function phoneTakenConflict(
  owner: PhoneOwner | null | undefined,
  order: readonly SocialProvider[],
): ConflictException | null {
  if (!owner) return null;
  const via = order.find((p) => isLinked(owner, p));
  if (!via) return new ConflictException(AUTH_ERROR_MESSAGES.PHONE_ALREADY_EXISTS);
  return new ConflictException({
    message: EXISTS_MESSAGE[via],
    name: maskDisplayNameForPrivacy(owner.name),
    phone: PhoneUtil.maskPhone(owner.phone),
    email: maskLoginEmail(linkedEmail(owner, via)),
  });
}
