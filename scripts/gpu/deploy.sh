#!/usr/bin/env bash
# zkOTC — put the prover on a freshly rented GPU box. Run from your machine, in the repo root.
#
#   scripts/gpu/deploy.sh "ssh -p 11953 root@98.191.113.12 -L 8080:localhost:8080"    # paste Vast's "Direct SSH" line
#
# Flags:
#   --build          compile this working tree on the box (needs nvcc; ~30 min) instead of using prebuilt binaries
#   --publish        (implies --build; a no-op when up to date) store the binaries and ~/gpu-artifacts/icicle on the artifact host
#   --switch         point the testnet escrow (set_config image_id) and web/.env.local at this box
#   --test <eml>     submit an e-dekont through the box's API and time it (needs TEST_IBAN/TEST_NAME in scripts/gpu/.env)
#   --no-proxy       skip re-pointing the HTTPS proxy (PROXY_URL in .env: Caddy on the artifact host, handle_path /gpu/*)
#
# Default run (prebuilt): ~3–4 min — ssh wait, 2.8 GB artifact sync from the artifact host, checksums, server up.
# Settings: scripts/gpu/.env (see .env.example). Box side: scripts/gpu/bootstrap.sh. Guide: docs/GPU.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV=scripts/gpu/.env
[ -f "$ENV" ] || { echo "copy scripts/gpu/.env.example to $ENV and fill it in"; exit 2; }
set -a; . "$ENV"; set +a
: "${ARTIFACT_HOST:?}" "${ARTIFACT_DIR:=gpu-artifacts}" "${PORT:=10100}" "${PROVER_TOKEN:?}" "${CORS_ORIGIN:=http://localhost:3000}"

CONN=${1:?usage: deploy.sh "<ssh connect line>" [--build] [--publish] [--switch] [--test file.eml]}; shift
PORT_SSH=22; TARGET=""
read -ra tok <<< "$CONN"
i=0; while [ $i -lt ${#tok[@]} ]; do
  case "${tok[$i]}" in ssh) ;; -p) i=$((i+1)); PORT_SSH=${tok[$i]} ;; -L|-o|-i) i=$((i+1)) ;; *@*) TARGET=${tok[$i]} ;; esac
  i=$((i+1))
done
[ -n "$TARGET" ] || { echo "no user@host in '$CONN'"; exit 2; }
BUILD=0; PUBLISH=0; SWITCH=0; NOPROXY=0; TEST_EML=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=1 ;; --publish) PUBLISH=1; BUILD=1 ;; --switch) SWITCH=1 ;; --no-proxy) NOPROXY=1 ;;
    --test) TEST_EML=${2:?--test needs a .eml path}; shift ;;
    *) echo "unknown flag $1"; exit 2 ;;
  esac; shift
done

T0=$(date +%s)
step() { echo; echo "== [$(( $(date +%s) - T0 ))s] $*"; }
box() { ssh -p "$PORT_SSH" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o LogLevel=ERROR "$TARGET" "$@"; }
art() { ssh -o LogLevel=ERROR "$ARTIFACT_HOST" "$@"; }

step "waiting for ssh on $TARGET:$PORT_SSH (Vast: image pull + boot; 'Permission denied' right after boot is normal, keys land a few seconds later)"
for n in $(seq 1 120); do   # up to 10 min: image pull + boot
  if box 'echo ok' 2>/dev/null | grep -q ok; then break; fi
  [ "$n" = 120 ] && { echo "ssh never came up — if the instance says 'failed to resolve reference', destroy it and rent another host"; exit 1; }
  sleep 5
done
box 'nvidia-smi --query-gpu=name,driver_version --format=csv,noheader; nproc; free -g | awk "/Mem/{print \$2\" GB RAM\"}"; df -h ~ | awk "NR==2{print \$4\" free\"}"' | tr '\n' ' '; echo

step "authorizing the artifact host's key on the box (appended on its own line — the file ships without a trailing newline)"
AK=$(art 'cat ~/.ssh/id_ed25519.pub')
box "mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && (grep -qF '$AK' ~/.ssh/authorized_keys || printf '\n%s\n' '$AK' >> ~/.ssh/authorized_keys) && sed -i '/^\$/d' ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

ENGINE=${ENGINE:-icicle}
case "$ENGINE" in icicle) DIRS="bin icicle zkey" ;; native) DIRS="bin g16" ;; *) echo "ENGINE must be icicle or native"; exit 2 ;; esac
step "syncing artifacts $ARTIFACT_HOST:~/$ARTIFACT_DIR/{$DIRS} → box (engine $ENGINE; ~4 GB the first time)"
box 'mkdir -p ~/gpu-artifacts ~/zkotc'   # rsync only creates the last path component
for d in $DIRS; do
  art "rsync -aL --info=stats1 -e 'ssh -p $PORT_SSH -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR' ~/$ARTIFACT_DIR/$d/ $TARGET:~/gpu-artifacts/$d/" | grep -E "Total transferred" | sed "s/^/   $d: /" || true
done

if [ "$BUILD" = 1 ]; then
  step "syncing sources (this working tree) → box:~/zkotc"
  rsync -az --delete --exclude target/ --exclude build.log --exclude .git/ --exclude 'testdata/private/' \
    -e "ssh -p $PORT_SSH -o LogLevel=ERROR" zkotc-lib prover "$TARGET:~/zkotc/"
fi

step "bootstrap"
box 'mkdir -p ~/zkotc'
scp -q -P "$PORT_SSH" -o LogLevel=ERROR scripts/gpu/bootstrap.sh "$TARGET:~/zkotc/bootstrap.sh"
box "cat > ~/zkotc/gpu.env" <<EOF
ENGINE=$ENGINE
PORT=$PORT
PROVER_TOKEN=$PROVER_TOKEN
CORS_ORIGIN=$CORS_ORIGIN
DKIM_DNS=${DKIM_DNS:-1}
MAX_JOBS_QUEUED=${MAX_JOBS_QUEUED:-8}
EOF
FLAGS="--reinstall"; [ "$BUILD" = 1 ] && FLAGS="--build"
box "rm -f ~/zkotc/bootstrap.status; nohup bash ~/zkotc/bootstrap.sh $FLAGS > /dev/null 2>&1 &"
last=""
st=""
for _ in $(seq 1 360); do   # up to 60 min (builds)
  sleep 10
  st=$(box 'cat ~/zkotc/bootstrap.status 2>/dev/null' || true)
  line=$(box 'grep -v "^$" ~/zkotc/bootstrap.log 2>/dev/null | tail -1' || true)
  [ "$line" != "$last" ] && { echo "   box: ${line:0:150}"; last=$line; }
  case "$st" in OK|FAIL) break ;; esac
done
if [ "$st" != OK ]; then echo; echo "bootstrap failed — box:~/zkotc/bootstrap.log:"; box 'tail -40 ~/zkotc/bootstrap.log'; exit 1; fi

URL=$(box "grep -o 'PUBLIC_URL=http[^ ]*' ~/zkotc/bootstrap.log | tail -1 | cut -d= -f2")
[ -n "$URL" ] || { echo "no public URL (port $PORT not mapped by the provider) — use: ssh -p $PORT_SSH -L $PORT:localhost:$PORT $TARGET and http://localhost:$PORT"; URL="http://localhost:$PORT"; }
INFO=$(curl -sf --max-time 15 "$URL/info" || true)
IMG=$(printf '%s' "$INFO" | python3 -c 'import json,sys; print(json.load(sys.stdin)["image_id"])' 2>/dev/null || true)
echo; echo "prover: $URL"; echo "info:   $INFO"

if [ "$PUBLISH" = 1 ]; then
  step "publishing binaries to $ARTIFACT_HOST:~/$ARTIFACT_DIR/bin"
  VER="$(git rev-parse --short HEAD)-${IMG:2:8}"
  art "mkdir -p ~/$ARTIFACT_DIR/bin/$VER && rsync -a -e 'ssh -p $PORT_SSH -o LogLevel=ERROR' $TARGET:~/zkotc/prover/target/release/zkotc $TARGET:~/zkotc/prover/target/release/zkotc-server ~/$ARTIFACT_DIR/bin/$VER/ && cd ~/$ARTIFACT_DIR/bin/$VER && sha256sum zkotc zkotc-server > SHA256SUMS && printf 'git=%s\nimage_id=%s\nbuilt=%s\nrisc0=3.0.6 ubuntu=24.04 glibc=2.39\n' '$(git rev-parse --short HEAD)' '$IMG' '$(date -u +%Y-%m-%dT%H:%MZ)' > BUILD.txt && ln -sfn $VER ../latest && ls -la"
  if box 'test -f ~/gpu-artifacts/icicle/SHA256SUMS'; then
    art "rsync -a -e 'ssh -p $PORT_SSH -o LogLevel=ERROR' $TARGET:~/gpu-artifacts/icicle/ ~/$ARTIFACT_DIR/icicle/ && echo '   icicle worker published'"
  fi
fi

step "escrow image id check"
ESC=$(stellar contract invoke --id "$ESCROW_ID" --network testnet --source "$STELLAR_IDENTITY" -- config 2>/dev/null || true)
ESC_IMG=$(printf '%s' "$ESC" | python3 -c 'import json,sys; print("0x"+json.load(sys.stdin)["image_id"])' 2>/dev/null || true)
if [ "$ESC_IMG" = "$IMG" ]; then
  echo "escrow $ESCROW_ID already accepts this box's image id"
else
  echo "escrow image id $ESC_IMG ≠ box $IMG — proofs from this box are rejected until set_config"
  if [ "$SWITCH" = 1 ]; then
    step "escrow set_config --image_id $IMG (other fields unchanged)"
    # every set_config parameter (asked from the CLI, so this follows contract upgrades), current values, new image id
    PARAMS=$(stellar contract invoke --id "$ESCROW_ID" --network testnet --source "$STELLAR_IDENTITY" -- set_config --help 2>/dev/null | grep -oE '^\s+--[a-z_]+' | tr -d ' -' | tr '\n' ' ')
    printf '%s' "$ESC" | python3 -c '
import json, sys
c = json.load(sys.stdin); c["image_id"] = sys.argv[1][2:]
print(" ".join(f"--{k} {c[k]}" for k in sys.argv[2].split()))' "$IMG" "$PARAMS" > /tmp/zkotc-set-config.args
    stellar contract invoke --id "$ESCROW_ID" --network testnet --source "$STELLAR_IDENTITY" -- set_config $(cat /tmp/zkotc-set-config.args)
    echo "escrow now accepts $IMG"
  else
    echo "   run again with --switch, or: stellar contract invoke --id $ESCROW_ID --source $STELLAR_IDENTITY -- set_config … --image_id ${IMG:2}"
  fi
fi
# HTTPS for the web app (Vercel needs it): Caddy on the artifact host proxies PROXY_URL (…/gpu) to the box's public
# port. The box's IP:port change with every rental, so re-point the proxy; PROXY_URL itself never changes.
WEB_URL=$URL
if [ -n "${PROXY_URL:-}" ] && [ "$NOPROXY" = 0 ] && [ "$URL" != "http://localhost:$PORT" ]; then
  step "pointing $PROXY_URL at ${URL#http://} (Caddy on $ARTIFACT_HOST)"
  art "sudo -n sed -i -E '/handle_path \/gpu\/\* \{/,/\}/ s#(reverse_proxy )[^ ]+#\1${URL#http://}#' /etc/caddy/Caddyfile \
       && grep -q '${URL#http://}' /etc/caddy/Caddyfile && sudo -n systemctl reload caddy"
  for _ in 1 2 3 4 5 6; do
    PINFO=$(curl -sf --max-time 20 "$PROXY_URL/info" || true)
    [ -n "$PINFO" ] && break
    sleep 3
  done
  if [ "$PINFO" = "$INFO" ]; then echo "proxy ok: $PROXY_URL/info answers with the box's image id"; WEB_URL=$PROXY_URL
  else echo "proxy check FAILED: $PROXY_URL/info returned '${PINFO:-nothing}' — Caddy on $ARTIFACT_HOST: sudo journalctl -u caddy -n 20"; exit 1; fi
fi
if { [ "$SWITCH" = 1 ] || [ "$WEB_URL" = "${PROXY_URL:-}" ]; } && [ -f "${WEB_ENV:-web/.env.local}" ]; then
  if ! grep -q "^NEXT_PUBLIC_PROVER_URL=$WEB_URL\$" "${WEB_ENV:-web/.env.local}"; then
    sed -i.bak "s|^NEXT_PUBLIC_PROVER_URL=.*|NEXT_PUBLIC_PROVER_URL=$WEB_URL|" "${WEB_ENV:-web/.env.local}" && rm -f "${WEB_ENV:-web/.env.local}.bak"
    echo "web: NEXT_PUBLIC_PROVER_URL=$WEB_URL written to ${WEB_ENV:-web/.env.local} — restart 'npm run dev'"
  fi
fi

if [ -n "$TEST_EML" ]; then
  step "test proof through $URL"
  scripts/gpu/prove-test.sh "$URL" "$TEST_EML"
fi

echo; echo "done in $(( $(date +%s) - T0 ))s.  prover: $URL   image_id: $IMG"
[ "$WEB_URL" = "$URL" ] && echo "no HTTPS proxy configured (PROXY_URL in scripts/gpu/.env) — the Vercel site cannot call a plain-http prover."
echo "logs on the box: ~/zkotc/server.log, ~/zkotc/bootstrap.log.  Destroy the instance when finished — nothing on it needs saving."
