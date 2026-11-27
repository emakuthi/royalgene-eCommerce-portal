#!/usr/bin/env bash
# Serves RoyalTrack workspaces' custom domains from the VPS nginx. Runs as root
# every few minutes (royaltrack-custom-domains.timer). For each domain saved on
# a workspace (Organization.customDomain):
#   - once the domain reaches this server, it issues a Let's Encrypt
#     certificate (webroot), adds an nginx site that proxies to the portal,
#     and marks the domain 'verified' (the portal routes only verified domains);
#   - a domain already served by a hand-written nginx site is just marked verified.
# Sites and certificates of domains no workspace uses any more are removed.
# The portal shows customers their DNS records and checks them (src/lib/domains.server.ts).
#
# Install (as root on the VPS):
#   install -m 755 custom-domains.sh /usr/local/bin/royaltrack-custom-domains
#   install -m 644 royaltrack-custom-domains.service royaltrack-custom-domains.timer /etc/systemd/system/
#   royaltrack-custom-domains --setup && systemctl daemon-reload && systemctl enable --now royaltrack-custom-domains.timer
set -euo pipefail

PORTAL_UPSTREAM=${PORTAL_UPSTREAM:-http://127.0.0.1:3102}
DB_CONTAINER=${DB_CONTAINER:-supabase-db}
WEBROOT=/var/www/royaltrack-acme
SITES=/etc/nginx/royaltrack-custom-domains
MAIN_SITE=/etc/nginx/sites-enabled/royaltrack-custom-domains
STATE=/var/lib/royaltrack-custom-domains
LOG=/var/log/royaltrack-custom-domains.log
CHECK_FILE=royaltrack-domain-check
CHECK_BODY=royaltrack-ok
RETRY_AFTER=3600 # seconds to wait after a failed certificate request (Let's Encrypt rate-limits failures)

log() { echo "$(date -u +%FT%TZ) $*" >>"$LOG"; }
sql() { docker exec -i "$DB_CONTAINER" psql -U postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }

setup() {
  mkdir -p "$WEBROOT/.well-known/acme-challenge" "$SITES" "$STATE"
  printf '%s' "$CHECK_BODY" >"$WEBROOT/.well-known/acme-challenge/$CHECK_FILE"
  if [ ! -f "$MAIN_SITE" ]; then
    cat >"$MAIN_SITE" <<EOF
# RoyalTrack custom domains (managed by /usr/local/bin/royaltrack-custom-domains).
# Port 80 for any host no other site claims: certificate challenges and the
# portal's domain check, everything else is sent to HTTPS.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}
include $SITES/*.conf;
EOF
    nginx -t && systemctl reload nginx
  fi
}

write_site() {
  local d=$1
  cat >"$SITES/$d.conf" <<EOF
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $d;
    ssl_certificate     /etc/letsencrypt/live/rt-$d/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rt-$d/privkey.pem;
    client_max_body_size 100m;
    location / {
        proxy_pass $PORTAL_UPSTREAM;
        proxy_http_version 1.1;
        proxy_read_timeout 120s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
    }
}
EOF
}

mark_verified() {
  sql "UPDATE \"Organization\" SET \"customDomainStatus\" = 'verified', \"updatedAt\" = now()
       WHERE \"customDomain\" = '$1' AND \"customDomainStatus\" IS DISTINCT FROM 'verified'" >/dev/null
}

# A site someone wrote by hand (not one of ours) already serves this domain.
served_by_hand() {
  grep -rqsE "server_name[^;]*[[:space:]]$(printf '%s' "$1" | sed 's/\./\\./g')([[:space:]]|;)" /etc/nginx/sites-enabled/ --exclude="$(basename "$MAIN_SITE")"
}

setup
if [ "${1:-}" = "--setup" ]; then exit 0; fi

domains=$(sql 'SELECT "customDomain" FROM "Organization" WHERE "customDomain" IS NOT NULL AND "deletedAt" IS NULL')
reload=0

for d in $domains; do
  # Only plain hostnames reach the shell and the nginx config.
  [[ $d =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { log "skip invalid $d"; continue; }

  if [ -f "$SITES/$d.conf" ] || served_by_hand "$d"; then
    mark_verified "$d"
    continue
  fi
  if [ -f "$STATE/$d.failed" ] && [ $(( $(date +%s) - $(stat -c %Y "$STATE/$d.failed") )) -lt $RETRY_AFTER ]; then
    continue
  fi
  # Ask Let's Encrypt only once the domain reaches this server.
  [ "$(curl -s --max-time 10 "http://$d/.well-known/acme-challenge/$CHECK_FILE" || true)" = "$CHECK_BODY" ] || continue

  if certbot certonly --webroot -w "$WEBROOT" -d "$d" --cert-name "rt-$d" --non-interactive --agree-tos \
       --keep-until-expiring --deploy-hook 'systemctl reload nginx' >>"$LOG" 2>&1; then
    write_site "$d"
    if nginx -t >>"$LOG" 2>&1; then
      reload=1
      mark_verified "$d"
      rm -f "$STATE/$d.failed"
      log "live $d"
    else
      rm -f "$SITES/$d.conf"
      log "nginx rejected the site for $d"
    fi
  else
    touch "$STATE/$d.failed"
    log "certificate failed for $d (retry in ${RETRY_AFTER}s)"
  fi
done

# Remove what no workspace uses any more.
for conf in "$SITES"/*.conf; do
  [ -e "$conf" ] || continue
  d=$(basename "$conf" .conf)
  if ! grep -qxF "$d" <<<"$domains"; then
    rm -f "$conf"
    certbot delete --cert-name "rt-$d" --non-interactive >>"$LOG" 2>&1 || true
    reload=1
    log "removed $d"
  fi
done

if [ "$reload" = 1 ]; then
  nginx -t >>"$LOG" 2>&1 && systemctl reload nginx
fi
