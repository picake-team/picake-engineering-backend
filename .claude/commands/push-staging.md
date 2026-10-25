---
description: 현재 브랜치를 푸시하고 staging 태그를 자동 증가시켜 스테이징 배포합니다
---

현재 브랜치를 푸시하고, `backend/staging-*` 태그를 마지막 버전 +1로 만들어 EC2 스테이징 배포까지 확인합니다. 이 명령을 실행한 것 자체가 배포 승인이므로 중간에 다시 묻지 않습니다.

## ⚠️ 푸시 대상 remote 결정 (`$REMOTE`)

태그·브랜치 푸시와 fetch는 **picake-team 원본 레포**를 가리키는 remote로 해야 합니다. 개인 포크를 쓰는 환경에서는 `origin`에 push URL이 두 개(개인 포크 + picake-team) 걸려 포크에도 함께 쏘므로 원본은 `upstream`으로 따로 둡니다. 포크 없이 직접 clone한 환경에는 `upstream`이 없고 `origin`이 곧 원본입니다.

```bash
# upstream이 있으면 upstream, 없으면 origin (Bash 호출마다 다시 정의해야 합니다)
REMOTE=$(git remote | grep -qx upstream && echo upstream || echo origin)
git remote get-url "$REMOTE"   # picake-team/picake-engineering-backend 인지 확인
```

이후 `$REMOTE`는 위 값을 뜻합니다. URL이 `picake-team/picake-engineering-backend`이 아니면 **멈추고** 사용자에게 알립니다.

## 1. 사전 확인

```bash
git status --short
git log --oneline -5
git fetch "$REMOTE" --tags --quiet
```

- 커밋 안 된 변경이 있으면 **멈추고** 사용자에게 알립니다 (`/commit` 안내). 배포는 커밋된 것만 나갑니다.
- 로컬 브랜치가 `$REMOTE`보다 뒤처져 있으면 알리고 멈춥니다.

## 2. 배포 대상

이 레포는 backend 전용이라 배포 대상은 항상 `backend`입니다. 웹(`web-user`/`web-seller`/`web-admin`)은 `picake-engineering-web` 레포에서 배포합니다.

## 3. 다음 버전 계산 (마지막 태그 +1)

```bash
PREFIX="backend/staging"
LAST=$(git tag --list "$PREFIX-v*" --sort=-v:refname | head -1)
VER=${LAST##*-v}
NEXT="$PREFIX-v${VER%.*}.$(( ${VER##*.} + 1 ))"
echo "$LAST → $NEXT"
```

패치 자리만 올립니다. major/minor를 올려야 할 변경이면 임의로 판단하지 말고 사용자에게 확인합니다.

## 4. 브랜치 푸시 → 태그 푸시

```bash
git push "$REMOTE" <현재브랜치>
git tag -a "$NEXT" -m "backend staging <버전> — <핵심 변경 한 줄>"
git push "$REMOTE" "$NEXT"
```

**⚠️ 태그가 여러 개면 한 명령에 묶지 말고 하나씩 푸시합니다.** 묶어서 푸시하면 태그는 생성되는데 GitHub Actions가 트리거되지 않는 현상이 있습니다.

## 5. 트리거 확인 (필수)

```bash
sleep 15
gh run list --repo picake-team/picake-engineering-backend --workflow deploy-staging-backend-ec2.yml --limit 3 \
  --json databaseId,headBranch,status,conclusion \
  --template '{{range .}}{{.databaseId}} {{.headBranch}} {{.status}} {{.conclusion}}{{"\n"}}{{end}}'
```

**run이 안 생겼으면** 태그를 지우고 다시 푸시합니다.

```bash
git push "$REMOTE" :refs/tags/"$NEXT"
git push "$REMOTE" "$NEXT"
```

## 6. 완료까지 관찰

```bash
gh run watch <run-id> --repo picake-team/picake-engineering-backend --exit-status
```

실패하면 로그를 확인해 원인을 보고합니다.

## 7. 실동작 검증

배포 성공 로그만 믿지 말고 실제 응답을 확인합니다. 변경한 API가 있으면 해당 경로도 직접 요청합니다.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api-staging.picakes.com/health
```

## 8. 보고

- 태그명, run 결과, 헬스체크 결과
- 확인한 API 경로와 응답
- 운영 배포는 `/push-production`이라고 안내
