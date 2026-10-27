FROM oven/bun:1
WORKDIR /app

# kubectl is only used when RUNTIME_MODE=kubernetes (reset restarts the
# agentgateway Deployment in-cluster instead of shelling out to podman/docker
# scripts). Harmless to include unconditionally; it's a single static binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" \
  && chmod +x /usr/local/bin/kubectl \
  && apt-get purge -y curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json lib.js server.js ./
COPY public ./public
EXPOSE 5174
CMD ["bun", "server.js"]
