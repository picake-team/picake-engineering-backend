# Picake Backend

Picake 플랫폼을 위한 NestJS 백엔드 서비스입니다. 3-way 분리된 API 구조로 Consumer, Seller, Admin 역할별로 독립적인 API를 제공합니다.

## 🏗️ 주요 기능

### ✅ 구현 완료

- **3-way API 분리**: Consumer, Seller, Admin 역할별 독립적인 API
- **통합 인증 시스템**: JWT + Google/Kakao/Apple OAuth + 휴대폰 인증 + 앱스토어 심사용 로그인(`review-login`) + Admin TOTP
- **상품 관리**: 상품 CRUD, 고시 항목은 원산지만 필수(원산지표시법)이고 나머지 13개는 선택(빈 값 저장), 좋아요, 필터링, 검색 기능. 옵션은 사이즈(고정)와 추가 옵션(하나 고르기·여러 개 고르기·글자 받기·사진 받기). 맛도 추가 옵션 "맛"으로 받음(2026-11 이전 맛 데이터는 마이그레이션으로 옮김)
- **스토어 관리**: 스토어 등록, 수정, 목록 조회, 캘린더, 입점 요청(비입점 카카오 장소 등록 요청)
- **견적 요청**: 손님이 원하는 케이크를 요청서로 보내면 가게들이 견적을 보내고 손님이 하나를 고름(기획 I-46). ① 요청서·조회·운영자 알림, ② 가게 견적: 입점 가게는 판매자 앱 채팅방의 요청서 카드로 받고, 입점 전 가게는 가입 없이 견적 링크(`/q/:token`)로, 운영자는 대신 적기. 손님이 고르면 그 가게와의 채팅(입점 전 가게는 링크 안 대화)에서 주문을 정함(주문 받는 곳은 묻지 않음, 11-12). 5분마다 마감·마감 3시간 전 알림톡·입점 전 가게 1시간 답 없음·고른 가게 24시간 답 없음을 확인(`QuoteJobsService`, 켜질 때도 한 번)
- **네이버 플레이스 가져오기**: 판매자가 넣은 네이버 플레이스 링크(지도 앱 공유 링크 `naver.me` 포함)로 매장 이름·설명·연락처·인스타그램 ID·영업시간을 미리 보기, 스토어에 네이버 매장 연결·해제, 영업 캘린더 제안값. 캘린더 저장 때 진행 중인 예약과 겹치면 막음(`BUSINESS_CALENDAR_ORDER_CONFLICT`). 같은 매장 10분 캐시, 판매자당 1분 10회
- **네이버 상품 가져오기**: 스토어에 연결한 네이버 매장의 네이버 예약 상품(이름·설명·주의사항·사진·옵션)을 읽어 Picake 사이즈·추가 옵션 후보로 바꿔 줌. 시간 단위·날짜 단위 예약 방식을 모두 읽고, 옵션을 읽을 수 없는 방식(프랜차이즈 주문 등)은 안내만 함. 옵션은 분류 이름으로 사이즈·필수 그룹을 정하고(맛 분류는 필수 추가 옵션 "맛"으로), 기본 가격 옵션은 판매가로, 포장주문처럼 여러 상품을 묶은 경우는 옵션 하나를 상품 하나로(`상품ID-o옵션ID`) 가져옴. 예약을 안 쓰는 매장은 플레이스 메뉴(이름·가격·설명·사진). 고른 사진은 서버가 네이버에서 다시 받아 S3에 올림(순번으로만 고름). 상품 ↔ 네이버 예약 상품 연결(스토어 안에서 하나만), 다시 불러오기로 비교. 저장은 상품 등록·수정으로만
- **상품 상세설명 AI 초안**: Claude API(기본 `claude-haiku-5-5`, 생각 끔·effort low, `ANTHROPIC_API_KEY`, 모델은 `ANTHROPIC_DRAFT_MODEL`로 변경 가능)로 판매자가 준 자료(네이버 설명·확인한 사실·옵션)만 근거로 초안. 근거 없는 중요 정보는 `[판매자 확인 필요]`. 저장하지 않음. 판매자당 1분 5회·하루 30회. 키가 없으면 503. 요청마다 모델·토큰 수만 로그에 남김. 실제 API 점검은 GitHub Actions `AI Draft Smoke`(수동 실행 또는 `ai-smoke-*` 태그)
- **주문 관리**: 주문 생성, 조회, 상태 관리, 입금 마감·픽업 임박 자동 안내(배치)
- **피드 관리**: 피드 작성, 조회, 상세
- **리뷰 시스템**: 리뷰 작성 및 조회
- **좋아요 / 최근 본 상품**: 좋아요 추가/제거, 최근 본 상품 기록
- **알림 시스템**: FCM 기반 푸시 알림 + WebSocket 실시간 알림 + 카카오 알림톡(SOLAPI)
- **채팅(기획 I-11)**: 손님 × 입점 가게 1:1. 글은 REST, 새 글·읽음은 알림 소켓 `chat_updated` 신호(내용 없음)와 푸시. 사장님은 손님이 먼저 말한 방(손님 마지막 글 30일 안)이나 픽업 전 예약 손님에게만. 욕설 거르기·신고(디스코드 【PICAKE】운영, 관리자 24시간 처리)·차단·방 알림 끔. 배포하면 바로 열린다(따로 여는 시각 없음, 운영자 결정 11-12). 손님 탈퇴 시 글·사진 지움, 하루 한 번 마지막 글 3년 지난 방 지움(신고 처리 1년 안이면 남김). 자세한 것은 web 레포 `docs/common/feature/채팅 시스템 - 가이드.md` 상대 글을 앱 알림으로 못 봤거나 안 읽으면 1분마다 도는 `ChatAlimtalkService`가 카카오 알림톡(손님 "답변 도착 안내"·사장님 "새 문의 안내")을 보낸다 — 기기가 없으면 10분·있으면 60분 뒤, 방마다 3시간에 한 번, 밤에는 아침까지, 하루 200건.
- **통계**: 판매자/관리자 매출·주문·회원 통계
- **사업자진위확인**: 국세청 API 연동을 통한 사업자등록번호 진위확인
- **콘텐츠 관리**: 홈 배너, 공지사항, Q&A, 약관(이용약관/개인정보처리방침)
- **관리자 기능**: 관리자 계정/권한 관리, 판매자 세그먼트 관리, 회원 관리
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

- **인증**: `/v1/consumer/auth/*` - 로그인, 회원가입, 휴대폰 인증, Google/Kakao/Apple OAuth, 앱스토어 심사용 로그인(`review-login`)
- **상품**: `/v1/consumer/products/*` - 상품 조회, 필터링, 검색
- **스토어**: `/v1/consumer/store/*` - 스토어 조회
  - `/v1/consumer/store/:id/link-visits` - 사장님이 보낸 링크(`?from=link`)로 들어온 기기 남기기 (POST, 로그인 없이, 기기 임의 값만, 기획 I-45)
- **입점 요청**: `/v1/consumer/store-entry-requests/*` - 비입점 카카오 장소 등록 요청
- **견적 요청**: `/v1/consumer/quote-requests/*` - 손님 견적 요청서 보내기·내 견적 요청 목록·상세·닫기, 받은 견적(`:id/quotes`, 열면 본 것으로)·고르기(`:id/choose`, 고른 뒤 24시간 또는 고른 가게가 24시간 답이 없으면 다시 고르기)·안 본 견적 수(`quotes/unseen-count`)(기획 I-46, 새 요청은 디스코드 【PICAKE】운영으로 알림). 손님이 탈퇴하면 견적 요청과 참고 사진(S3)을 지운다(계정은 주문 보관 때문에 익명화만 해서 자동으로 지워지지 않음, `QuoteRequestCleanupService`). 장소 링크(`placeUrl`)는 http·https만 받는다(입점 요청도 같음)
- **견적 링크**: `/v1/consumer/quote-links/:token/*` - 입점 전 가게가 가입 없이(링크 열쇠가 권한) 요청서 보기·견적 보내기·고치기(`quote`)·어려워요(`decline`)·사진(`photos`)·손님과 대화(`chat/messages`, 그 요청이 온 뒤 글만). 요청 수 제한(분당 30, 보내기·사진 10, 대화 20)
- **주문**: `/v1/consumer/orders/*` - 주문 생성 및 조회
- **피드**: `/v1/consumer/feed/*` - 피드 조회
- **리뷰**: `/v1/consumer/review/*` - 리뷰 작성 및 조회
- **좋아요**: `/v1/consumer/like/*` - 좋아요 추가/제거
- **채팅**: `/v1/consumer/chats/*` - 목록·안 읽은 수·규칙 동의·가게와 방 찾기(`stores/:storeId`)·처음 보내기(POST)·방·글 가져오기(`after`/`before`/`markRead`)·보내기·알림 끔·차단·신고
- **마이페이지**: `/v1/consumer/mypage/*` - 사용자 정보 조회/수정
- **알림**: `/v1/consumer/notifications/*` - 알림 목록 조회
- **FCM 토큰**: `/v1/consumer/fcm-tokens/*` - 푸시 알림 토큰 등록
- **업로드**: `/v1/consumer/uploads/file` - 파일 업로드 (POST, multipart/form-data)
- **콘텐츠**: `/v1/consumer/home-banners/*`, `/v1/consumer/notices/*`, `/v1/consumer/qnas/*`, `/v1/consumer/terms/*`

### Seller API (`/v1/seller`)

- **인증**: `/v1/seller/auth/*` - 판매자 로그인, 회원가입, Google/Kakao OAuth, 판매자 앱 심사용 로그인(`review-login`, I-48). 심사용 로그인은 코드를 서버 환경값 `SELLER_REVIEW_LOGIN_CODE_SHA256`(코드의 SHA-256, GitHub 비밀값)과 비교하고 값이 없으면 꺼진다. 들어오면 손님 목록에 보이지 않는 심사용 가게(`Store.businessNo` = `REVIEW-STORE`)와 예시 상품을 없을 때 만들고, 상태별 예시 주문 8건을 처음 상태로 되돌린다. 심사용 계정은 예시 주문이 있어도 탈퇴되고 그 가게는 지워진다
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
  - `/v1/seller/store/:storeId/products/description-draft` - 상품 상세설명 AI 초안 (POST)
- **상품**: `/v1/seller/products/*` - 상품 CRUD
- **주문**: `/v1/seller/orders/*` - 주문 관리
- **피드**: `/v1/seller/feed/*` - 피드 CRUD
- **견적**: `/v1/seller/stores/:storeId/quote-requests/:requestId` - 채팅방 요청서 카드의 요청서·이 가게 상태(GET), 견적 보내기·고치기(`quote`), 어려워요(`decline`)
- **채팅**: `/v1/seller/stores/:storeId/chats/*` - 목록(`?filter=reply|all`)·안 읽은 수·답할 수(`unread`: `replyNeeded`, 홈 "견적 요청" `quoteRequests`, 그 방을 뺀 "답할 채팅" `replyNeededChats`)·규칙 동의·방·글·보내기·알림 끔·차단·신고, `orders/:orderId`(GET 방 찾기, POST 픽업 전 예약 손님에게 주문 카드와 함께 먼저 보내기). 손님이 보낸 글은 판매자 앱 푸시 "새 문의가 왔어요"(`data.path` = `/stores/:storeId/chats/:threadId`, 채팅 알림 끔·밤 9시~아침 8시 끄기·방 알림 끔이면 안 보냄)
- **통계**: `/v1/seller/statistics/*` - 매출/주문 통계
- **FCM 토큰(판매자 앱)**: `/v1/seller/fcm-tokens` - 판매자 앱 푸시 토큰 등록·해제(빈 토큰) (POST), `/v1/seller/fcm-tokens/test` - 테스트 알림, 받은 기기 수를 돌려줌 (POST). 손님·자동 처리·관리자가 바꾼 주문 상태(새 예약신청, 입금완료, 손님 취소·환불 요청 등)는 판매자 앱으로도 푸시하고 `data.path`에 판매자 웹 주문 상세 경로를 담음(기획 I-48). 내용은 "상품 이름(여러 개면 개수) · 픽업 일시"(판매자 페이지 안 알림도 같음), 스토어가 둘 이상이면 제목 앞에 [스토어 이름]. 픽업 시각이 되어 픽업대기로 바뀐 것은 푸시하지 않음. 아침 요약: 매일 8시~11시 사이 한 번, 그날 픽업이 있는 스토어마다 "오늘 픽업 n건 / 첫 픽업 hh:mm"(`data.path` = 스토어 홈)
- **알림**: `/v1/seller/notifications/*` - 알림 목록/설정(스토어별: 주문 알림 받기, 주문 알림 소리, 아침 요약 `morningSummaryEnabled`, 채팅 알림 `chatNotificationsEnabled`, 밤 채팅 알림 끄기 `chatQuietNight`)
- **홈**: `/v1/seller/home/*` - 판매자 홈 대시보드
- **마이페이지**: `/v1/seller/mypage/*` - 판매자 정보 조회/수정
- **업로드**: `/v1/seller/uploads/file` - 파일 업로드 (POST, multipart/form-data)

### Admin API (`/v1/admin`)

- **인증**: `/v1/admin/auth/*` - TOTP 기반 관리자 인증
- **마이페이지**: `/v1/admin/mypage/*` - 관리자 정보 조회
- **통계**: `/v1/admin/statistics/*` - 회원/주문/스토어/입점요청 통계
- **회원 관리**: `/v1/admin/member-management/*` - 소비자/판매자 회원 관리
- **스토어 관리**: `/v1/admin/store-management/*`, `/v1/admin/store-entry-request-management/*`
- **견적 요청**: `/v1/admin/quote-request-management/*` - 견적 요청 목록(견적 받는 중·가게 연결·마감, 견적이 들어온 길별 수)·상세, `requests/:id/quotes`(가게별 상태·견적·대화), `stores`(가게 더하기, 입점 가게면 판매자 앱으로 바로), `stores/:targetId/link`(견적 링크 만들기)·`quote`(대신 적기)·`decline`, `chosen-notified`(입점 전 가게를 고른 뒤 "알렸어요"), `close`(요청 마감하기)
- **채팅**: `/v1/admin/chat/summary`(매일 브리핑용: 처리할 신고·스토어가 답하지 않은 방·최근 24시간 글 수, 대화 내용 없음), `/v1/admin/chat/reports`(최근 100개, `?status=OPEN|RESOLVED`), `reports/:id`(최근 대화 50개 원문, 열면 열람 기록 `chat_access_logs`), PATCH `reports/:id`(`HIDE_MESSAGE` + `messageIds` 고른 메시지 가리기 / `NONE`)
- **관리자 계정 관리**: `/v1/admin/admin-management/*` - 관리자 계정/권한 관리
- **판매자 세그먼트 관리**: `/v1/admin/seller-segment-management/*`
- **콘텐츠 관리**: `/v1/admin/home-banners/*`, `/v1/admin/notices/*`, `/v1/admin/qnas/*`, `/v1/admin/terms/*`

### WebSocket

- **알림**: `ws://localhost:3000/notifications` (namespace: `/notifications`) - 실시간 주문 알림 (Seller + Consumer), 채팅 신호 `chat_updated` `{ threadId, storeId, senderName?, muted? }`(글 내용 없음)

### API 문서

- **Consumer API**: http://localhost:3000/v1/docs/consumer
- **Seller API**: http://localhost:3000/v1/docs/seller
- **Admin API**: http://localhost:3000/v1/docs/admin
