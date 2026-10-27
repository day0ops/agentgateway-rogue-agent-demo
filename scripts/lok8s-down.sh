#!/bin/sh
# Deletes the lok8s cluster, tearing down the entire in-cluster demo stack.
set -eu

LOK8S_PROJECT=${LOK8S_PROJECT:-rogue-demo}

"$(dirname "$0")/k8s-stop-forward.sh" 2>/dev/null || true
lok8s delete -e native -p "$LOK8S_PROJECT" --force
