#!/usr/bin/env bash
# Tests for deploy/stixctl with stand-in docker, curl and ss, so they run in CI
# without Docker. Run: bash tests/stixctl/run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CTL="$ROOT/deploy/stixctl"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0
fail=0
check() { # check <name> <expected exit> <grep pattern> -- command...
  local name="$1" want="$2" pattern="$3"; shift 4
  local out rc=0
  out="$("$@" 2>&1)" || rc=$?
  if [[ "$rc" == "$want" ]] && grep -qE -- "$pattern" <<<"$out"; then
    pass=$((pass + 1)); echo "ok   $name"
  else
    fail=$((fail + 1)); echo "FAIL $name (exit $rc, wanted $want; output must match: $pattern)"; sed 's/^/     /' <<<"$out"
  fi
}

# ---- a home lab with one tool, "cricut" --------------------------------------
export STIX_HOME="$T/stix" STACK_CONF="$T/stack.conf" SERVICES_FILE="$T/services.yaml"
export STIX_GRACE=1 STIX_POLL=1 STUB="$T/stub"
mkdir -p "$STIX_HOME/env" "$STIX_HOME/src" "$STUB/bin"
echo "HOME_LAB_HOST=lab.local" > "$STIX_HOME/env/hub.env"
echo "cricut base yes https://github.com/a/cricut docker-compose.yml" > "$STACK_CONF"
cat > "$SERVICES_FILE" <<'EOF'
- id: cricut
  name: Cricut
  tier: base
  url: http://${HOME_LAB_HOST:-localhost}:8300
  health: http://${HEALTH_HOST:-localhost}:8300/health
  expect: '"ok":true'
EOF

# The tool's code: an upstream repo and the clone stixctl manages.
git init -q -b main "$T/upstream"
git -C "$T/upstream" -c user.name=t -c user.email=t@t commit -q --allow-empty -m v1
echo good > "$T/upstream/VERSION"; git -C "$T/upstream" add VERSION
git -C "$T/upstream" -c user.name=t -c user.email=t@t commit -q -m good
git clone -q "$T/upstream" "$STIX_HOME/src/cricut"
GOOD="$(git -C "$STIX_HOME/src/cricut" rev-parse HEAD)"

# Stand-ins. curl answers health from the clone's VERSION file ("bad" = broken build)
# and headers from $STUB/headers.
cat > "$STUB/bin/docker" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  compose) echo "compose $*" >> "$STUB/log" ;;
  ps) echo "stix-cricut-web-1" ;;
  inspect)
    case "$3" in
      *RestartCount*) echo 0 ;;
      *SecurityOpt*) echo "[no-new-privileges:true]" ;;
      *) echo "running healthy" ;;
    esac ;;
esac
EOF
cat > "$STUB/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ " $* " == *" -D "* ]]; then cat "$STUB/headers"; exit 0; fi
[[ "$(cat "$STIX_HOME/src/cricut/VERSION")" == good ]] || exit 22
echo '{"ok":true}'
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB/bin/ss"
chmod +x "$STUB/bin/"*
export PATH="$STUB/bin:$PATH"

# ---- verify -----------------------------------------------------------------
# Header lines a tool might send. The control room is plain http on the LAN (stixctl writes
# CONTROL_ROOM_ORIGIN that way), so the origins are built from the scheme stixctl uses.
scheme=http
hdr() { printf 'HTTP/1.1 200 OK\r\n%s\r\n\r\n' "$1" > "$STUB/headers"; }
hdr "Content-Security-Policy: frame-ancestors 'self' $scheme://lab.local:8200"
check "verify passes a healthy, frameable tool" 0 "0 failed" -- "$CTL" verify cricut

hdr "X-Frame-Options: DENY"
check "verify fails a tool that refuses to be framed" 1 "window in the control room will be blank" -- "$CTL" verify cricut

hdr "Content-Security-Policy: frame-ancestors 'self' $scheme://localhost:8200"
check "verify fails a tool framed for the wrong control-room address" 1 "does not include $scheme://lab.local:8200" -- "$CTL" verify cricut

# ---- update -----------------------------------------------------------------
check "update with nothing new does not rebuild" 0 "already up to date" -- "$CTL" update cricut

echo bad > "$T/upstream/VERSION"
git -C "$T/upstream" -c user.name=t -c user.email=t@t commit -q -am bad
check "update rolls back a release that comes up broken" 0 "Rolling back.*|back on ${GOOD:0:7} and healthy" -- "$CTL" update cricut
if [[ "$(git -C "$STIX_HOME/src/cricut" rev-parse HEAD)" == "$GOOD" ]]; then pass=$((pass + 1)); echo "ok   clone is back on the last good commit"
else fail=$((fail + 1)); echo "FAIL clone was not rolled back"; fi

echo good > "$T/upstream/VERSION"
git -C "$T/upstream" -c user.name=t -c user.email=t@t commit -q -am fixed
check "the next update returns to the branch and takes the fix" 0 "is up and healthy" -- "$CTL" update cricut

echo "---- $pass passed, $fail failed"
(( fail == 0 ))
