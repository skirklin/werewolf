#!/usr/bin/env bash
# Standalone deploy for werewolf into a single-node k3s cluster.
#
# Builds the image, pushes it to your registry, applies the manifest and
# restarts the deployment. Run from the repo root on a machine that has your
# cluster's SSH key loaded and is logged in to the registry.
#
# Normally you do not run this: pushing to main deploys via the Deploy
# workflow, which builds the same image and rolls out the same way. Keep this
# for when GitHub is not an option.
#
# Point it at your own infrastructure with:
#
#   HOMELAB_VPS       ssh target for the cluster node, e.g. user@host
#   WEREWOLF_IMAGE    image repository (default: ghcr.io/skirklin/werewolf)
#
# Set them in the environment, or keep them in deploy/local.env, which is
# gitignored precisely so a public checkout never carries anyone's host names.
# Pushing to GHCR by hand needs `docker login ghcr.io` with a token that has
# write:packages — `gh auth token` works if your gh login has that scope.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
[ -f "$HERE/deploy/local.env" ] && . "$HERE/deploy/local.env"

VPS="${HOMELAB_VPS:?set HOMELAB_VPS (e.g. user@host), or put it in deploy/local.env}"
REPO="${WEREWOLF_IMAGE:-ghcr.io/skirklin/werewolf}"
# Tag by commit as well as latest, so a manual deploy is as traceable as a
# workflow one and can be rolled back the same way.
TAG="sha-$(git rev-parse HEAD)"
IMAGE="$REPO:$TAG"

echo "==> Building $IMAGE"
docker build -t "$IMAGE" -t "$REPO:latest" "$HERE"

echo "==> Pushing to ${REPO%%/*} (needs: docker login ${REPO%%/*})"
docker push "$IMAGE"
docker push "$REPO:latest"

echo "==> Applying manifest on $VPS"
# Pin this build into the manifest so a single apply ships it (one restart).
sed -E "s|^( *)image: .*|\\1image: $IMAGE|" "$HERE/deploy/werewolf.yaml" > /tmp/werewolf.yaml
scp /tmp/werewolf.yaml "$VPS:/tmp/werewolf.yaml"
ssh "$VPS" "kubectl apply -f /tmp/werewolf.yaml && kubectl rollout status -n homelab deployment/werewolf --timeout=180s"

echo "==> Done. Ensure a Caddy site block + DNS A record exist (see deploy/README.md)."
