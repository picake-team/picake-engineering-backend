#!/usr/bin/env bash
# CI에서 apps/backend/.env.test를 가짜 값으로 생성한다.
#
# 이 파일을 쓰는 곳 (필수 env가 바뀌면 이 스크립트 한 곳만 고치면 된다):
#   - 이 레포 .github/workflows/test-backend.yml (unit/integration/e2e)
#   - picake-engineering-web 레포 .github/workflows/test-web-e2e.yml (backend-repo/로 checkout해서 사용)
#
# 사용법:
#   create-env-test.sh                # 통합/E2E 테스트용 (Nest 앱을 listen 없이 compile만 함)
#   create-env-test.sh --with-server  # start:test(main.ts)로 실제 서버를 띄울 때 (PORT, CORS_ORIGIN 추가)
#
# DATABASE_URL은 CI의 services.postgres 컨테이너(picake_backend_test)를 가리킨다.
# 필요하면 DATABASE_URL 환경변수로 덮어쓸 수 있다.
#
# 로컬의 .env.test(개발 자격증명 복제본일 수 있음)를 덮어쓰지 않도록 CI에서만 실행된다.
# 외부 API를 실제로 호출하는 경로는 테스트에서 타지 않으므로 값은 전부 가짜여도 된다.
# (생성자에서 값이 없으면 throw하는 provider들만 채운다. 나머지 GOOGLE/KAKAO/FIREBASE 등은
# 미설정 시 조용히 비활성화되도록 코드가 짜여 있다.)
set -euo pipefail

if [ "${CI:-}" != "true" ]; then
  echo "CI 환경(CI=true)에서만 실행합니다. 로컬 .env.test를 덮어쓰지 않기 위함입니다." >&2
  exit 1
fi

WITH_SERVER=false
for arg in "$@"; do
  case "$arg" in
    --with-server) WITH_SERVER=true ;;
    *)
      echo "알 수 없는 옵션: $arg" >&2
      exit 1
      ;;
  esac
done

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$BACKEND_DIR/.env.test"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/picake_backend_test?schema=public}"

{
  echo "NODE_ENV=test"
  # start:test(=main.ts)는 실제로 포트를 열고 CORS를 검사한다. PORT가 없으면
  # app.listen(NaN)이 에러도 없이 조용히 멈추므로 서버를 띄울 때만 필수다.
  if [ "$WITH_SERVER" = "true" ]; then
    echo "PORT=3000"
    echo "CORS_ORIGIN=http://localhost:3001"
  fi
  cat <<EOF
DATABASE_URL="$DATABASE_URL"
JWT_SECRET=ci-test-jwt-secret-do-not-use-in-real-env
DATA_GO_KR_API_KEY=ci-test-fake-key
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=ci-test-fake-access-key-id
AWS_SECRET_ACCESS_KEY=ci-test-fake-secret-access-key
S3_BUCKET=ci-test-fake-bucket
APPLE_TEAM_ID=ci-test-team-id
APPLE_KEY_ID=ci-test-key-id
APPLE_PRIVATE_KEY=ci-test-fake-private-key
APPLE_CLIENT_ID=ci-test-client-id
APPLE_REFRESH_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
EOF
} > "$OUT"

echo "created $OUT (with-server=$WITH_SERVER)"
