# Frequently Asked Questions

**Is this a SaaS product?** No. Every deployment is self-hosted on the
client's own server — there is no central multi-tenant service, no shared
database across installations, and no vendor-operated infrastructure this
product depends on at runtime (not even for license checks — see
[docs/DEPLOYMENT.md](DEPLOYMENT.md#license-management)).

**Do I need Docker?** No, but it's the only fully-automated one-click
path (`deploy/scripts/install.sh`). A bare-metal/native deployment is
fully supported but more manual — see
[docs/INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md).

**Does it need internet access to run?** Yes, for a few specific
things: the local embedding model and OCR language packs download once
on first use and are cached persistently afterward (not re-downloaded on
restart — see DEPLOYMENT.md's "Docker Deployment" section for the fix
that made this true); SSL certificate issuance/renewal needs to reach
Let's Encrypt; and the chat engine needs internet only if you choose the
Anthropic Claude provider (`LLM_PROVIDER=anthropic`) rather than a
self-hosted model (`openai_compatible`, e.g. Ollama). The website
scanner obviously needs internet to reach the site it's scanning.

**Where's the vector database?** There isn't a separate one to stand up
— it's an embedded, file-based HNSW index
(`knowledge/vector/vectorStore.ts`), living under the `embeddings/`
runtime directory. A deliberate Phase 3 architectural choice, not
something Phase 11 needed to containerize separately.

**Can I run multiple instances behind a load balancer?** The Nginx
config's `upstream` block is already shaped for it (add a second `server`
line) and the app itself is stateless enough for horizontal scaling of
the *backend* — but Postgres/Redis are single-instance in the default
stack, and true zero-downtime updates aren't implemented (see
DEPLOYMENT.md's "Known limitations"). Multi-replica deployment is
possible with additional work, not out-of-the-box today.

**How do I back up before trying something risky?**
`deploy/scripts/backup.sh before-risky-change` — see
[docs/BACKUP_GUIDE.md](BACKUP_GUIDE.md).

**Can plugins run arbitrary code?** Not in this release — Plugin
Management covers the full install/enable/disable/permission-declaration
lifecycle, but no plugin code is ever executed. See DEPLOYMENT.md's
"Plugin Management" section for exactly why, stated honestly.

**Is there a license server I need to keep reachable?** No — license
validation is a local, offline Ed25519 signature check. See
DEPLOYMENT.md's "License Management" section.

**What happens if the health check fails after an update?**
`deploy/scripts/update.sh` rolls back automatically — see
[docs/UPGRADE_GUIDE.md](UPGRADE_GUIDE.md).

**Where do I report a bug or ask for help?** This is a self-hosted
product with no built-in support channel baked into the code — use
whatever support channel your organization/vendor relationship provides.

**Which Postgres/Redis/Node versions does this require?** PostgreSQL 16,
Redis 7, Node.js 20+ — pinned exactly in `deploy/docker-compose.yml` and
`deploy/docker/backend.Dockerfile` for the Docker path; match them if
deploying bare-metal.
