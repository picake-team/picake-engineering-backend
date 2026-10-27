# CLAUDE.md

Picake(디저트 주문 플랫폼)의 **백엔드 API 서버** 레포입니다. NestJS + Prisma + PostgreSQL, AWS EC2 배포.

## 레포 구성

| 레포                            | 내용                                                                        | 로컬 위치(권장)                              |
| ------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `picake-engineering-backend`    | 백엔드 API 서버 (현재 레포)                                                 | -                                            |
| `picake-engineering-web`        | 웹 프론트엔드 (`web-user`, `web-seller`, `web-admin`)                       | 형제 폴더 `../picake-engineering-web`        |
| `picake-engineering-app`        | Flutter 앱 (`web-user`을 감싸는 WebView 앱)                                 | -                                            |
| `picake-engineering-automation` | Claude 클라우드 루틴·운영 자동화 스킬 (인프라 모니터링, 일일 데이터 리포트) | 형제 폴더 `../picake-engineering-automation` |

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

## web 레포의 도메인 skill

소셜 로그인(OAuth), 앱 딥링크(Universal/App Links), 약관·사업자정보, iOS 앱스토어 심사 대응은 backend 코드도 함께 다루지만 skill은 web 레포에 있습니다. 이런 작업은 형제 폴더 `../picake-engineering-web/.claude/skills/`의 `picake-auth-social-login`, `picake-link-app-deep-links`, `picake-legal-terms`, `picake-review-ios-app-store` 문서를 읽고 따르세요.

## 운영 skill (automation 레포)

아래 요청은 이 레포에 skill이 없습니다. 형제 폴더 `../picake-engineering-automation`의 skill 문서를 읽고 그 절차를 따르세요(없으면 `picake-team/picake-engineering-automation`을 clone).

| 요청 예                                               | skill 문서                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| "인프라 상태 어때", "이번 달 비용", "서버 업그레이드" | `../picake-engineering-automation/.claude/skills/picake-infra-monitor/SKILL.md` |
| "사용자 데이터 보여줘", "전환율 어때", "회원수"       | `../picake-engineering-automation/.claude/skills/picake-data-report/SKILL.md`   |
