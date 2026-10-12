# Deploying Werewolf

These files deploy the game to a **single-node k3s** cluster fronted by
**Caddy** (auto Let's Encrypt), pulling images from a registry you control.
Werewolf runs as one container: it builds the client and serves it plus the
WebSocket API on port 3000. (Caddy proxies WebSockets transparently — no extra
config needed.)

Nothing here hardcodes a host name. Point it at your own infrastructure with:

| Variable | What it is | Example |
| --- | --- | --- |
| `HOMELAB_VPS` | ssh target for the cluster node | `user@host` |
| `HOMELAB_REGISTRY` | registry hostname | `registry.example.com` |

Set them in your environment, or keep them in **`deploy/local.env`** — which is
gitignored, so your host names stay out of the repo:

```bash
# deploy/local.env
HOMELAB_VPS=user@host
HOMELAB_REGISTRY=registry.example.com
```

## Files here

- **`../Dockerfile`** — builds the client and runs the server on :3000.
- **`werewolf.yaml`** — k8s Deployment, Service and a 1Gi PersistentVolumeClaim
  (namespace `homelab`). The volume holds the anonymous finished-game records,
  so the stats survive a redeploy.
- **`deploy.sh`** — build → push → apply → restart.
- **`caddy-block.txt`** — the site block to add to your Caddyfile. It names a
  host; change it to your own domain.

## One-time setup

1. **DNS** — add an A record for your chosen hostname pointing at the node.
   Let's Encrypt (via Caddy) needs it resolving before it can issue a
   certificate.

2. **Caddy route** — add the block from `caddy-block.txt` to your Caddyfile
   ConfigMap, then redeploy Caddy (`kubectl apply -f <your caddy.yaml> &&
   kubectl rollout restart -n homelab deployment/caddy`).

3. **Registry auth** — `docker login $HOMELAB_REGISTRY` once, with whatever
   credential your registry uses.

4. **Namespace** — the manifest assumes a `homelab` namespace exists.

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
