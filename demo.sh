#!/usr/bin/env bash
# Smart Irrigation one-command demo.
# Starts the integration backend, verifies it with the contract test,
# then runs the simulated device. Open http://127.0.0.1:8000/ to control it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"

echo "==> Installing backend dependencies"
python3 -m pip install --user --break-system-packages -q -r requirements.txt

export DB_PATH="$ROOT/backend/demo.db"
export SIM_AUTOSTART=0
rm -f "$DB_PATH"

echo "==> Starting backend on http://127.0.0.1:8000/"
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000 >/tmp/smart-irrigation-demo.log 2>&1 &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT INT TERM

echo "==> Waiting for backend..."
python3 - <<'PY'
import time, urllib.request
for _ in range(100):
    try:
        urllib.request.urlopen("http://127.0.0.1:8000/", timeout=2).read()
        break
    except Exception:
        time.sleep(0.3)
else:
    raise SystemExit("backend did not start; see /tmp/smart-irrigation-demo.log")
print("backend is up")
PY

echo "==> Running contract test against the live backend"
BASE_URL=http://127.0.0.1:8000 DEVICE_CODE=ESP32-DEMO-001 python3 "$ROOT/tests/contract_test.py"

echo ""
echo "==> Starting full hardware simulation (soil + DHT22 + flow + pump + virtual ESP32)"
echo "    Ctrl+C to stop. Try --fault soil-disconnect to drill a sensor failure."
echo "    Control panel: http://127.0.0.1:8000/"
python3 "$ROOT/hardware_sim/run.py" --base-url http://127.0.0.1:8000 --interval 5
