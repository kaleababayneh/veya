#!/usr/bin/env bash
# Submit an e-dekont .eml to a zkotc prover API and time the job.
#   scripts/gpu/prove-test.sh http://host:port path/to/e-dekont.eml [recipient_iban] [recipient_name]
# Reads PROVER_TOKEN (and TEST_IBAN / TEST_NAME defaults) from scripts/gpu/.env. Writes the proof bundle to proof-<job>.json.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . scripts/gpu/.env; set +a
URL=${1:?prover url}; EML=${2:?eml path}; IBAN=${3:-${TEST_IBAN:?TEST_IBAN}}; NAME=${4:-${TEST_NAME:?TEST_NAME}}
BUYER=${TEST_BUYER:-$(stellar keys address zkotc-buyer 2>/dev/null || echo GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF)}
OFFER=${TEST_OFFER_ID:-1}
python3 - "$URL" "$EML" "$IBAN" "$NAME" "$PROVER_TOKEN" "$BUYER" "$OFFER" <<'EOF'
import base64, json, sys, time, urllib.request
url, eml, iban, name, tok, buyer, offer = sys.argv[1:8]
body = json.dumps({"eml_base64": base64.b64encode(open(eml, "rb").read()).decode(), "offer_id": int(offer), "buyer": buyer,
                   "recipient_iban": iban, "recipient_name": name, "min_amount_kurus": 1, "since_yyyymmdd": 20000101}).encode()
t0 = time.time()
req = urllib.request.Request(url + "/jobs", data=body, headers={"content-type": "application/json", "x-prover-token": tok})
try:
    job = json.load(urllib.request.urlopen(req, timeout=60))
except urllib.error.HTTPError as e:
    # 400 = the e-mail was checked (DKIM, recipient, amount, reference) and rejected before proving; the API itself works
    print(f"REJECTED {e.code}: {e.read().decode()[:400]}"); sys.exit(3)
jid = job["id"]; print(f"job {jid}: {job.get('status')}")
last = None
while True:
    s = json.load(urllib.request.urlopen(url + "/jobs/" + jid, timeout=60))
    if s["status"] != last:
        print(f"{time.time() - t0:6.1f}s {s['status']}"); last = s["status"]
    if s["status"] in ("done", "failed"):
        break
    time.sleep(2)
if s["status"] != "done":
    print("FAILED:", s.get("error")); sys.exit(1)
out = f"proof-{jid[:8]}.json"
json.dump(s, open(out, "w"), indent=1)
d = s.get("dekont") or {}
print(f"OK in {time.time() - t0:.1f}s — seal {(len(s['proof']) - 2) // 2} B, cycles {s.get('cycles')}, "
      f"amount {d.get('amount_kurus')} kuruş on {d.get('date_yyyymmdd')}, image {s['image_id'][:12]}…, saved {out}")
EOF
