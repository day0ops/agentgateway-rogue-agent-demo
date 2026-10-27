#!/bin/sh
# Stops the port-forwards scripts/k8s-forward.sh started.
set -eu

cd "$(dirname "$0")/.."
PID_DIR=.pids

for name in agentgateway rogue-agent-app mission-control-app; do
  pidfile="$PID_DIR/forward-$name.pid"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    # Kill the current kubectl child first, then the watchdog loop itself -
    # otherwise the loop can relaunch a new kubectl before it dies.
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
done
