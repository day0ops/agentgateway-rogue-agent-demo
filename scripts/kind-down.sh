#!/bin/sh
# Deletes the kind cluster, tearing down the entire in-cluster demo stack.
set -eu

KIND_CLUSTER=${KIND_CLUSTER:-rogue-demo}
CONTAINER_RUNTIME=${CONTAINER_RUNTIME:-podman}
if [ "$CONTAINER_RUNTIME" = "podman" ]; then
  export KIND_EXPERIMENTAL_PROVIDER=podman
fi

"$(dirname "$0")/k8s-stop-forward.sh" 2>/dev/null || true
kind delete cluster --name "$KIND_CLUSTER"
