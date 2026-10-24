# Deploying Werewolf

These files deploy the game to a **single-node k3s** cluster fronted by
**Caddy** (auto Let's Encrypt), pulling images from a registry you control.
Werewolf runs as one container: it builds the client and serves it plus the
WebSocket API on port 3000. (Caddy proxies WebSockets transparently — no extra
config needed.)

**Normally you do not run any of this by hand.** Pushing to `main` runs CI, and
a green CI triggers the Deploy workflow, which builds the image, publishes it to
GHCR and rolls out over SSH. The script here is the fallback for when GitHub is
not an option.

Images live at `ghcr.io/<owner>/werewolf`, tagged `latest` and `sha-<commit>`.
A rollout pins the deployment to the sha tag, so what is running always traces
back to a commit and `kubectl rollout undo` goes back to one.

Point the script at your own infrastructure with:

| Variable | What it is | Default |
| --- | --- | --- |
| `HOMELAB_VPS` | ssh target for the cluster node | required |
| `WEREWOLF_IMAGE` | image repository | `ghcr.io/skirklin/werewolf` |

Set them in your environment, or keep them in **`deploy/local.env`** — which is
gitignored, so your host names stay out of the repo:

```bash
# deploy/local.env
HOMELAB_VPS=user@host
```

## Files here

- **`../Dockerfile`** — builds the client and runs the server on :3000.
- **`werewolf.yaml`** — k8s Deployment, Service and a 1Gi PersistentVolumeClaim
  (namespace `homelab`). The volume holds the anonymous finished-game records
  and the saved live rooms, so the stats and games in progress survive a redeploy.
- **`deploy.sh`** — build → push → apply → restart.
- **`caddy-block.txt`** — the site block to add to your Caddyfile. It names a
  host; change it to your own domain.

## One-time setup

1. **DNS** — add an A record for your chosen hostname pointing at the node.
   Let's Encrypt (via Caddy) needs it resolving before it can issue a
   certificate.

2. **GitHub secrets** — the Deploy workflow needs `SSH_PRIVATE_KEY`,
   `SSH_KNOWN_HOSTS` (from `ssh-keyscan`) and `HOMELAB_VPS` on a `production`
   environment, plus an optional `SITE_URL` to health-check after rollout.
   Leave `production` without required reviewers but limit its deployment
   branches to `main`. Create a second, secretless `production-approval`
   environment with required reviewers: deploys started by anyone but the
   repository owner wait on it, while the owner's own pushes deploy directly.

3. **Caddy route** — add the block from `caddy-block.txt` to your Caddyfile
   ConfigMap, then redeploy Caddy (`kubectl apply -f <your caddy.yaml> &&
   kubectl rollout restart -n homelab deployment/caddy`).

4. **Registry** — the workflow authenticates to GHCR with the run's own
   `GITHUB_TOKEN`, so there is nothing to configure. The package must be
   **public**, or the cluster needs an `imagePullSecret`. To push by hand
   instead, `docker login ghcr.io` with a token carrying `write:packages`.

5. **Namespace** — the manifest assumes a `homelab` namespace exists.

## Deploy

```bash
./deploy/deploy.sh
```

Requires Docker running and your cluster SSH key available to the agent.

## Where the data lives

Finished-game records append to `$WEREWOLF_DATA_DIR/games.jsonl` inside the
container, which the manifest mounts at `/data` from the PVC. Pull them out
with `kubectl cp`, or read the aggregates at `/api/stats`. With no
`WEREWOLF_DATA_DIR` set the records stay in memory and vanish on restart, which
is what happens in local development.

Live rooms are kept beside them in `$WEREWOLF_DATA_DIR/rooms.json`: the server
saves them on SIGTERM (and every 30 seconds as a backstop) and loads them on
start, so a deploy doesn't end games in progress — phones reconnect into the
same game. That's why the Deployment uses the `Recreate` strategy (the old pod
must save before the new one loads) and why the container runs `node` directly
(so it receives the signal). A room whose saved state the new build can't read
— its game's `stateVersion` changed — is skipped, and those players start a
new room.
