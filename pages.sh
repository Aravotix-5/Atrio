#!/usr/bin/env bash
# Boots the real server and checks that every page and public endpoint answers.
# Run with: bash tests/pages.sh
set -u
cd "$(dirname "$0")/.."

npm start >/tmp/atrio-pages.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

for _ in $(seq 1 30); do
  curl -sf -m 2 http://localhost:3000/healthz >/dev/null && break
  sleep 0.5
done

fail=0
expect() { # path expected-status
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:3000$1")
  if [ "$code" = "$2" ]; then
    printf '  ok   %-24s %s\n' "$1" "$code"
  else
    printf '  FAIL %-24s got %s, expected %s\n' "$1" "$code" "$2"
    fail=$((fail + 1))
  fi
}

echo "Pages"
for p in / /services /build /account /login /signup /admin /checkout-complete; do expect "$p" 200; done
expect /404.html 200
expect /no-such-page 404

echo
echo "Static assets"
expect /css/atrio.css 200
expect /images/favicon.svg 200
for f in api ui store nav home services build account checkout admin auth; do expect "/js/$f.js" 200; done

echo
echo "Public API"
expect /healthz 200
expect /api/services 200
expect /api/statuses 200
expect /api/settings 200
expect /api/csrf 200
expect /api/admin/overview 401

echo
if [ "$fail" -eq 0 ]; then
  echo "All page checks passed."
else
  echo "$fail check(s) failed."
fi
exit "$fail"
