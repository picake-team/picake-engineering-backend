/**
 * Sign in with Apple form_post 응답 다루기(판매자 — 손님은 web-user `app/auth/login/apple/route.ts`가 같은 일을 한다).
 */

/** 판매자 웹이 애플 응답을 받는 화면 경로(판매자 웹 `ROUTES.AUTH.APPLE_REDIRECT_URI`와 같게) */
export const SELLER_APPLE_WEB_CALLBACK_PATH = "/auth/login/apple";

/** 주소에 실어 넘길 값의 최대 길이(애플 code는 수백 자, state는 판매자 웹이 만든 32자) */
const MAX_CODE_LENGTH = 2048;
const MAX_STATE_LENGTH = 128;
const MAX_ERROR_LENGTH = 64;

/**
 * 애플이 보내는 `user` 필드에서 표시용 이름(성+이름)을 뽑는다 — 처음 인가 때 한 번만 온다.
 * 형태: `{"name":{"firstName":"길동","lastName":"홍"},"email":"..."}`. 없거나 모양이 다르면 null.
 * (심사 4 — 애플이 이미 준 이름을 다시 적게 하지 않는다. web-user `extractAppleDisplayName`과 같은 규칙)
 */
export function extractAppleDisplayName(userJson: unknown): string | null {
  if (typeof userJson !== "string" || userJson.length === 0 || userJson.length > 2000) return null;
  try {
    const parsed = JSON.parse(userJson) as { name?: { firstName?: unknown; lastName?: unknown } };
    const first = typeof parsed?.name?.firstName === "string" ? parsed.name.firstName : "";
    const last = typeof parsed?.name?.lastName === "string" ? parsed.name.lastName : "";
    const name = `${last}${first}`.trim();
    return name.length > 0 && name.length <= 50 ? name : null;
  } catch {
    return null;
  }
}

function pick(form: Record<string, unknown>, key: string, max: number): string | null {
  const v = form[key];
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/**
 * 애플 form_post 본문(code·state·user 또는 error)을 판매자 웹 콜백 주소로 바꾼다.
 * code·state·이름만 쿼리로 넘기고(토큰 교환은 판매자 웹이 `apple/login`으로 다시 부를 때 서버가 한다),
 * 돌아갈 곳은 서버 설정 `PUBLIC_SELLER_DOMAIN` 하나로 고정한다(본문 값으로 바꿀 수 없음).
 */
export function buildSellerAppleCallbackUrl(sellerBase: string, form: unknown): string {
  const body = (form && typeof form === "object" ? form : {}) as Record<string, unknown>;
  const url = new URL(SELLER_APPLE_WEB_CALLBACK_PATH, sellerBase);
  const code = pick(body, "code", MAX_CODE_LENGTH);
  if (code) {
    url.searchParams.set("code", code);
    const state = pick(body, "state", MAX_STATE_LENGTH);
    if (state) url.searchParams.set("state", state);
    const appleName = extractAppleDisplayName(body.user);
    if (appleName) url.searchParams.set("appleName", appleName);
  } else {
    // 취소(user_cancelled_authorize) 등 — 판매자 웹은 code가 없으면 로그인 화면으로 돌아간다
    url.searchParams.set("error", pick(body, "error", MAX_ERROR_LENGTH) ?? "invalid_request");
  }
  return url.toString();
}
