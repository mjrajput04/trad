#!/usr/bin/env bash
# Deploy NOVA Engine + the /engine page on the VPS. Run as root:
#   bash /var/www/trad/nova-engine/deploy-vps.sh
#
# 1) pulls the repo (keeping the server-only edits to conf.yaml / package.json)
# 2) installs nova-engine as PM2 "nova-engine" on 127.0.0.1:8066 (PAPER on first boot)
# 3) adds `location /engine-api/` to the nassphx nginx site (backup + nginx -t,
#    restored automatically if the test fails)
# 4) rebuilds the web app and restarts PM2 "quant-forge"
set -euo pipefail

REPO=/var/www/trad
DEST=/var/www/nova-engine
NGINX=/etc/nginx/sites-available/nassphx
PORT=8066

echo "== 1/4 pull"
cd "$REPO"
git stash push -- client-protal/root/conf.yaml quant-forge-os/package.json >/dev/null 2>&1 || true
git pull --ff-only
git stash pop >/dev/null 2>&1 || true

echo "== 2/4 engine"
mkdir -p "$DEST"
cp "$REPO/nova-engine/nova-engine.cjs" "$DEST/"
if pm2 describe nova-engine >/dev/null 2>&1; then
  pm2 restart nova-engine
else
  ENGINE_PORT=$PORT pm2 start "$DEST/nova-engine.cjs" --name nova-engine
fi
pm2 save
sleep 2
curl -fsS "http://127.0.0.1:$PORT/health" && echo

echo "== 3/4 nginx"
if grep -q "location /engine-api/" "$NGINX"; then
  echo "engine-api location already present"
else
  BAK="$NGINX.bak.engine.$(date +%s)"
  cp "$NGINX" "$BAK"
  # Insert right before the existing /admin-api/ location (same server block as the app).
  sed -i '0,/location \/admin-api\//s//location \/engine-api\/ {\n        proxy_pass http:\/\/127.0.0.1:'"$PORT"'\/;\n        proxy_set_header Host $host;\n        proxy_read_timeout 60s;\n    }\n\n    location \/admin-api\//' "$NGINX"
  if nginx -t; then
    systemctl reload nginx
    echo "nginx reloaded (backup: $BAK)"
  else
    cp "$BAK" "$NGINX"
    echo "nginx test FAILED — original config restored, engine page will show 'not reachable'"
    exit 1
  fi
fi

echo "== 4/4 web app"
cd "$REPO/quant-forge-os"
npm install --no-audit --no-fund
npm run build
pm2 restart quant-forge

echo "done — open https://nassphx.com/engine (control account only)"
