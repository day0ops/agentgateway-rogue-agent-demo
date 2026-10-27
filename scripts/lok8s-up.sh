#!/bin/sh
# Creates (if needed) a lok8s cluster, builds the three demo images, loads them
# into every cluster node, and deploys the full stack.
#
# Images are loaded via scripts/lok8s-load-image.sh, not `lok8s image-load`
# (unsupported for the native provider).
set -eu

cd "$(dirname "$0")/.."

LOK8S_PROJECT=${LOK8S_PROJECT:-rogue-demo}
CONTAINER_RUNTIME=${CONTAINER_RUNTIME:-podman}
export LOK8S_PROJECT CONTAINER_RUNTIME

if lok8s status -e native -p "$LOK8S_PROJECT" 2>&1 | grep -q Running; then
  echo "lok8s cluster '$LOK8S_PROJECT' already running."
else
  echo "Creating lok8s cluster '$LOK8S_PROJECT' (native environment)..."
  lok8s create -e native -p "$LOK8S_PROJECT" --nodes 1 --num 1
fi

echo "Building images..."
"$CONTAINER_RUNTIME" build -t mock-llm-server:local apps/mock-llm-server
"$CONTAINER_RUNTIME" build -t rogue-agent-app:local apps/rogue-agent-app
"$CONTAINER_RUNTIME" build -t mission-control-app:local apps/mission-control-app
"$CONTAINER_RUNTIME" build -t history-seeder:local apps/history-seeder

echo "Loading images into cluster nodes..."
scripts/lok8s-load-image.sh mock-llm-server:local
scripts/lok8s-load-image.sh rogue-agent-app:local
scripts/lok8s-load-image.sh mission-control-app:local
scripts/lok8s-load-image.sh history-seeder:local

echo "Deploying the stack..."
scripts/k8s-deploy.sh
