#!/bin/sh
# Alternative to scripts/lok8s-up.sh for anyone without lok8s installed - kind
# is the far more commonly available local Kubernetes tool.
set -eu

cd "$(dirname "$0")/.."

KIND_CLUSTER=${KIND_CLUSTER:-rogue-demo}
CONTAINER_RUNTIME=${CONTAINER_RUNTIME:-podman}
if [ "$CONTAINER_RUNTIME" = "podman" ]; then
  export KIND_EXPERIMENTAL_PROVIDER=podman
fi

# `kind get clusters` shells out to the container runtime's own `ps --format`
# with a Go template kind assumes is docker-compatible; on at least one
# podman release that template breaks (an "index" error on the Labels field),
# which makes kind report no clusters even when one is running. Checking for
# the control-plane container by name directly sidesteps that.
if "$CONTAINER_RUNTIME" ps -a --format '{{.Names}}' | grep -qx "${KIND_CLUSTER}-control-plane"; then
  echo "kind cluster '$KIND_CLUSTER' already running."
else
  echo "Creating kind cluster '$KIND_CLUSTER'..."
  kind create cluster --name "$KIND_CLUSTER"
fi

# `kind create cluster` only points kubectl at the new cluster as a side
# effect of creating it - on the "already running" branch above nothing
# touches the current context, so a kubectl pointed at some other cluster
# would otherwise make the deploy step below silently target the wrong one.
kind export kubeconfig --name "$KIND_CLUSTER"

echo "Building images..."
"$CONTAINER_RUNTIME" build -t mock-llm-server:local apps/mock-llm-server
"$CONTAINER_RUNTIME" build -t rogue-agent-app:local apps/rogue-agent-app
"$CONTAINER_RUNTIME" build -t mission-control-app:local apps/mission-control-app
"$CONTAINER_RUNTIME" build -t history-seeder:local apps/history-seeder

# `kind load docker-image` always shells out to a literal `docker` binary to
# inspect and save the image, regardless of KIND_EXPERIMENTAL_PROVIDER - it
# can't see images built with podman and fails with "not present locally".
# `kind load image-archive` instead loads a tarball straight into the node
# containers through the configured provider, so it works with either
# runtime.
load_image() {
  image="$1"
  tarball="/tmp/$(echo "$image" | tr '/:' '__').tar"
  "$CONTAINER_RUNTIME" save -o "$tarball" "$image"
  kind load image-archive "$tarball" --name "$KIND_CLUSTER"
  rm -f "$tarball"
}

echo "Loading images into the cluster..."
load_image mock-llm-server:local
load_image rogue-agent-app:local
load_image mission-control-app:local
load_image history-seeder:local

echo "Deploying the stack..."
scripts/k8s-deploy.sh
