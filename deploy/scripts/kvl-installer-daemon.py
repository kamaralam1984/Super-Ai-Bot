#!/usr/bin/env python3
"""KVL Super AI Chatbot — same-VPS widget auto-installer (privileged helper).

Runs directly on the host as root via systemd (deploy/systemd/kvl-installer.service),
NOT inside Docker — the backend API container has no way to edit this
host's nginx config or reload it, by design (Docker isolation). This
tiny daemon is the one narrow, deliberately-scoped bridge across that
boundary: it listens on a Unix domain socket, accepts exactly two
commands, and does exactly one privileged thing (deploy/scripts/add-widget.sh).

Why a daemon instead of just letting the backend container run root
commands on the host: the backend is a public-facing multi-tenant SaaS
API. If it could run arbitrary host commands, a single bug in that API
would be a full host compromise — and this host also runs other,
unrelated client businesses. This daemon's entire attack surface is two
regex-validated string commands over a socket only the backend
container can reach; the backend can never pass it a raw shell string.

Domain allowlist (/etc/kvl/auto-install-domains.txt, one domain per
line, admin-edited by hand): auto-install is intentionally NOT offered
for any domain a tenant simply types in at signup. This VPS hosts
multiple unrelated businesses' sites behind the same host nginx — if
any signed-up tenant could point "their website" at someone else's live
domain and have this daemon inject a script tag into it, that's a
cross-business content-injection vulnerability. The allowlist is how a
tenant's site becomes eligible: the platform operator adds it here only
once they've verified they actually control that site (the same trust
boundary as originally running add-widget.sh by hand).

Protocol (newline-terminated, one request per connection):
  CHECK <domain>                    -> "OK" | "NOT_ALLOWED"
  INSTALL <domain> <installation-id> -> "OK" | "NOT_ALLOWED" | "INVALID_INSTALLATION_ID" | "ERROR <message>"
"""

import logging
import os
import re
import socketserver
import subprocess

SOCKET_PATH = os.environ.get("KVL_INSTALLER_SOCKET", "/run/kvl-installer/kvl-installer.sock")
SOCKET_GROUP_GID = int(os.environ.get("KVL_INSTALLER_SOCKET_GID", "10001"))  # matches backend.Dockerfile's `kvl` group
ALLOWLIST_PATH = os.environ.get("KVL_AUTO_INSTALL_ALLOWLIST", "/etc/kvl/auto-install-domains.txt")
ADD_WIDGET_SCRIPT = os.environ.get(
    "KVL_ADD_WIDGET_SCRIPT", "/opt/kvl-super-ai-chatbot/deploy/scripts/add-widget.sh"
)
LOG_PATH = os.environ.get("KVL_INSTALLER_LOG", "/var/log/kvl-installer.log")

DOMAIN_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
INSTALLATION_ID_RE = re.compile(r"^inst_[a-zA-Z0-9]{6,64}$")


def load_allowlist() -> set:
    """Re-read on every request (not cached) — an admin adding a new
    domain to the file should take effect immediately, no daemon restart."""
    if not os.path.exists(ALLOWLIST_PATH):
        return set()
    with open(ALLOWLIST_PATH, "r", encoding="utf-8") as f:
        return {
            line.strip().lower()
            for line in f
            if line.strip() and not line.strip().startswith("#")
        }


def is_allowed(domain: str) -> bool:
    return bool(DOMAIN_RE.match(domain)) and domain in load_allowlist()


class Handler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        raw = self.rfile.readline().decode("utf-8", "replace").strip()
        parts = raw.split()
        try:
            if len(parts) == 2 and parts[0] == "CHECK":
                domain = parts[1].lower()
                self._reply("OK" if is_allowed(domain) else "NOT_ALLOWED")
                return

            if len(parts) == 3 and parts[0] == "INSTALL":
                domain, installation_id = parts[1].lower(), parts[2]
                if not is_allowed(domain):
                    self._reply("NOT_ALLOWED")
                    return
                if not INSTALLATION_ID_RE.match(installation_id):
                    self._reply("INVALID_INSTALLATION_ID")
                    return
                self._install(domain, installation_id)
                return

            self._reply("BAD_REQUEST")
        except Exception:
            logging.exception("kvl-installer-daemon: unhandled error handling %r", raw)
            self._reply("ERROR internal error")

    def _install(self, domain: str, installation_id: str) -> None:
        # argv list, never shell=True — domain/installation_id are
        # already regex-validated above, but this is the second,
        # independent layer that actually matters: even a validation
        # bug here can't become shell injection.
        result = subprocess.run(
            [ADD_WIDGET_SCRIPT, domain, installation_id],
            capture_output=True,
            text=True,
            timeout=30,
        )
        logging.info(
            "install domain=%s installation=%s rc=%s", domain, installation_id, result.returncode
        )
        if result.returncode == 0:
            self._reply("OK")
        else:
            message = (result.stderr or result.stdout or "install script failed").strip()
            self._reply("ERROR " + message.replace("\n", " ")[:200])

    def _reply(self, message: str) -> None:
        self.wfile.write((message + "\n").encode("utf-8"))


def main() -> None:
    logging.basicConfig(
        filename=LOG_PATH,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    socket_dir = os.path.dirname(SOCKET_PATH)
    os.makedirs(socket_dir, mode=0o750, exist_ok=True)
    if os.path.exists(SOCKET_PATH):
        os.remove(SOCKET_PATH)

    server = socketserver.UnixStreamServer(SOCKET_PATH, Handler)
    # Group-writable by the backend container's `kvl` gid (10001) so the
    # Docker-bind-mounted socket is reachable from inside the container
    # without needing world-writable permissions.
    os.chmod(SOCKET_PATH, 0o660)
    try:
        os.chown(SOCKET_PATH, 0, SOCKET_GROUP_GID)
    except PermissionError:
        logging.warning("could not chown socket to gid %s — run this daemon as root", SOCKET_GROUP_GID)

    logging.info("kvl-installer-daemon listening on %s", SOCKET_PATH)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        if os.path.exists(SOCKET_PATH):
            os.remove(SOCKET_PATH)


if __name__ == "__main__":
    main()
