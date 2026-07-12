# Deploying Werewolf to the homelab VPS

The homelab is a single-node **k3s** cluster on a Hetzner VPS (`user@host`),
fronted by **Caddy** (auto Let's Encrypt), pulling images from an in-cluster
registry. Werewolf runs as one container: it builds the client and serves it
plus the WebSocket API on port 3000. (Caddy proxies WebSockets transparently —
no extra config needed.)

## Files here
- **`../Dockerfile`** — builds the client and runs the server on :3000.
- **`werewolf.yaml`** — k8s Deployment + Service (namespace `homelab`), modeled on
  `homelab/infra/k8s/api.yaml`.
- **`deploy.sh`** — build → push → apply → restart.
- **`caddy-block.txt`** — the site block to add to the homelab Caddyfile.

## One-time setup (things only you can do)

1. **DNS** — add an A record `werewolf.example.com → your.cluster.host` wherever `kirkl.in`
   DNS is managed. Let's Encrypt (via Caddy) needs this resolving first.

2. **Caddy route** — add the block from `caddy-block.txt` into
   `homelab/infra/k8s/caddy.yaml` (the Caddyfile ConfigMap), then redeploy Caddy
   from the homelab repo (e.g. `./infra/deploy.sh caddy`, or
   `kubectl apply -f infra/k8s/caddy.yaml && kubectl rollout restart -n homelab deployment/caddy`).

3. **Registry auth** — `docker login registry.example.com` once (basic auth
   `deploy:<REGISTRY_HTPASSWD>`, same credential the homelab deploy uses).

## Deploy

```bash
./deploy/deploy.sh
```

Requires the homelab SSH key available (1Password agent) and Docker running.
After it completes and DNS has propagated, the game is at **https://werewolf.example.com**.

## Alternative: integrate into homelab's deploy.sh
If you'd rather drive it from the homelab monorepo's `infra/deploy.sh`, add
`werewolf.yaml` to `homelab/infra/k8s/kustomization.yaml` `resources:` and a
`SERVICE_BUILDS[werewolf]` entry — but that script assumes the app lives inside
the monorepo, so the standalone `deploy.sh` here is the simpler path for a
separate repo.
