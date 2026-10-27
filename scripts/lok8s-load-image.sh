#!/bin/sh
# Loads a locally-built image into every node of a lok8s "native" cluster.
#
# `lok8s image-load` doesn't support the native provider yet, so this exports
# the image and imports it into each node's containerd via Apple's `container`
# CLI instead. Each node has its own image cache, so every node needs it.
set -eu

IMAGE="${1:?usage: lok8s-load-image.sh <image:tag>}"
PROJECT="${LOK8S_PROJECT:-rogue-demo}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-podman}"

TARBALL="/tmp/$(echo "$IMAGE" | tr '/:' '__').tar"
"$CONTAINER_RUNTIME" save "$IMAGE" -o "$TARBALL"

NODES=$(container list --format json | python3 -c "
import json, sys
nodes = json.load(sys.stdin)
for n in nodes:
    name = n.get('configuration', {}).get('id') or n.get('id', '')
    if name.startswith('$PROJECT-'):
        print(name)
")

if [ -z "$NODES" ]; then
  echo "No nodes found for project '$PROJECT' - is the cluster running?" >&2
  exit 1
fi

for node in $NODES; do
  echo "Loading $IMAGE into $node..."
  container copy "$TARBALL" "$node:/tmp/image.tar"
  container exec "$node" ctr -n k8s.io images import /tmp/image.tar
  container exec "$node" rm -f /tmp/image.tar
done

rm -f "$TARBALL"
echo "$IMAGE loaded into: $NODES"
