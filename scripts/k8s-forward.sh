#!/bin/sh
# Port-forwards the stack to localhost. Each tunnel runs in a watchdog loop
# that restarts it if it drops - kubectl port-forward exits (and stays dead)
# whenever its backing pod restarts, which happens often during this demo
# (resets, image updates). Backgrounded with PID tracking.
set -eu

cd "$(dirname "$0")/.."
PID_DIR=.pids
mkdir -p "$PID_DIR"

forward() {
  name="$1"
  shift
  (
    while true; do
      kubectl port-forward "svc/$name" "$@" >> "$PID_DIR/forward-$name.log" 2>&1
      echo "$(date '+%H:%M:%S') svc/$name port-forward exited, retrying in 2s..." >> "$PID_DIR/forward-$name.log"
      sleep 2
    done
  ) &
  echo $! > "$PID_DIR/forward-$name.pid"
}

forward agentgateway 4000:4000 15000:15000 19001:19001 19002:19002
forward rogue-agent-app 5173:5173
forward mission-control-app 5174:5174

sleep 2
echo "Rogue Agent app:   http://localhost:5173"
echo "Mission Control:   http://localhost:5174"
echo "agentgateway UI:   http://localhost:15000/ui"
echo
echo "Stop: scripts/k8s-stop-forward.sh"
