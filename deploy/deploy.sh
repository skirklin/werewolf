#!/usr/bin/env bash
# Standalone deploy for werewolf into the homelab k3s cluster.
# Builds the image, pushes it to the in-cluster registry, applies the manifest,
# and restarts the deployment. Run from this repo root on the machine that has
# the homelab SSH key (1Password agent) and `docker login registry.example.com`.
set -euo pipefail

VPS="${HOMELAB_VPS:-user@host}"
REGISTRY="${HOMELAB_REGISTRY:-registry.example.com}"
IMAGE="$REGISTRY/homelab/werewolf:latest"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building $IMAGE"
docker build -t "$IMAGE" "$HERE"

echo "==> Pushing to registry (needs: docker login $REGISTRY)"
docker push "$IMAGE"

echo "==> Applying manifest on $VPS"
scp "$HERE/deploy/werewolf.yaml" "$VPS:/tmp/werewolf.yaml"
ssh "$VPS" "kubectl apply -f /tmp/werewolf.yaml && kubectl rollout restart -n homelab deployment/werewolf && kubectl rollout status -n homelab deployment/werewolf --timeout=120s"

echo "==> Done. Ensure a Caddy site block + DNS A record exist (see deploy/README.md)."
