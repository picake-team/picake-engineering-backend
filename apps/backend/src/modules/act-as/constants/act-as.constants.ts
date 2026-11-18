/**
 * 운영자가 가게 대신 입력하는 짧은 접속(기획 I-41).
 * 관리자 스토어 상세에서 OTP를 다시 넣고 사유를 적으면, 그 가게 판매자 화면을 60분 동안 쓴다(연장 없음).
 * 판매자 경로는 `@AllowActAs()`를 붙인 것만 열리고, 들어간 동안의 요청은 모두 `admin_act_as_actions`에 남는다.
 */
export const ACT_AS_LIMITS = {
  /** 한 번 들어가면 이만큼(분). 끝나면 다시 들어간다 */
  SESSION_MINUTES: 60,
  /** 관리자 화면 → 판매자 화면으로 넘기는 한 번만 쓰는 코드가 사는 시간(초) */
  CODE_SECONDS: 60,
  REASON_MIN: 2,
  REASON_MAX: 200,
  /** 관리자 화면 기록 목록 */
  SESSIONS_MAX: 50,
  ACTIONS_MAX: 500,
  /** 기록에 남기는 보낸 칸 이름 수·길이 */
  FIELDS_MAX: 40,
  FIELD_NAME_MAX: 60,
  /** 세션에 남기는 관리자 아이디 칸 길이(DB VARCHAR 40). 더 길면 시작하지 않는다(잘리면 매 요청 허용 목록과 달라 401) */
  ADMIN_USERNAME_MAX: 40,
  /** 들어가기 OTP: 관리자마다 이 시간(분) 안에 이만큼 틀리면 같은 시간 동안 막고 운영 알림 */
  OTP_FAIL_WINDOW_MINUTES: 15,
  OTP_FAIL_MAX: 5,
  /** 한 번 쓴 OTP는 이 시간(초) 동안 다시 받지 않는다(window 1 = 앞뒤 30초까지 맞는 코드) */
  OTP_REUSE_SECONDS: 90,
} as const;

/** 들어갈 수 있는 관리자 아이디(쉼표 목록). 비어 있으면 아무도 못 들어간다 */
export const ACT_AS_ALLOWED_ADMINS_ENV = "ADMIN_ACT_AS_USERNAMES";

/** 판매자 화면의 들어오기 주소(코드는 # 뒤에 — 서버·접근 기록에 가지 않게, 토큰은 주소창에 싣지 않는다) */
export const ACT_AS_SELLER_ENTRY_PATH = "/act-as";

export const ACT_AS_ERROR_MESSAGES = {
  HUMAN_ONLY: "가게 대신 입력은 사람 관리자 로그인으로만 시작할 수 있어요.",
  ADMIN_NOT_ALLOWED: "가게 대신 입력을 쓸 수 있는 관리자가 아니에요.",
  STORE_NOT_FOUND: "스토어를 찾을 수 없어요.",
  SELLER_INACTIVE: "꺼진 판매자 계정이라 들어갈 수 없어요.",
  REVIEW_STORE: "심사용 가게에는 들어갈 수 없어요.",
  REASON_TOO_LONG: "사유는 200자 안으로 적어 주세요.",
  CODE_INVALID: "들어가기 코드가 맞지 않거나 시간이 지났어요. 관리자 화면에서 다시 들어가 주세요.",
  SESSION_NOT_FOUND: "대리 입력 기록을 찾을 수 없어요.",
  /** 들어가기 OTP를 여러 번 틀려 잠깐 막힘(관리자마다) */
  OTP_LOCKED: "인증 코드를 여러 번 틀렸어요. 15분 뒤에 다시 해 주세요.",
  /** 방금 들어갈 때 쓴 OTP를 다시 넣음 */
  OTP_REUSED: "방금 쓴 인증 코드예요. 인증 앱의 다음 코드를 넣어 주세요.",
  /** 대리 입력 중 스토어 수정에서 정산 계좌(은행·계좌번호·예금주)가 지금 값과 다를 때 — 403 */
  BANK_ACCOUNT_LOCKED: "정산 계좌는 사장님만 바꿀 수 있어요.",
  /** 대리 입력 중 사장님이 만든 상품·직접 적은 주문을 지우려 할 때 — 403 */
  DELETE_OPERATOR_ONLY: "운영자가 만든 것만 지울 수 있어요.",
  /** 대리 입력 중 사장님이 적은 주문을 고치거나 입금 표시를 바꾸려 할 때 — 403(사진·내용을 되살릴 수 없어서) */
  EDIT_OPERATOR_ONLY: "사장님이 적은 주문은 사장님만 고칠 수 있어요.",
  /** 대리 입력 중 상품의 "손님에게 보이기"를 바꾸려 할 때 — 403(운영자 결정: 숨김 저장, 사장님이 켜기) */
  VISIBILITY_OWNER_ONLY: "손님에게 보이기는 사장님만 바꿀 수 있어요.",
} as const;

/** 누가 세션을 끝냈나(`admin_act_as_sessions.ended_by`) */
export const ACT_AS_ENDED_BY = {
  SELF: "self",
  admin: (adminId: string) => `admin:${adminId}`,
} as const;
