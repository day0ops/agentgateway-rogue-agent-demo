#!/bin/sh
# Deploys the full demo stack into a running Kubernetes cluster (lok8s or
# kind - this script doesn't care which).
#
# The agentgateway ConfigMap is generated here from agentgateway/config.yaml
# rather than checked in as part of k8s/agentgateway.yaml, so the two never
# need to be hand-kept in sync.
set -eu

cd "$(dirname "$0")/.."

kubectl create configmap agentgateway-config \
  --from-file=config.yaml=agentgateway/config.yaml \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f k8s/mock-llm-server.yaml
kubectl apply -f k8s/agentgateway.yaml
kubectl apply -f k8s/rogue-agent-app.yaml
kubectl apply -f k8s/mission-control-app.yaml

echo "Waiting for deployments to become ready..."
kubectl rollout status deployment/mock-llm-server --timeout=60s
kubectl rollout status deployment/agentgateway --timeout=60s
kubectl rollout status deployment/rogue-agent-app --timeout=60s
kubectl rollout status deployment/mission-control-app --timeout=60s

echo "All deployments ready."

# The three Services are type: LoadBalancer. lok8s (ships MetalLB) assigns a
# real IP within seconds; kind (no MetalLB) leaves them pending forever.
lb_ip() {
  kubectl get svc "$1" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null
}

tries=0
while [ "$tries" -lt 6 ]; do
  AGW_IP=$(lb_ip agentgateway)
  RAA_IP=$(lb_ip rogue-agent-app)
  MCA_IP=$(lb_ip mission-control-app)
  if [ -n "$AGW_IP" ] && [ -n "$RAA_IP" ] && [ -n "$MCA_IP" ]; then
    break
  fi
  tries=$((tries + 1))
  sleep 1
done

echo
if [ -n "$AGW_IP" ] && [ -n "$RAA_IP" ] && [ -n "$MCA_IP" ]; then
  echo "LoadBalancer IPs assigned - no port-forward needed:"
  echo "  Rogue Agent app:   http://$RAA_IP:5173"
  echo "  Mission Control:   http://$MCA_IP:5174"
  echo "  agentgateway UI:   http://$AGW_IP:15000/ui"
else
  echo "No LoadBalancer IPs assigned (expected on kind without MetalLB)."
  echo "Run 'make forward' to expose the stack on localhost instead."
fi
