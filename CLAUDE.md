# CLAUDE.md

Picake(디저트 주문 플랫폼)의 **백엔드 API 서버** 레포입니다. NestJS + Prisma + PostgreSQL, AWS EC2 배포.

## 레포 구성

| 레포                         | 내용                                                  | 로컬 위치(권장)                       |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `picake-engineering-backend` | 백엔드 API 서버 (현재 레포)                           | -                                     |
| `picake-engineering-web`     | 웹 프론트엔드 (`web-user`, `web-seller`, `web-admin`) | 형제 폴더 `../picake-engineering-web` |
| `picake-engineering-app`     | Flutter 앱 (`web-user`을 감싸는 WebView 앱)           | -                                     |

- 코드는 `apps/backend`에 있습니다. EC2 배포 스크립트가 이 경로와 루트 `package.json`/`yarn.lock`을 전제로 하므로 구조를 바꾸지 않습니다.
- 프로젝트 공통 문서(프로젝트 구조, 인증·채팅 등 기능 가이드, AI 에이전트 가이드)는 web 레포 `docs/common`이 정본입니다. 이 레포의 `docs`에는 backend·AWS 인프라 문서만 둡니다.

## 자주 쓰는 명령

```bash
yarn backend:dev                # 개발 서버 (apps/backend/.env.development 필요)
yarn backend:build
yarn backend:test:unit
yarn backend:test:integration   # .env.test + 로컬 Postgres 필요
yarn backend:test:e2e           # .env.test + 로컬 Postgres 필요
yarn common:lint && yarn common:format:check
```

의존성 추가는 `npm`이 아니라 `corepack yarn workspace @picake/backend add <pkg>`를 씁니다.

## 작업 규칙

- 커밋 메시지: `picake-git-commit-convention` skill (`[BE]` / `[COMMON]`)
- PR: `picake-git-pr-create` skill. 작업 브랜치 → `staging` → `main`
- 배포: `backend/staging-*`, `backend/production-*` 태그 푸시로 EC2 배포 (`picake-deploy-release` skill, `/push-staging`, `/push-production`)
- PR 필수 체크는 `test-backend`입니다. 이 워크플로우 트리거에 `paths:` 필터를 넣지 마세요(필수 체크가 보고되지 않아 PR이 머지 불가가 됨).
- web 레포의 e2e(`test-web-e2e.yml`)가 이 레포를 checkout해 backend를 띄웁니다. 레포를 private로 바꾸면 그 워크플로우에 토큰이 필요합니다.
