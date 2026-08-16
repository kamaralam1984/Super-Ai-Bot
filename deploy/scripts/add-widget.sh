#!/usr/bin/env bash
#
# Injects the KVL chat widget into an existing nginx-proxied site with
# zero changes to that site's own source code, by rewriting its outgoing
# HTML on the way out (nginx's sub_filter module) — works regardless of
# what the target site is built with (Next.js, plain HTML, anything else
# sitting behind this host's own nginx).
#
# Idempotent and reversible: re-running it (e.g. a new installation id,
# or Enable Chatbot after Delete Chatbot) first strips any previously
# injected block before adding the current one, and every edit is
# preceded by a timestamped backup of the site's config file.
#
# Usage: sudo add-widget.sh <domain> <installation-id>
#
# Called two ways:
#   1. Directly by an admin (manual, ad hoc — e.g. onboarding a brand
#      new same-VPS site for the first time).
#   2. By kvl-installer-daemon.py, on behalf of a tenant's own "Install
#      Chatbot Automatically" button click — see that file's own header
#      for why this is gated behind a domain allowlist rather than
#      exposed for any arbitrary domain a tenant might type in.
set -euo pipefail

WIDGET_ORIGIN="${KVL_WIDGET_ORIGIN:-https://superai.kvlbusinesssolutions.com}"
MARKER_START="# --- kvl-chatbot-widget:start ---"
MARKER_END="# --- kvl-chatbot-widget:end ---"

domain="${1:?Usage: add-widget.sh <domain> <installation-id>}"
installation_id="${2:?Usage: add-widget.sh <domain> <installation-id>}"

# Same validation the daemon already does before ever invoking this
# script — repeated here so the script is also safe to run by hand.
if [[ ! "$domain" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]]; then
  echo "Refusing: '$domain' doesn't look like a valid domain." >&2
  exit 1
fi
if [[ ! "$installation_id" =~ ^inst_[a-zA-Z0-9]{6,64}$ ]]; then
  echo "Refusing: '$installation_id' doesn't look like a valid installation id." >&2
  exit 1
fi

conf_path=""
for candidate in \
  "/etc/nginx/sites-available/$domain" \
  "/etc/nginx/sites-available/${domain}.conf" \
  "/etc/nginx/conf.d/${domain}.conf"
do
  if [[ -f "$candidate" ]]; then
    conf_path="$candidate"
    break
  fi
done

# Filename doesn't have to match the domain (e.g. a site's config file
# is often named after the project, like "gravitypro.conf" for
# gravitypro.kvlbusinesssolutions.com) — fall back to searching every
# config file's actual `server_name` directive for the domain.
if [[ -z "$conf_path" ]]; then
  for dir in /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d; do
    [[ -d "$dir" ]] || continue
    match="$(grep -lE "server_name[^;]*[[:space:]]${domain}([[:space:];]|\$)" "$dir"/* 2>/dev/null | head -n1 || true)"
    if [[ -n "$match" ]]; then
      conf_path="$match"
      break
    fi
  done
fi

if [[ -z "$conf_path" ]]; then
  echo "No nginx config found serving '$domain' (checked sites-available/, sites-enabled/, conf.d/ by filename and by server_name)." >&2
  exit 2
fi
echo "Found $domain in $conf_path"

backup_path="${conf_path}.kvl-backup.$(date +%Y%m%d%H%M%S)"
cp "$conf_path" "$backup_path"
echo "Backed up $conf_path -> $backup_path"

# Strip any block this script added on a previous run before adding the
# current one, so re-running (new installation id, Enable after Delete)
# never stacks duplicate sub_filter directives.
stripped_path="$(mktemp)"
awk -v s="$MARKER_START" -v e="$MARKER_END" '
  $0 ~ s { skip=1 }
  !skip { print }
  $0 ~ e { skip=0 }
' "$conf_path" > "$stripped_path"

widget_snippet="    ${MARKER_START}
    proxy_set_header Accept-Encoding \"\";
    sub_filter '</body>' '<script src=\"${WIDGET_ORIGIN}/widget.js\" data-installation-id=\"${installation_id}\"></script></body>';
    sub_filter_once on;
    ${MARKER_END}"

# Insert the snippet into every `location` block by appending right
# after each block's opening brace — sub_filter only applies within the
# location block it's declared in, and a real site config commonly has
# more than one (e.g. a `/` block plus a separate `/api/` proxy block).
final_path="$(mktemp)"
awk -v snippet="$widget_snippet" '
  { print }
  /location[ \t]+.*\{[ \t]*$/ { print snippet }
' "$stripped_path" > "$final_path"
rm -f "$stripped_path"

cp "$final_path" "$conf_path"
rm -f "$final_path"

if ! nginx -t; then
  echo "nginx -t failed after edit — restoring backup and aborting." >&2
  cp "$backup_path" "$conf_path"
  exit 3
fi

systemctl reload nginx
echo "Widget installed on $domain (installation $installation_id)."
