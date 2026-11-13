# CLAUDE.md

Picake(디저트 주문 플랫폼)의 **백엔드 API 서버** 레포입니다. NestJS + Prisma + PostgreSQL, AWS EC2 배포.

## 레포 구성

| 레포                         | 내용                                                                                                                                                             | 로컬 위치(권장)                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `picake-engineering-backend` | 백엔드 API 서버 (현재 레포)                                                                                                                                      | -                                     |
| `picake-engineering-web`     | 웹 프론트엔드 (`web-user`, `web-seller`, `web-admin`, `web-info`)                                                                                                | 형제 폴더 `../picake-engineering-web` |
| `picake-engineering-app`     | 손님·사장님 앱 (웹을 담는 앱 껍데기, 2026-11-13 Flutter → Capacitor로 옮기는 중). 알림 내용(data.path)·앱 링크 경로는 그 레포 `docs/bridge-contract.md`와 맞춘다 | 형제 폴더 `../picake-engineering-app` |
| `picake-hq` (비공개)         | 회사 운영·운영 자동화 (매일 브리핑, 주간 회의, 데이터 리포트·인프라 점검 skill)                                                                                  | 형제 폴더 `../picake-hq`              |

- 코드는 `apps/backend`에 있습니다. EC2 배포 스크립트가 이 경로와 루트 `package.json`/`yarn.lock`을 전제로 하므로 구조를 바꾸지 않습니다.
- 프로젝트 공통 문서(프로젝트 구조, 인증·채팅 등 기능 가이드, AI 에이전트 가이드)는 web 레포 `docs/common`이 정본입니다. 이 레포의 `docs`에는 backend·AWS 인프라 문서만 둡니다.

## 자주 쓰는 명령

```bash
yarn backend:dev                # 개발 서버 (apps/backend/.env.development 필요)
yarn backend:build
yarn backend:test:unit
yarn backend:test:integration   # .env.test + 로컬 Postgres 필요
yarn backend:test:e2e           # .env.test + 로컬 Postgres 필요
yarn workspace @picake/backend ai:draft-smoke   # 실제 Claude API로 AI 초안 점검 (ANTHROPIC_API_KEY 필요, 보통은 GitHub Actions `AI Draft Smoke`로)
yarn common:lint && yarn common:format:check
```

의존성 추가는 `npm`이 아니라 `corepack yarn workspace @picake/backend add <pkg>`를 씁니다.

## 작업 규칙

- 커밋 메시지: `picake-git-commit-convention` skill (`[BE]` / `[COMMON]`)
- PR: `picake-git-pr-create` skill. 작업 브랜치 → `staging` → `main`
- 배포: `backend/staging-*`, `backend/production-*` 태그 푸시로 EC2 배포 (`picake-deploy-release` skill, `/push-staging`, `/push-production`)
- **공개 레포입니다.** 비밀번호·토큰·키, 개인 휴대폰 번호, 계정 비밀번호를 코드·문서·skill·커밋에 적지 않습니다. 심사 기록처럼 남겨야 할 내용에 이런 값이 들어가면 `{…}`로 가리고 값은 운영자 비밀번호 관리자에 둡니다(2026-11-05 iOS 심사 skill에서 비밀번호가 노출돼 바꾼 일이 있음). 비공개로 남길 기록은 `picake-hq`에 씁니다.
- PR 필수 체크는 `test-backend`입니다. 이 워크플로우 트리거에 `paths:` 필터를 넣지 마세요(필수 체크가 보고되지 않아 PR이 머지 불가가 됨).
- web 레포의 e2e(`test-web-e2e.yml`)가 이 레포를 checkout해 backend를 띄웁니다. 레포를 private로 바꾸면 그 워크플로우에 토큰이 필요합니다.

## web 레포의 도메인 skill

소셜 로그인(OAuth), 앱 딥링크(Universal/App Links), 약관·사업자정보, iOS 앱스토어 심사 대응은 backend 코드도 함께 다루지만 skill은 web 레포에 있습니다. 이런 작업은 형제 폴더 `../picake-engineering-web/.claude/skills/`의 `picake-auth-social-login`, `picake-link-app-deep-links`, `picake-legal-terms`, `picake-review-ios-app-store` 문서를 읽고 따르세요.

## 운영 skill (picake-hq 레포)

아래 요청은 이 레포에 skill이 없습니다. 형제 폴더 `../picake-hq`(비공개)의 skill 문서를 읽고 그 절차를 따르세요(없으면 `picake-team/picake-hq`를 clone).

| 요청 예                                               | skill 문서                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| "인프라 상태 어때", "이번 달 비용", "서버 업그레이드" | `../picake-hq/.claude/skills/picake-infra-monitor/SKILL.md` |
| "사용자 데이터 보여줘", "전환율 어때", "회원수"       | `../picake-hq/.claude/skills/picake-data-report/SKILL.md`   |
