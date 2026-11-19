# Picake Backend

Picake 플랫폼을 위한 NestJS 백엔드 서비스입니다. 3-way 분리된 API 구조로 Consumer, Seller, Admin 역할별로 독립적인 API를 제공합니다.

## 🏗️ 주요 기능

### ✅ 구현 완료

- **3-way API 분리**: Consumer, Seller, Admin 역할별 독립적인 API
- **통합 인증 시스템**: JWT + Google/Kakao/Naver/Apple OAuth + 휴대폰 인증 + 앱스토어 심사용 로그인(`review-login`) + Admin TOTP
- **상품 관리**: 상품 CRUD, 고시 항목은 원산지만 필수(원산지표시법)이고 나머지 13개는 선택(빈 값 저장), 좋아요, 필터링, 검색 기능. 옵션은 사이즈(고정)와 추가 옵션(하나 고르기·여러 개 고르기·글자 받기·사진 받기). 맛도 추가 옵션 "맛"으로 받음(2026-11 이전 맛 데이터는 마이그레이션으로 옮김)
- **스토어 관리**: 스토어 등록, 수정, 목록 조회, 캘린더, 입점 요청(비입점 카카오 장소 등록 요청)
- **견적 요청**: 손님이 원하는 케이크를 요청서로 보내면 가게들이 견적을 보내고 손님이 하나를 고름(기획 I-46). ① 요청서·조회·운영자 알림, ② 가게 견적: 입점 가게는 판매자 앱 채팅방의 요청서 카드로 받고, 입점 전 가게는 가입 없이 견적 링크(`/q/:token`)로, 운영자는 대신 적기. 손님이 고르면 그 가게와의 채팅(입점 전 가게는 링크 안 대화)에서 주문을 정함. 가게는 견적에 "손님이 연락할 곳"(카카오톡 채널·인스타그램·네이버 톡톡·전화, 선택, 카카오·네이버는 그 회사 주소만)을 더할 수 있고, 손님에게는 그 가게를 고른 뒤에만 보낸다(11-13, 연락할 곳 칸이 없는 판매자 앱·대신 적기가 고치면 그대로 둠). 5분마다 마감·마감 3시간 전 알림톡·입점 전 가게 1시간 답 없음·고른 가게 24시간 답 없음을 확인(`QuoteJobsService`, 켜질 때도 한 번) 가게 쪽(견적 링크·판매자 앱 요청서)에는 손님 이름·휴대폰을 보낼 때 "받는 가게에 전달돼요" 안내를 본 요청(`shareContact`)에만, 손님 글과 같은 기간 동안 보여 준다(11-13).
- **상품 화면 견적·문의(기획 I-01, 2026-11-19)**: 상품 `order_method`(RESERVATION/QUOTE) — 견적 받기는 커스텀 케이크만(커스텀 → 기본으로 바꾸면 예약 받기로 돌림, 기본 케이크에 견적 받기만 보내면 400), 견적 상품은 예약신청(`POST /v1/consumer/orders`)을 막고, 손님 목록 `orderMethod` 거르기(홈 "바로 예약"). 손님 목록(상품·가게·찜)에서 당일픽업으로 거르거나 "당일·당일픽업"으로 찾으면 견적 상품은 뺀다(사장님 자기 목록은 고른 분류 그대로). 상품 응답 `hasExtraPrice`(보이는 크기·옵션 추가금 → 가격 뒤 물결). 견적 요청 `productId`·들어온 곳 `PRODUCT`("이 가게에만" 그 상품의 가게일 때만. 상품이 있으면 들어온 곳은 늘 PRODUCT, 상품 없이 PRODUCT만 오면 비움). 업로드 주소가 아닌 사진도 그 상품 사진이거나 받는 가게의 노출 중인 상품 사진이면 받는다(이어 쓰기로 상품 번호가 빠진 경우). 가게 "손님에게 보이기" `chat_inquiry_visible`·`kakao_channel_visible`·`instagram_visible`·`phone_visible` — 끈 연락처는 손님 가게·주문 응답에서 빼고(사장님 가게 화면·관리자 가게·주문 화면은 그대로, 관리자 가게 상세에 스위치 값), 운영자 대신 입력 중에는 스위치를 바꿀 수 없다(바꾸면 403, 같은 값은 통과). 채팅을 끈 가게는 새 문의 대화를 막는다(주문에서 연 대화·픽업 전 예약·이미 있는 대화는 그대로)
- **네이버 플레이스 가져오기**: 판매자가 넣은 네이버 플레이스 링크(지도 앱 공유 링크 `naver.me` 포함)로 매장 이름·설명·연락처·인스타그램 ID·영업시간을 미리 보기, 스토어에 네이버 매장 연결·해제, 영업 캘린더 제안값. 캘린더 저장 때 진행 중인 예약과 겹치면 막음(`BUSINESS_CALENDAR_ORDER_CONFLICT`). 같은 매장 10분 캐시, 판매자당 1분 10회
- **네이버 상품 가져오기**: 스토어에 연결한 네이버 매장의 네이버 예약 상품(이름·설명·주의사항·사진·옵션)을 읽어 Picake 사이즈·추가 옵션 후보로 바꿔 줌. 시간 단위·날짜 단위 예약 방식을 모두 읽고, 옵션을 읽을 수 없는 방식(프랜차이즈 주문 등)은 안내만 함. 옵션은 분류 이름으로 사이즈·필수 그룹을 정하고(맛 분류는 필수 추가 옵션 "맛"으로), 기본 가격 옵션은 판매가로, 포장주문처럼 여러 상품을 묶은 경우는 옵션 하나를 상품 하나로(`상품ID-o옵션ID`) 가져옴. 예약을 안 쓰는 매장은 플레이스 메뉴(이름·가격·설명·사진). 고른 사진은 서버가 네이버에서 다시 받아 S3에 올림(순번으로만 고름). 상품 ↔ 네이버 예약 상품 연결(스토어 안에서 하나만), 다시 불러오기로 비교. 저장은 상품 등록·수정으로만
- **상품 상세설명 AI 초안**: Claude API(기본 `claude-haiku-5-5`, 생각 끔·effort low, `ANTHROPIC_API_KEY`, 모델은 `ANTHROPIC_DRAFT_MODEL`로 변경 가능)로 판매자가 준 자료(네이버 설명·확인한 사실·옵션)만 근거로 초안. 근거 없는 중요 정보는 `[판매자 확인 필요]`. 저장하지 않음. 판매자당 1분 5회·하루 30회. 키가 없으면 503. 요청마다 모델·토큰 수만 로그에 남김. 실제 API 점검은 GitHub Actions `AI Draft Smoke`(수동 실행 또는 `ai-smoke-*` 태그)
- **주문 관리**: 주문 생성, 조회, 상태 관리, 입금 마감·픽업 임박 자동 안내(배치). 자동 취소: 입금 마감이 지난 입금대기(`paymentPendingExpiredAt`), 가게가 픽업 날이 지나도록(다음 날 오전 9시, 한국 시간) 확인하지 않은 예약신청(`reservationExpiredAt`, 2026-11-16 — 손님·사장님 앱 알림·푸시, 알림톡 없음, 만료된 지 하루가 넘은 옛 주문은 알림 없이)
- **피드 관리**: 피드 작성, 조회, 상세
- **리뷰 시스템**: 리뷰 작성 및 조회
- **좋아요 / 최근 본 상품**: 좋아요 추가/제거, 최근 본 상품 기록
- **알림 시스템**: FCM 기반 푸시 알림 + WebSocket 실시간 알림 + 카카오 알림톡(SOLAPI)
- **채팅(기획 I-11)**: 손님 × 입점 가게 1:1. 글은 REST, 새 글·읽음은 알림 소켓 `chat_updated` 신호(내용 없음)와 푸시. 사장님은 손님이 먼저 말한 방(손님 마지막 글 30일 안)이나 픽업 전 예약 손님에게만. 욕설 거르기·신고(디스코드 【PICAKE】운영, 관리자 24시간 처리)·차단·방 알림 끔. 배포하면 바로 열린다(따로 여는 시각 없음, 운영자 결정 11-12). 손님 탈퇴 시 글·사진 지움, 하루 한 번 마지막 글 3년 지난 방 지움(신고 처리 1년 안이면 남김). 자세한 것은 web 레포 `docs/common/feature/채팅 시스템 - 가이드.md` 상대 글을 앱 알림으로 못 봤거나 안 읽으면 1분마다 도는 `ChatAlimtalkService`가 카카오 알림톡(손님 "답변 도착 안내"·사장님 "새 문의 안내")을 보낸다 — 기기가 없으면 10분·있으면 60분 뒤, 방마다 3시간에 한 번, 밤에는 아침까지, 하루 200건.
- **통계**: 판매자/관리자 매출·주문·회원 통계
- **사업자진위확인**: 국세청 API 연동을 통한 사업자등록번호 진위확인
- **콘텐츠 관리**: 홈 배너, 공지사항, Q&A, 약관(이용약관/개인정보처리방침)
- **관리자 기능**: 관리자 계정/권한 관리, 판매자 세그먼트 관리, 회원 관리
- **가게 대신 입력(기획 I-41)**: 운영자가 관리자 스토어 상세에서 "이 가게로 들어가기"(사유 + OTP 다시 입력)를 누르면 60분짜리 대리 출입증(`type: act_as`, `aud: seller`, 연장 없음)으로 그 가게 판매자 화면을 쓴다. 판매자 경로는 `@AllowActAs()`를 붙인 것만 받는다(기본은 막기 — 허용 표는 `act-as-allowlist.spec.ts`). 막는 것: 정산 계좌 바꾸기(스토어 수정에서 계좌가 지금 값과 다르면 403), 탈퇴·번호·프로필, 채팅(배지 수만 열림), 주문 상태 바꾸기(주문 목록·상세는 보기만), 견적, 알림 읽음·설정 바꾸기(알림 목록·설정·주문 통계는 판매자 화면이 모든 화면에서 불러 보기만 엶), 알림 토큰, 캘린더 내보내기 주소, 스토어 만들기·사업자 확인, 피드, 링크 효과, 들어간 가게가 아닌 스토어(주소·쿼리·본문의 storeId는 가드가, 상품 id·주문 id로 부르는 경로는 서비스가 찾은 행의 가게로 막고, 상품·주문·스토어 목록은 들어간 가게만 준다 — `act-as-scope.util.ts`). 매 요청마다 세션 행을 봐서 끝내기·60분·관리자나 판매자 끄기·허용 관리자 목록에서 빼기 뒤 바로 401. 대리로 만든 상품은 숨김으로 저장하고 "손님에게 보이기"는 대리로 바꿀 수 없다(지금 값과 다르면 403, 사장님이 켬), 상품·직접 적은 주문에 `createdByAdminId`를 남겨 판매자 응답에 `enteredByOperator`만 내보낸다(손님 응답·관리자 id는 내보내지 않음). 지우기는 운영자가 만든 것만, 직접 적은 주문은 고치기·입금 표시도 운영자가 적은 것만(사장님 주문의 사진·내용을 되살릴 수 없어서). 정산 계좌는 비교한 뒤에도 쓰지 않는다. 모든 대리 요청(GET·막힌 요청·관리자·손님 경로 시도 포함)을 `admin_act_as_actions`에 경로 틀·대상 id·보낸 칸 이름·결과만 남긴다(보낸 값 없음). 사람 관리자만(API 키는 시작·끝내기 모두 거절), 환경값 `ADMIN_ACT_AS_USERNAMES`(쉼표 목록, 배포 비밀값)에 적은 관리자만, 심사용 가게(`REVIEW-STORE`)·꺼진 판매자는 거절, 시작하면 디스코드 【PICAKE】운영 알림
- **역할 기반 접근 제어**: 통합 `@Auth` 데코레이터로 권한 관리
- **데이터베이스**: Prisma ORM + PostgreSQL
- **API 문서**: Swagger 3-way 분리 문서
- **보안**: Rate Limiting, CORS, Helmet
- **파일 업로드**: S3 + CloudFront, 백엔드 경유 업로드 (10MB 제한, MIME/확장자 검증)
- **에러 모니터링**: Sentry 통합
- **헬스 체크**: `/health` 엔드포인트 (DB 연결 상태 포함)

### 🔄 개발 중

- Admin API 확장

## 📚 상세 문서

자세한 개발 가이드와 API 문서는 `/docs` 폴더를 참고하세요.

## 🔗 API 엔드포인트

### Consumer API (`/v1/consumer`)

- **인증**: `/v1/consumer/auth/*` - 로그인, 회원가입, 휴대폰 인증, Google/Kakao/Apple OAuth, 앱스토어 심사용 로그인(`review-login`). 소셜 첫 로그인은 가입표(`registerToken`, 30분, 사장님 같음)를 주고 가입 API는 가입표로만 받는다. 카카오는 동의하면 이름·휴대폰 번호·간편가입 약관(이번 로그인에서 동의한 것만)을 가입표에 담아 `useTicketPhone: true`면 문자 인증 없이 그 번호로 가입한다(기획 I-59). 네이버(`naver/login`·`naver/register`, 손님·사장님이 앱 하나를 같이 씀, `NAVER_CLIENT_ID`·`_SECRET`)도 동의한 이름·휴대전화번호를 가입표에 담아 같은 방식으로 가입하고, 로그인 요청에는 화면이 만든 `state`를 같이 보낸다. 네이버는 이메일을 받지 않고 약관은 늘 가입 화면에서 받는다. 탈퇴하면 애플은 revoke, 카카오는 연결 끊기(앱 어드민 키 `KAKAO_ADMIN_KEY`, 없으면 건너뜀), 네이버는 저장해 둔 갱신 토큰(암호화)으로 토큰 폐기(상용에서만 — staging도 같은 네이버 앱이라)
- **상품**: `/v1/consumer/products/*` - 상품 조회, 필터링, 검색
- **스토어**: `/v1/consumer/store/*` - 스토어 조회
  - 손님 목록(상품·스토어 목록, 검색, 지도, 지역별 수, 사이트맵)에는 판매자 앱 심사용 가게와 정지·탈퇴한 사장님(`isActive: false`) 가게를 넣지 않는다(`CUSTOMER_LISTED_STORE_WHERE`). 링크로 연 상세는 열리고, 정지·탈퇴한 사장님 가게 상품은 판매중지로 보이며 예약 만들기(상품·견적)와 견적 요청에 넣기가 막힌다(11-15 운영자)
  - `/v1/consumer/store/:id/link-visits` - 사장님이 보낸 링크(`?from=link`)로 들어온 기기 남기기 (POST, 로그인 없이, 기기 임의 값만, 기획 I-45)
- **입점 요청**: `/v1/consumer/store-entry-requests/*` - 비입점 카카오 장소 등록 요청
- **견적 요청**: `/v1/consumer/quote-requests/*` - 손님 견적 요청서 보내기·내 견적 요청 목록·상세·닫기, 받은 견적(`:id/quotes`, 열면 본 것으로)·고르기(`:id/choose`, 고른 뒤 24시간 또는 고른 가게가 24시간 답이 없으면 다시 고르기)·고른 견적으로 예약하기(`:id/reservation`, 입점 가게만 — 상품 없는 예약신청을 만들고 이후는 상품 예약과 같은 주문 흐름, 기획 I-01. 예약이 살아 있으면 다시 고르기·사장님 견적 고치기가 막히고, 고른 뒤 예약 전까지는 사장님이 견적을 고칠 수 있음)·안 본 견적 수(`quotes/unseen-count`)(기획 I-46, 새 요청은 디스코드 【PICAKE】운영으로 알림). 손님이 탈퇴하면 견적 요청과 참고 사진(S3)을 지운다(계정은 주문 보관 때문에 익명화만 해서 자동으로 지워지지 않음, `QuoteRequestCleanupService`). 장소 링크(`placeUrl`)는 http·https만 받는다(입점 요청도 같음). 요청서 참고 사진마다 `photoDetails`(`{ designId | null, parts: ALL·SHAPE·COLOR·DECORATION·LETTERING }`, `photoUrls`와 같은 순서·개수, 기획 I-112)를 받아 저장하고 고른 디자인 ID(`designIds`)를 남긴다. 손님·관리자 상세와 가게 쪽 요청서(손님 사진과 같이 가림)에 `photoDetails`가 오고, 이 칸이 생기기 전 요청은 사진마다 "손님 사진·전체"로 보인다. 들어온 곳에 디자인 모음(`DESIGN`)
  - `/v1/consumer/quote-requests/photo-read` - 요청서 참고 사진 읽기(POST, 로그인 없이도, 기획 I-112 1-나). 본문 `{ image }`는 JPG·PNG data URL(풀었을 때 2.5MB까지, 이 경로만 JSON 한도 4MB — `common/config/body-limit.config.ts`). Claude(Haiku, 상세 설명 AI 초안과 같은 `ANTHROPIC_API_KEY`)가 보이는 것만 읽어 따를 것 4칸(모양·색·장식·글자 — 웹이 요청서 설명을 "· 모양: …" 줄로 쓴다)만 돌려주고(11-14부터 요청서는 설명만 채워, 웹이 쓰지 않는 읽은 줄·설명 문장·크기·크림·요청 사항은 쓰게 하지 않음), 케이크가 아니거나 못 읽으면 `{ unreadable: true }`. 사진은 저장하지 않고 로그에는 토큰·시간만. 한도(비용을 막는 용도, `quote-photo-read.constants.ts`): 하루 20번(로그인하면 손님마다, 아니면 접속 주소마다 — IPv6는 /64로 묶음 `common/utils/client-ip.util.ts`), 넘으면 429 "오늘은 사진 읽기를 다 썼어요. 직접 적어 주세요." · 분당 10번(접속 주소마다), 넘으면 429 "잠시 후 다시 시도해 주세요."(`@ThrottleMessage`, 두 429는 `data.message` 글로 구분할 수 있음) · 모든 손님을 합쳐 하루 1,000번, 넘으면 키가 없을 때와 같은 503 "지금은 사진을 읽을 수 없어요. 직접 적어 주세요."(Sentry에 6시간에 한 번 알림). 하루 한도는 서버 메모리라 다시 켜면 처음부터. Claude는 다시 시도하지 않고 20초에 끊는다(웹은 30초 기다림 — 웹이 포기한 뒤 서버가 기다리지 않게). Claude 실패·시간 초과는 502이고 두 하루 한도에서 세지 않는다. 큰 JSON(4MB)은 `POST` 이 경로 하나에만 받고, 앞부분만 같은 경로·다른 메서드는 기본 100kb
- **견적 링크**: `/v1/consumer/quote-links/:token/*` - 입점 전 가게가 가입 없이(링크 열쇠가 권한) 요청서 보기·견적 보내기·고치기(`quote`)·어려워요(`decline`)·사진(`photos`)·손님과 대화(`chat/messages`, 그 요청이 온 뒤 글만). 요청 수 제한(분당 30, 보내기·사진 10, 대화 20)
- **주문**: `/v1/consumer/orders/*` - 주문 생성 및 조회. 주문 응답 `canceledAt`은 처음 취소 상태가 된 시각(손님 취소·환불 요청, 사장님 취소, 입금 마감·확인 안 한 예약신청 자동 취소, 2026-11-16부터, 그 전 취소는 null). `reservationExpiredAt`이 있으면 가게가 확인하지 않아 자동 취소된 예약신청. 예약신청 단계 날짜·옵션 바꾸기는 그사이 사장님이 예약을 확인했으면 바꾸지 않는다(상태 조건부 저장). 사장님이 환불 대기로 바꾼 주문에 손님이 환불 계좌(`refund-account`)를 넣거나 고치면 사장님 알림·판매자 앱 푸시("손님이 환불 계좌를 알려 줬어요/고쳤어요")
- **피드**: `/v1/consumer/feed/*` - 피드 조회
- **리뷰**: `/v1/consumer/review/*` - 리뷰 작성 및 조회
- **좋아요**: `/v1/consumer/like/*` - 좋아요 추가/제거
- **디자인 좋아요**: `/v1/consumer/designs/*` - 케이크 디자인 모음 좋아요(기획 I-112). `:designId/like` POST(추가)·DELETE(취소)는 로그인 필요, 두 번 해도 성공. `likes` GET은 로그인 없이 디자인별 좋아요 수(`counts`, 1개 이상만, 많은 순 500개까지 — 수가 같으면 ID 순)와 내 좋아요(`myLikes`, 최근 누른 순, 로그인하지 않으면 `[]`). 디자인은 DB가 아니라 웹에 있어 ID 모양(소문자-하이픈, 80자까지)만 확인하고 틀리면 400. 아무 ID나 쌓지 못하게 손님 한 명은 300개까지(넘으면 400 "좋아요는 300개까지 할 수 있어요.", 이미 누른 디자인은 그대로 성공, 손님마다 잠가 동시에 눌러도 넘지 않음, `DESIGN_LIKE_LIMITS`). 탈퇴하면 그 손님의 디자인 좋아요를 지운다
- **채팅**: `/v1/consumer/chats/*` - 목록·안 읽은 수·규칙 동의·가게와 방 찾기(`stores/:storeId`)·처음 보내기(POST)·방·글 가져오기(`after`/`before`/`markRead`)·보내기·알림 끔·차단·신고
- **마이페이지**: `/v1/consumer/mypage/*` - 사용자 정보 조회/수정
- **알림**: `/v1/consumer/notifications/*` - 알림 목록 조회
- **FCM 토큰**: `/v1/consumer/fcm-tokens/*` - 푸시 알림 토큰 등록
- **업로드**: `/v1/consumer/uploads/file` - 파일 업로드 (POST, multipart/form-data)
- **콘텐츠**: `/v1/consumer/home-banners/*`, `/v1/consumer/notices/*`, `/v1/consumer/qnas/*`, `/v1/consumer/terms/*`

### Seller API (`/v1/seller`)

- **인증**: `/v1/seller/auth/*` - 판매자 로그인, 회원가입, Google/Kakao/Naver OAuth, 판매자 앱 심사용 로그인(`review-login`, I-48). 심사용 로그인은 코드를 서버 환경값 `SELLER_REVIEW_LOGIN_CODE_SHA256`(코드의 SHA-256, GitHub 비밀값)과 비교하고 값이 없으면 꺼진다. 들어오면 손님 목록에 보이지 않는 심사용 가게(`Store.businessNo` = `REVIEW-STORE`)와 예시 상품을 없을 때 만들고, 상태별 예시 주문 8건을 처음 상태로 되돌린다. 심사용 계정은 예시 주문이 있어도 탈퇴되고 그 가게는 지워진다
- **사업자**:
  - `/v1/seller/business/validate` - 사업자등록번호 진위확인 (POST)
  - `/v1/seller/business/online-trading-company/detail` - 통신판매사업자 등록상세 조회 (GET) — 스토어 만들기에서는 선택(동네 음식료 판매는 전자상거래법 제3조 ④로 통신판매업 신고 의무가 없어 받지 않을 수 있음, 2026-11 법 검토)
- **스토어**:
  - `/v1/seller/store/create` - 스토어 생성 (POST)
  - `/v1/seller/store/list` - 내 스토어 목록 조회 (GET)
  - `/v1/seller/store/:storeId` - 스토어 상세 조회/수정
  - `/v1/seller/store/:storeId/naver-place` - 네이버 매장 연결 (PUT) / 연결 해제 (DELETE)
  - `/v1/seller/store/:storeId/link-stats` - 최근 30일 링크로 온 손님 기기 수·그 링크로 온 예약 신청 수 (GET, 기획 I-45)
- **네이버 플레이스**: `/v1/seller/naver-place/preview` - 네이버 플레이스 링크로 매장 정보 미리 보기 (GET)
- **네이버 상품**:
  - `/v1/seller/store/:storeId/naver-products` - 연결한 네이버 매장의 상품 목록 (GET)
  - `/v1/seller/store/:storeId/naver-products/:itemKey` - 상품 1개의 등록 제안값 (GET)
  - `/v1/seller/store/:storeId/naver-products/:itemKey/images` - 고른 사진을 Picake에 올리기 (POST)
  - `/v1/seller/products/:productId/naver-item` - 상품을 네이버 예약 상품과 연결 (PUT) / 끊기 (DELETE)
  - `/v1/seller/store/:storeId/products/description-draft` - 상품 상세설명 AI 초안 (POST). 판매자당 하루 30번(429), 모든 판매자를 합쳐 하루 300번(넘으면 503 "오늘은 AI 초안을 더 만들 수 없어요…", Sentry에 6시간에 한 번 알림). Claude 쪽 실패는 두 한도에서 세지 않는다
- **상품**: `/v1/seller/products/*` - 상품 CRUD
- **주문**: `/v1/seller/orders/*` - 주문 관리
- **피드**: `/v1/seller/feed/*` - 피드 CRUD
- **견적**: `/v1/seller/stores/:storeId/quote-requests/:requestId` - 채팅방 요청서 카드의 요청서·이 가게 상태(GET), 견적 보내기·고치기(`quote`), 어려워요(`decline`)
- **채팅**: `/v1/seller/stores/:storeId/chats/*` - 목록(`?filter=reply|all`)·안 읽은 수·답할 수(`unread`: `replyNeeded`, 홈 "견적 요청" `quoteRequests`, 그 방을 뺀 "답할 채팅" `replyNeededChats`)·규칙 동의·방·글·보내기·알림 끔·차단·신고, `orders/:orderId`(GET 방 찾기, POST 픽업 전 예약 손님에게 주문 카드와 함께 먼저 보내기). 손님이 보낸 글은 판매자 앱 푸시 "새 문의가 왔어요"(`data.path` = `/stores/:storeId/chats/:threadId`, 채팅 알림 끔·밤 9시~아침 8시 끄기·방 알림 끔이면 안 보냄)
- **통계**: `/v1/seller/statistics/*` - 매출/주문 통계. `orders/overview` 응답의 `manual`은 직접 적은 주문(기획 I-42): 픽업 날이 기간 안이고 오늘까지 지난 주문, 매출은 금액을 적은 주문만, 받은 곳별(`bySource`)·요일·시간대(픽업 날·시각). 위 Picake 숫자에는 섞지 않고 관리자 통계에도 넣지 않는다
- **직접 적은 주문(기획 I-42)**: `/v1/seller/stores/:storeId/manual-orders` - 사장님이 카톡·인스타·전화 등 Picake 밖에서 받은 주문(`manual_orders` 표, Picake 주문·알림톡·정산·관리자 숫자와 따로). 기간으로 불러오기(GET `?startDate&endDate`, 62일까지, 날·시각 순·시각 없으면 그날 맨 뒤), 적기(POST), 하나(GET `:id`), 고치기(PUT `:id`, 모든 칸 — `photoUrls`를 빼면 사진은 그대로), 입금만 바꾸기(PATCH `:id/paid`), 지우기(DELETE `:id`). 꼭 적을 칸은 픽업 날·케이크, 손님 연락처는 받지 않는다. 사진은 업로드 API가 준 주소 꼴 그대로만(`?`·`#`·다른 꼴은 400 — 지울 때 남의 파일이 지워지지 않게), 고치며 뺀 사진·지운 주문의 사진 파일은 다른 곳이 같은 파일을 쓰지 않을 때만 지운다(`UploadService`는 주소가 아니라 S3 키로 비교). 사장님이 탈퇴하면 지운다
  - `manual-orders/read` - 대화 붙여 넣어 채우기(POST). 붙여 넣은 대화 글(`text`) 또는 대화 캡처(`image`, JPG·PNG data URL 2.5MB까지 — 이 경로도 JSON 한도 4MB)를 Claude(Haiku, `ANTHROPIC_API_KEY`)가 읽어 칸을 채울 값을 준다(레터링은 대화 글자 그대로, 못 찾은 칸은 null, 주문이 아니면 `found: false`). 대화·캡처는 저장하지 않고 로그에는 횟수·시간·토큰만. 한도: 사장님마다 하루 60번(429 "오늘은 대화 읽기를 다 썼어요…"), 분당 10번(429 "잠시 후 다시 시도해 주세요."), 모두 합쳐 하루 2,000번(503). Claude는 20초에 끊고 다시 시도하지 않으며 실패·시간 초과(502)는 한도에서 세지 않는다(캡처를 Claude가 받지 않으면 400, 셈). 전화번호·계좌번호처럼 보이는 숫자는 Claude에 보내기 전·돌려주기 전에 가리고, 읽은 픽업 날짜가 지난 7일 ~ 앞으로 1년 밖이면 비운다
  - `calendar-feed` - 다른 캘린더로 내보내기 주소(GET, 처음 열면 만듦: `path` = `/v1/seller/calendar-feeds/{비밀 값}.ics`, `showCustomerName`), 손님 이름 보이기(PATCH), 주소 새로 만들기(POST `calendar-feed/reset`, 옛 주소는 404 — 11-17 운영자가 화면 버튼을 빼서 지금은 부르는 화면이 없음, 주소가 새면 이 API로 끊는다)
- **캘린더 구독 주소(로그인 없음)**: `/v1/seller/calendar-feeds/{비밀 값}.ics` - 아이폰·구글 캘린더가 주기적으로 읽는 ics(감싸지 않은 `text/calendar`). Picake 예약(취소·노쇼 빼고)과 직접 적은 주문, 지난 60일부터 앞으로 1년. 일정 이름은 "케이크 · 받은 곳"(손님 이름은 켰을 때만), 설명에 "예약신청(아직 받지 않음)"·"입금 전", 시각이 없으면 하루 일정. 탈퇴·정지된 사장님이면 404. 분당 30번
- **FCM 토큰(판매자 앱)**: `/v1/seller/fcm-tokens` - 판매자 앱 푸시 토큰 등록·해제(빈 토큰) (POST), `/v1/seller/fcm-tokens/test` - 테스트 알림, 받은 기기 수를 돌려줌 (POST). 손님·자동 처리·관리자가 바꾼 주문 상태(새 예약신청, 입금완료, 손님 취소·환불 요청 등)와 손님이 넣은 환불 계좌는 판매자 앱으로도 푸시하고 `data.path`에 판매자 웹 주문 상세 경로를 담음(기획 I-48). 내용은 "상품 이름(여러 개면 개수) · 픽업 일시"(판매자 페이지 안 알림도 같음), 스토어가 둘 이상이면 제목 앞에 [스토어 이름]. 픽업 시각이 되어 픽업대기로 바뀐 것은 푸시하지 않음. 아침 요약: 매일 8시~11시 사이 한 번, 그날 픽업이 있는 스토어마다 "오늘 픽업 n건 / 첫 픽업 hh:mm"(`data.path` = 스토어 홈). 직접 적은 주문(기획 I-42)도 세고, 시각을 아는 주문이 없으면 "픽업 시간 미정", 입금 전인 직접 적은 주문이 있으면 " · 입금 전 n건"
- **알림**: `/v1/seller/notifications/*` - 알림 목록/설정(스토어별: 주문 알림 받기, 주문 알림 소리, 아침 요약 `morningSummaryEnabled`, 채팅 알림 `chatNotificationsEnabled`, 밤 채팅 알림 끄기 `chatQuietNight`)
- **홈**: `/v1/seller/home/*` - 판매자 홈 대시보드
- **마이페이지**: `/v1/seller/mypage/*` - 판매자 정보 조회/수정
- **업로드**: `/v1/seller/uploads/file` - 파일 업로드 (POST, multipart/form-data)
- **운영자 대신 입력(기획 I-41)**: `/v1/seller/act-as/exchange` - 관리자 화면이 연 주소의 한 번만 쓰는 코드(60초)를 대리 출입증으로 바꿈(POST, 로그인 없음, 분당 5번), `/v1/seller/act-as/me` - 위 띠의 가게 이름·끝나는 시각(GET), `/v1/seller/act-as/end` - 끝내기(POST). `me`·`end`는 대리 출입증만 받는다

### Admin API (`/v1/admin`)

- **인증**: `/v1/admin/auth/*` - TOTP 기반 관리자 인증
- **마이페이지**: `/v1/admin/mypage/*` - 관리자 정보 조회
- **통계**: `/v1/admin/statistics/*` - 회원/주문/스토어/입점요청 통계
- **회원 관리**: `/v1/admin/member-management/*` - 소비자/판매자 회원 관리
- **스토어 관리**: `/v1/admin/store-management/*`, `/v1/admin/store-entry-request-management/*`
- **견적 요청**: `/v1/admin/quote-request-management/*` - 견적 요청 목록(견적 받는 중·가게 연결·마감, 견적이 들어온 길별 수)·상세, `requests/:id/quotes`(가게별 상태·견적·대화), `stores`(가게 더하기, 입점 가게면 판매자 앱으로 바로), `stores/:targetId/link`(견적 링크 만들기)·`quote`(대신 적기)·`decline`, `chosen-notified`(입점 전 가게를 고른 뒤 "알렸어요"), `close`(요청 마감하기)
- **채팅**: `/v1/admin/chat/summary`(매일 브리핑용: 처리할 신고·스토어가 답하지 않은 방·최근 24시간 글 수, 대화 내용 없음), `/v1/admin/chat/reports`(최근 100개, `?status=OPEN|RESOLVED`), `reports/:id`(최근 대화 50개 원문, 열면 열람 기록 `chat_access_logs`), PATCH `reports/:id`(`HIDE_MESSAGE` + `messageIds` 고른 메시지 가리기 / `NONE`)
- **가게 대신 입력(기획 I-41)**: `/v1/admin/stores/:storeId/act-as-sessions` - 이 가게로 들어가기(POST `{ reason, totpCode }`, 사람 관리자·허용 관리자만, 판매자 화면 주소 `sellerUrl` 돌려줌 — 코드는 `#code=`로 실어 접근 기록에 남지 않게)·이 가게 기록(GET, 최근 50개와 상품·주문·캘린더·스토어·본 화면·막힘 수), `/v1/admin/act-as-sessions/:id/actions` - 세션 안 쓰기·실패 기록(GET, 본 화면 GET은 목록 요약의 수로만), `/v1/admin/act-as-sessions/:id/end` - 바로 끝내기(POST)
- **관리자 계정 관리**: `/v1/admin/admin-management/*` - 관리자 계정/권한 관리
- **판매자 세그먼트 관리**: `/v1/admin/seller-segment-management/*`
- **콘텐츠 관리**: `/v1/admin/home-banners/*`, `/v1/admin/notices/*`, `/v1/admin/qnas/*`, `/v1/admin/terms/*`

### WebSocket

- **알림**: `ws://localhost:3000/notifications` (namespace: `/notifications`) - 실시간 주문 알림 (Seller + Consumer), 채팅 신호 `chat_updated` `{ threadId, storeId, senderName?, muted? }`(글 내용 없음)

### API 문서

- **Consumer API**: http://localhost:3000/v1/docs/consumer
- **Seller API**: http://localhost:3000/v1/docs/seller
- **Admin API**: http://localhost:3000/v1/docs/admin
