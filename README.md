# Picake Backend

Picake(디저트 주문 플랫폼)의 백엔드 API 서버입니다. NestJS + Prisma + PostgreSQL 기반이며 AWS EC2에 배포합니다.

## 🧭 레포 구성

Picake 개발 코드는 아래 레포들로 나뉘어 있습니다.

| 레포                                                                                               | 내용                                                  |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **[picake-engineering-backend](https://github.com/picake-team/picake-engineering-backend)** (현재) | 백엔드 API 서버                                       |
| [picake-engineering-web](https://github.com/picake-team/picake-engineering-web)                    | 웹 프론트엔드 (`web-user`, `web-seller`, `web-admin`) |
| [picake-engineering-app](https://github.com/picake-team/picake-engineering-app)                    | Flutter 앱 (`web-user`을 감싸는 WebView 앱)           |
| [picake-engineering-automation](https://github.com/picake-team/picake-engineering-automation)      | Claude 클라우드 루틴·운영 자동화 스킬                 |

> 이 레포도 `apps/backend` 구조를 유지합니다. EC2 배포 스크립트가 이 경로와 루트의 `package.json`/`yarn.lock`을 전제로 하기 때문입니다.

## 🚀 시작하기

### 필수 요구사항

- Node.js (v24 이상)
- Yarn (v4.9.4 이상)

### 로컬 개발 환경변수 설정

- `apps/backend/.env.development` 삽입

### 로컬 개발 환경 데이터베이스 설정

- **[로컬 데이터베이스 설정 가이드](./docs/backend/기술%20스택%20-%20가이드.md)**: 로컬 PostgreSQL 및 Prisma ORM 관리

### 로컬 개발 환경 설치 및 실행

```bash
# 프로젝트 클론
git clone https://github.com/picake-team/picake-engineering-backend.git
cd picake-engineering-backend

# 의존성 설치(자동으로 postinstall 스크립트 실행, 이름 변경시 자동실행 안됨)
# 파일 경로에 한글이 존재하면 오류가 발생할 수 있습니다.
yarn install

# 개발 서버 시작(.env.development 환경변수 필요)
yarn backend:dev          # 백엔드 개발 서버 (포트: 3000)

# 데이터베이스 관리
yarn db:seed:dev           # 개발 데이터베이스 시드 (development)
yarn db:seed:staging       # 스테이징 데이터베이스 시드 (staging)
yarn db:migrate:dev        # 개발 데이터베이스 마이그레이션
yarn db:migrate:status     # 마이그레이션 상태 확인
yarn db:studio:dev         # 개발 데이터베이스 스튜디오

# 빌드
yarn backend:build         # 백엔드 빌드 (환경은 실행 시 NODE_ENV로 주입)

# 테스트
yarn backend:test:unit         # 단위 테스트
yarn backend:test:integration  # DB 통합 테스트 (.env.test, 로컬 Postgres 필요)
yarn backend:test:e2e          # e2e 테스트 (.env.test, 로컬 Postgres 필요)

# 코드 품질 검사
yarn common:lint              # ESLint 검사
yarn common:lint:fix          # ESLint 자동 수정
yarn common:format            # Prettier 포맷팅
yarn common:format:check      # Prettier 포맷팅 검사
```

> 웹 프론트엔드를 함께 띄우려면 [picake-engineering-web](https://github.com/picake-team/picake-engineering-web)을 같은 위치(형제 폴더)에 clone하세요.

## 🚀 배포 방법

### 태그 기반 CI/CD 구성

GitHub Actions를 통한 태그 기반 자동 배포 시스템을 사용합니다.

| 환경       | 태그 형식              | 배포 플랫폼 | 예시                        |
| ---------- | ---------------------- | ----------- | --------------------------- |
| staging    | `backend/staging-*`    | AWS EC2     | `backend/staging-v1.0.0`    |
| production | `backend/production-*` | AWS EC2     | `backend/production-v1.0.0` |

**태그 구조:** `backend/{환경}-{버전}` (버전 예: `v1.0.0`)

#### 배포 프로세스

1. 태그 생성 및 푸시
2. GitHub Actions 워크플로우 자동 실행 (`deploy-staging-backend-ec2.yml` / `deploy-production-backend-ec2.yml`)
3. 소스를 EC2에 업로드한 뒤 서버에서 마이그레이션, 빌드, PM2 재시작

웹 프론트엔드(Vercel) 배포는 [picake-engineering-web](https://github.com/picake-team/picake-engineering-web)에서 합니다.

## 👥 협업 규칙

이 문서는 Picake backend 레포의 협업 규칙을 정의합니다. 모든 팀원은 이 규칙을 준수해야 합니다.

### 🌿 브랜치 전략

#### 기본 원칙

1. **main 브랜치 보호**
   - `main` 브랜치로 직접 push는 **금지**됩니다.
   - GitHub의 브랜치 보호 규칙이 설정되어 있습니다.
   - `main` 브랜치로의 변경은 반드시 `staging` 브랜치를 거쳐야 합니다.

2. **staging 브랜치**
   - 개발 및 테스트를 위한 통합 브랜치입니다.
   - 모든 기능 개발은 `staging` 브랜치로 병합됩니다.

3. **hotfix 처리**
   - 긴급한 버그 수정이 필요한 경우, `hotfix` 브랜치에서 작업 후 `staging` 브랜치로 **직접 push** 가능합니다.
   - 프로덕션 환경에 즉시 반영이 필요한 경우에만 사용합니다.

4. **일반 기능 개발**
   - 모든 기능 개발은 **기능별 브랜치**를 생성하여 진행합니다.
   - 작업 완료 후 `staging` 브랜치로 **Pull Request(PR)**를 생성합니다.
   - PR 승인 후 병합됩니다.

#### 브랜치 워크플로우

```
main (보호됨)
  ↑
staging (통합 브랜치)
  ↑
feature/xxx (기능 브랜치)
hotfix/xxx (긴급 수정 브랜치)
```

### 📝 브랜치 네이밍 규칙

브랜치 이름은 기능의 목적을 명확히 표현해야 합니다.

#### 브랜치 네이밍 형식

```
{타입}/{기능-설명}
```

#### 브랜치 타입

- `feature/`: 새로운 기능 개발
- `hotfix/`: 긴급 버그 수정
- `fix/`: 일반 버그 수정
- `refactor/`: 코드 리팩토링
- `docs/`: 문서 수정
- `chore/`: 빌드, 설정 등 기타 작업

### 🔄 Pull Request 규칙

#### PR 생성 전 체크리스트

- [ ] 브랜치가 최신 `staging` 브랜치를 기반으로 생성되었는지 확인
- [ ] 코드가 정상적으로 작동하는지 확인
- [ ] `yarn run common:lint` 명령어를 통과했는지 확인
- [ ] `yarn run common:format:check` 명령어를 통과했는지 확인

### 💬 커밋 메시지 규칙

#### 프로젝트 타입

- `[COMMON]` - 루트 설정, 워크플로우, 문서 등 앱 밖의 변경
- `[BE]` - Backend (`apps/backend`)

#### 커밋 타입

- `[TASK]` - 일반 작업
- `[BUG]` - 버그 수정
- `[FEATURE]` - 새로운 기능 추가
- `[CHORE]` - 빌드, 설정 등 기타 작업
- `[DOCS]` - 문서 작성/수정
- `[FIX]` - 버그 수정
- `[REFACTOR]` - 코드 리팩토링
- `[REMOVE]` - 코드 삭제
- `[QUESTION]` - 질문/의견

#### 커밋 메시지 예시

```
[COMMON][CHORE]: 의존성 패키지 업데이트
[BE][FIX]: 인증 토큰 만료 처리 수정
[BE][FEATURE]: 주문 알림톡 발송 추가
```

## 📚 상세 문서

### 백엔드 문서

- **[Backend README](./docs/backend/README.md)**: 백엔드 서비스 개요 및 사용법
- **[Backend 기술 스택 가이드](./docs/backend/기술%20스택%20-%20가이드.md)**: 백엔드 기술 스택 및 아키텍처 (로컬 데이터베이스 설정 포함)
- **[Backend Sentry 가이드](./docs/backend/Sentry%20에러%20로깅%20통합%20설계%20-%20가이드.md)**: Sentry 에러 로깅 구조 (백엔드·프론트엔드)

### 인프라 문서

#### AWS 인프라

- **[EC2 배포 가이드(검증)](<./docs/infra/aws/(검증)EC2_Route53_S3_CloudFront.md>)**: AWS EC2 백엔드 배포 가이드 (PostgreSQL, Nginx, PM2, Route53, S3, CloudFront 포함)
- **[EC2 배포 가이드(상용)](<./docs/infra/aws/(상용)EC2_Route53_S3_CloudFront.md>)**: 프로덕션 환경 참고 (검증 가이드와 동일한 구성을 staging → production에 적용)

### 공통 문서 (web 레포)

프로젝트 전체 구조, 인증/채팅 등 기능 가이드는 [picake-engineering-web의 docs](https://github.com/picake-team/picake-engineering-web/tree/main/docs)에서 관리합니다.
