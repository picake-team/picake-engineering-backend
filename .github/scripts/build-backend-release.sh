#!/usr/bin/env bash
# EC2와 같은 환경(Amazon Linux 2023, ARM)에서 의존성 설치·빌드를 끝내고, 서버의 ~/picake에 그대로 풀 묶음(deploy.tar.gz)을 만든다.
#
#   docker run --rm -v "$PWD":/w -w /w public.ecr.aws/amazonlinux/amazonlinux:2023 bash .github/scripts/build-backend-release.sh
#
# deploy-*-backend-ec2.yml의 build 작업이 레포 루트에서 위처럼 부른다. 서버에서 하던
# `yarn workspaces focus @picake/backend` + `yarn run backend:build`와 같은 결과를 만들고,
# Prisma 엔진·bcrypt 같은 플랫폼별 파일도 서버 환경에 맞는 것이 들어간다.
# 서버(t4g.small, 메모리 2GB)에서 빌드하면 돌고 있는 앱·DB와 메모리를 나눠 써서 멈출 수 있어서(2026-11-04) 여기로 옮겼다.
set -euo pipefail

dnf install -y -q tar gzip >/dev/null

# Node 24 (package.json engines >=24). 공식 배포본을 받아 체크섬을 확인한다
NODE_DIST=https://nodejs.org/dist/latest-v24.x
curl -fsSL "$NODE_DIST/SHASUMS256.txt" -o /tmp/node-shasums.txt
NODE_TGZ=$(grep -oE 'node-v[0-9.]+-linux-arm64\.tar\.gz$' /tmp/node-shasums.txt | head -1)
curl -fsSL "$NODE_DIST/$NODE_TGZ" -o "/tmp/$NODE_TGZ"
(cd /tmp && grep " $NODE_TGZ\$" node-shasums.txt | sha256sum -c -)
tar -xzf "/tmp/$NODE_TGZ" -C /usr/local --strip-components=1
rm -f "/tmp/$NODE_TGZ" /tmp/node-shasums.txt
echo "node $(node --version)"

corepack enable
echo "yarn $(yarn --version)"

YARN_HTTP_TIMEOUT=60000 yarn workspaces focus @picake/backend
yarn run backend:build
test -f apps/backend/dist/main.js
test -d node_modules

# git 기록·yarn 캐시는 빼고 묶는다 (node_modules와 apps/backend/dist는 넣는다)
tar -czf /tmp/deploy.tar.gz --exclude=./.git --exclude=./.yarn/cache --exclude=./deploy.tar.gz .
mv /tmp/deploy.tar.gz ./deploy.tar.gz
echo "deploy.tar.gz $(du -h deploy.tar.gz | cut -f1)"
