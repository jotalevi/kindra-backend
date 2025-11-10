#!/usr/bin/env bash
set -euo pipefail

SCALE="${KINDRA_SCALE:-4}"

if docker compose version >/dev/null 2>&1; then
  docker compose build
  docker compose up --scale "app=${SCALE}"
else
  docker-compose build
  docker-compose up --scale "app=${SCALE}"
fi

