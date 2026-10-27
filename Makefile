.PHONY: help up-lok8s up-kind down-lok8s down-kind forward stop-forward redeploy reset test

help:
	@echo "Create a cluster (pick one):"
	@echo "  make up-lok8s        Create via lok8s, build+load images, deploy the stack"
	@echo "  make up-kind         Create via kind, build+load images, deploy the stack"
	@echo ""
	@echo "Once a cluster exists:"
	@echo "  make forward         Port-forward the stack to localhost"
	@echo "  make stop-forward    Stop the port-forwards"
	@echo "  make redeploy        Re-apply manifests (after an image/config change)"
	@echo "  make reset           Reset agentgateway + rogue-agent-app to baseline"
	@echo "  make test            Run every component's test suite"
	@echo ""
	@echo "Tear down:"
	@echo "  make down-lok8s      Delete the lok8s cluster"
	@echo "  make down-kind       Delete the kind cluster"

up-lok8s:
	scripts/lok8s-up.sh

up-kind:
	scripts/kind-up.sh

down-lok8s:
	scripts/lok8s-down.sh

down-kind:
	scripts/kind-down.sh

forward:
	scripts/k8s-forward.sh

stop-forward:
	scripts/k8s-stop-forward.sh

redeploy:
	scripts/k8s-deploy.sh

reset:
	curl -s -X POST http://localhost:5174/api/reset

test:
	cd apps/mock-llm-server && bun test
	cd apps/rogue-agent-app && bun test
	cd apps/mission-control-app && bun test
	cd apps/history-seeder && bun test
