#!/usr/bin/env bash
# Standalone deploy for werewolf into a single-node k3s cluster.
#
# Builds the image, pushes it to your registry, applies the manifest and
# restarts the deployment. Run from the repo root on a machine that has your
# cluster's SSH key loaded and is logged in to the registry.
#
# Point it at your own infrastructure with two variables:
#
#   HOMELAB_VPS       ssh target for the cluster node, e.g. user@host
#   HOMELAB_REGISTRY  registry hostname, e.g. registry.example.com
#
# Set them in the environment, or keep them in deploy/local.env, which is
# gitignored precisely so a public checkout never carries anyone's host names.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
[ -f "$HERE/deploy/local.env" ] && . "$HERE/deploy/local.env"

VPS="${HOMELAB_VPS:?set HOMELAB_VPS (e.g. user@host), or put it in deploy/local.env}"
REGISTRY="${HOMELAB_REGISTRY:?set HOMELAB_REGISTRY (e.g. registry.example.com), or put it in deploy/local.env}"
IMAGE="$REGISTRY/homelab/werewolf:latest"

echo "==> Building $IMAGE"
docker build -t "$IMAGE" "$HERE"

echo "==> Pushing to registry (needs: docker login $REGISTRY)"
docker push "$IMAGE"

echo "==> Applying manifest on $VPS"
scp "$HERE/deploy/werewolf.yaml" "$VPS:/tmp/werewolf.yaml"
ssh "$VPS" "kubectl apply -f /tmp/werewolf.yaml && kubectl rollout restart -n homelab deployment/werewolf && kubectl rollout status -n homelab deployment/werewolf --timeout=120s"

echo "==> Done. Ensure a Caddy site block + DNS A record exist (see deploy/README.md)."
