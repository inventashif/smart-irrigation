"""Smart Irrigation integration server (MVP).

Implements the backend side of docs/integration-contract.md so the ESP32
firmware can be tested end to end without the full production stack.

Device contract endpoints:
  POST /api/devices/{device_code}/telemetry
  GET  /api/devices/{device_code}/command
  POST /api/devices/{device_code}/ack
  POST /api/devices/{device_code}/commands
  GET  /api/devices/{device_code}/state

Dashboard support endpoints:
  GET    /api/devices                          list known devices (+ metadata)
  POST   /api/devices                          register / update device metadata
  DELETE /api/devices/{device_code}             remove device registration
  GET    /api/devices/{device_code}/telemetry   paginated telemetry history
  GET    /api/devices/{device_code}/commands/history  paginated command log
  GET    /api/devices/{device_code}/schedules   list schedules
  POST   /api/devices/{device_code}/schedules   create schedule
  PUT    /api/schedules/{id}                    update schedule (enable/disable)
  DELETE /api/schedules/{id}                    delete schedule
  GET    /api/weather                          live website-crawled weather + rain-skip advisor
  POST   /api/weather/config                   update weather location/URL & rain-skip rules
  GET    /api/sim/state                        live ESP32 Hardware Lab simulator state
  POST   /api/sim/control                      update simulator sliders, bench actions, speed
  POST   /api/sim/wire                         connect/disconnect virtual GPIO/power wires
  POST   /api/sim/preset                       apply hardware fault or healthy preset
  GET    /api/meta                              server metadata

UI:
  GET /           dashboard (frontend/templates/index.html)
  GET /simulator  Hardware Lab workbench view (frontend/templates/index.html)
  GET /static/*   assets (frontend/static/)

A lightweight scheduler thread turns enabled schedules into real start/stop
commands at the configured (server) local time.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from sim_manager import SimulatorManager
from weather import WeatherCrawler

APP_VERSION = "1.2.0"
DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "smart_irrigation.db"))
COMMAND_TTL_SECONDS = 120
ALLOWED_COMMANDS = {"start", "stop", "emergency_stop", "clear_safety"}
SCHEDULE_COMMANDS = {"start"}
SCHEDULER_TICK_SECONDS = 15
SCHEDULE_RUN_RETENTION_DAYS = 7

_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = _ROOT / "frontend"
STATIC_DIR = FRONTEND_DIR / "static"
TEMPLATE_INDEX = FRONTEND_DIR / "templates" / "index.html"

app = FastAPI(title="Smart Irrigation Integration Server")
# RLock (reentrant): the scheduler tick calls _issue_command() while already
# holding the lock — a plain Lock would deadlock there.
_db_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


def init_db() -> None:
    with _db_lock:
        c = db()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_code TEXT NOT NULL,
                received_at TEXT NOT NULL,
                recorded_at TEXT,
                payload TEXT NOT NULL
            )
            """
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_telemetry_device ON telemetry (device_code, id DESC)"
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_code TEXT NOT NULL,
                command_id TEXT NOT NULL UNIQUE,
                command TEXT NOT NULL,
                issued_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS acks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_code TEXT NOT NULL,
                command_id TEXT NOT NULL,
                accepted INTEGER NOT NULL,
                pump_state TEXT,
                reason TEXT,
                received_at TEXT NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS devices (
                device_code TEXT PRIMARY KEY,
                name TEXT,
                location TEXT,
                latitude REAL,
                longitude REAL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_code TEXT NOT NULL,
                name TEXT NOT NULL,
                time TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 10,
                days TEXT NOT NULL DEFAULT '[]',
                command TEXT NOT NULL DEFAULT 'start',
                enabled INTEGER NOT NULL DEFAULT 1,
                last_fired_date TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS schedule_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                schedule_id INTEGER NOT NULL,
                device_code TEXT NOT NULL,
                started_at TEXT NOT NULL,
                stop_at TEXT NOT NULL,
                stop_command_id TEXT,
                stopped INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        c.commit()


# ---------------------------------------------------------------------------
# Static assets & dashboard page
# ---------------------------------------------------------------------------

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _render_index() -> str:
    try:
        return TEMPLATE_INDEX.read_text(encoding="utf-8")
    except OSError:
        return """<!doctype html><html><head><meta charset="utf-8">
<title>Smart Irrigation</title></head>
<body style="font-family:system-ui;padding:40px">
<h1>Smart Irrigation server</h1>
<p>Dashboard UI files were not found under frontend/. The device API is running;
see the README for the API contract.</p></body></html>"""


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return _render_index()


@app.get("/simulator", response_class=HTMLResponse)
def simulator_page() -> str:
    return _render_index()


@app.get("/health")
def health_check():
    return {"status": "ok", "version": APP_VERSION}


@app.get("/api/meta")
def meta() -> dict:
    return {
        "version": APP_VERSION,
        "server_time": utcnow_iso(),
        "allowed_commands": sorted(ALLOWED_COMMANDS),
        "command_ttl_seconds": COMMAND_TTL_SECONDS,
        "simulator_enabled": sim_manager is not None,
    }


# ---------------------------------------------------------------------------
# Device contract endpoints (unchanged behaviour — see docs/integration-contract.md)
# ---------------------------------------------------------------------------


@app.post("/api/devices/{device_code}/telemetry")
def ingest_telemetry(device_code: str, body: dict):
    if body.get("device_code", device_code) != device_code:
        raise HTTPException(status_code=400, detail="device_code mismatch")
    received_at = utcnow_iso()
    with _db_lock:
        db().execute(
            "INSERT INTO telemetry (device_code, received_at, recorded_at, payload) VALUES (?, ?, ?, ?)",
            (device_code, received_at, body.get("recorded_at"), json.dumps(body)),
        )
        db().commit()
    return {"ok": True, "received_at": received_at}


def _latest_telemetry_row(c: sqlite3.Connection, device_code: str):
    return c.execute(
        "SELECT received_at, recorded_at, payload FROM telemetry"
        " WHERE device_code = ? ORDER BY id DESC LIMIT 1",
        (device_code,),
    ).fetchone()


@app.get("/api/devices/{device_code}/command")
def get_command(device_code: str):
    now = utcnow_iso()
    with _db_lock:
        row = db().execute(
            """
            SELECT command, command_id, issued_at, expires_at
            FROM commands
            WHERE device_code = ? AND status = 'pending' AND expires_at > ?
            ORDER BY id DESC LIMIT 1
            """,
            (device_code, now),
        ).fetchone()
    if row is None:
        return {"command": "none"}
    return {
        "command": row["command"],
        "command_id": row["command_id"],
        "issued_at": row["issued_at"],
        "expires_at": row["expires_at"],
    }


@app.post("/api/devices/{device_code}/ack")
def ingest_ack(device_code: str, body: dict):
    command_id = body.get("command_id")
    if not command_id:
        raise HTTPException(status_code=400, detail="command_id required")
    received_at = utcnow_iso()
    with _db_lock:
        cmd_row = db().execute(
            "SELECT id FROM commands WHERE device_code = ? AND command_id = ?",
            (device_code, command_id),
        ).fetchone()
        cur = db().execute(
            "UPDATE commands SET status = 'acked' WHERE device_code = ? AND command_id = ? AND status = 'pending'",
            (device_code, command_id),
        )
        if cmd_row is not None:
            db().execute(
                "UPDATE commands SET status = 'superseded'"
                " WHERE device_code = ? AND status = 'pending' AND id < ?",
                (device_code, cmd_row["id"]),
            )
        db().execute(
            "INSERT INTO acks (device_code, command_id, accepted, pump_state, reason, received_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (
                device_code,
                command_id,
                1 if body.get("accepted") else 0,
                body.get("pump_state"),
                body.get("reason"),
                received_at,
            ),
        )
        db().commit()
        cleared = cur.rowcount
    return {"ok": True, "cleared_pending": cleared, "received_at": received_at}


def _issue_command(device_code: str, command: str) -> dict:
    """Insert a pending command row, superseding older pending commands for the device."""
    issued = datetime.now(timezone.utc)
    command_id = "cmd-" + uuid.uuid4().hex[:8]
    payload = {
        "command": command,
        "command_id": command_id,
        "issued_at": issued.isoformat().replace("+00:00", "Z"),
        "expires_at": (issued + timedelta(seconds=COMMAND_TTL_SECONDS)).isoformat().replace("+00:00", "Z"),
    }
    with _db_lock:
        db().execute(
            "UPDATE commands SET status = 'superseded' WHERE device_code = ? AND status = 'pending'",
            (device_code,),
        )
        db().execute(
            "INSERT INTO commands (device_code, command_id, command, issued_at, expires_at, status)"
            " VALUES (?, ?, ?, ?, ?, 'pending')",
            (device_code, command_id, command, payload["issued_at"], payload["expires_at"]),
        )
        db().commit()
    return payload


@app.post("/api/devices/{device_code}/commands")
def create_command(device_code: str, body: dict):
    command = (body.get("command") or "").strip()
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail=f"command must be one of {sorted(ALLOWED_COMMANDS)}")
    return _issue_command(device_code, command)


@app.get("/api/devices/{device_code}/state")
def device_state(device_code: str):
    with _db_lock:
        c = db()
        t = c.execute(
            "SELECT received_at, recorded_at, payload FROM telemetry"
            " WHERE device_code = ? ORDER BY id DESC LIMIT 1",
            (device_code,),
        ).fetchone()
        p = c.execute(
            "SELECT command, command_id, issued_at, expires_at FROM commands"
            " WHERE device_code = ? AND status = 'pending' AND expires_at > ?"
            " ORDER BY id DESC LIMIT 1",
            (device_code, utcnow_iso()),
        ).fetchone()
        hist = c.execute(
            "SELECT command, command_id, issued_at, status FROM commands"
            " WHERE device_code = ? ORDER BY id DESC LIMIT 10",
            (device_code,),
        ).fetchall()
        acks = c.execute(
            "SELECT command_id, accepted, pump_state, reason, received_at FROM acks"
            " WHERE device_code = ? ORDER BY id DESC LIMIT 10",
            (device_code,),
        ).fetchall()

    latest = None
    if t is not None:
        try:
            latest = json.loads(t["payload"])
        except json.JSONDecodeError:
            latest = {"raw": t["payload"]}
        latest["_received_at"] = t["received_at"]
        latest["_recorded_at"] = t["recorded_at"]

    return {
        "device_code": device_code,
        "latest_telemetry": latest,
        "pending_command": dict(p) if p else None,
        "recent_commands": [dict(r) for r in hist],
        "recent_acks": [dict(r) for r in acks],
    }


# ---------------------------------------------------------------------------
# Device registry (dashboard support)
# ---------------------------------------------------------------------------


def _register_or_seen_devices() -> list[dict]:
    """Union of registered devices and devices that ever sent telemetry."""
    c = db()
    registered = {r["device_code"]: dict(r) for r in c.execute("SELECT * FROM devices").fetchall()}
    seen_codes = [
        r["device_code"]
        for r in c.execute(
            "SELECT DISTINCT device_code FROM telemetry"
        ).fetchall()
    ]
    codes = sorted(set(registered) | set(seen_codes))

    items = []
    for code in codes:
        reg = registered.get(code)
        t = _latest_telemetry_row(c, code)
        latest = None
        if t is not None:
            try:
                latest = json.loads(t["payload"])
            except json.JSONDecodeError:
                latest = None
        items.append(
            {
                "device_code": code,
                "registered": reg is not None,
                "name": reg["name"] if reg else None,
                "location": reg["location"] if reg else None,
                "latitude": reg["latitude"] if reg else None,
                "longitude": reg["longitude"] if reg else None,
                "is_active": bool(reg["is_active"]) if reg else True,
                "created_at": reg["created_at"] if reg else None,
                "last_seen": t["received_at"] if t else None,
                "last_telemetry": latest,
                "firmware_version": (latest or {}).get("fw_version") or (latest or {}).get("firmware_version"),
                "ip": (latest or {}).get("ip") or (latest or {}).get("device_ip"),
            }
        )
    return items


@app.get("/api/devices")
def list_devices() -> dict:
    with _db_lock:
        items = _register_or_seen_devices()
    return {"items": items, "total": len(items)}


@app.post("/api/devices")
def upsert_device(body: dict):
    device_code = (body.get("device_code") or "").strip()
    if not device_code:
        raise HTTPException(status_code=400, detail="device_code required")

    def _opt_float(v):
        if v is None or v == "":
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="latitude/longitude must be numbers")

    name = (body.get("name") or "").strip() or None
    location = (body.get("location") or "").strip() or None
    latitude = _opt_float(body.get("latitude"))
    longitude = _opt_float(body.get("longitude"))
    is_active = 1 if body.get("is_active", True) else 0
    now = utcnow_iso()

    with _db_lock:
        db().execute(
            """
            INSERT INTO devices (device_code, name, location, latitude, longitude, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_code) DO UPDATE SET
                name = excluded.name,
                location = excluded.location,
                latitude = excluded.latitude,
                longitude = excluded.longitude,
                is_active = excluded.is_active,
                updated_at = excluded.updated_at
            """,
            (device_code, name, location, latitude, longitude, is_active, now, now),
        )
        db().commit()
    return {"ok": True, "device_code": device_code}


@app.delete("/api/devices/{device_code}")
def delete_device(device_code: str):
    with _db_lock:
        c = db()
        cur = c.execute("DELETE FROM devices WHERE device_code = ?", (device_code,))
        if cur.rowcount:
            c.execute("DELETE FROM schedules WHERE device_code = ?", (device_code,))
            c.execute("DELETE FROM schedule_runs WHERE device_code = ?", (device_code,))
            c.execute(
                "UPDATE commands SET status = 'superseded' WHERE device_code = ? AND status = 'pending'",
                (device_code,),
            )
        c.commit()
        removed = cur.rowcount
    if not removed:
        raise HTTPException(status_code=404, detail="device not registered")
    return {"ok": True, "removed": removed}


# ---------------------------------------------------------------------------
# Telemetry & command history (dashboard support)
# ---------------------------------------------------------------------------


@app.get("/api/devices/{device_code}/telemetry")
def telemetry_history(
    device_code: str,
    since: str | None = None,
    limit: int = 1000,
    offset: int = 0,
    order: str = "asc",
):
    order_norm = order.lower()
    if order_norm not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order must be 'asc' or 'desc'")
    sort_dir = "DESC" if order_norm == "desc" else "ASC"
    limit = max(1, min(int(limit), 5000))
    offset = max(0, int(offset))
    where = "device_code = ?"
    params: list = [device_code]
    if since:
        where += " AND received_at >= ?"
        params.append(since)

    with _db_lock:
        c = db()
        total = c.execute(f"SELECT COUNT(*) AS n FROM telemetry WHERE {where}", params).fetchone()["n"]
        rows = c.execute(
            f"SELECT received_at, recorded_at, payload FROM telemetry WHERE {where}"
            f" ORDER BY id {sort_dir} LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

    items = []
    for r in rows:
        try:
            item = json.loads(r["payload"])
            if not isinstance(item, dict):
                item = {"raw": r["payload"]}
        except json.JSONDecodeError:
            item = {"raw": r["payload"]}
        item["_received_at"] = r["received_at"]
        item["_recorded_at"] = r["recorded_at"]
        items.append(item)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/devices/{device_code}/commands/history")
def command_history(device_code: str, limit: int = 50, offset: int = 0):
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    with _db_lock:
        c = db()
        total = c.execute(
            "SELECT COUNT(*) AS n FROM commands WHERE device_code = ?", (device_code,)
        ).fetchone()["n"]
        rows = c.execute(
            "SELECT id, command, command_id, issued_at, expires_at, status FROM commands"
            " WHERE device_code = ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (device_code, limit, offset),
        ).fetchall()
        items = []
        for r in rows:
            ack = c.execute(
                "SELECT accepted, pump_state, reason, received_at FROM acks"
                " WHERE device_code = ? AND command_id = ? ORDER BY id DESC LIMIT 1",
                (device_code, r["command_id"]),
            ).fetchone()
            items.append(
                {
                    "command": r["command"],
                    "command_id": r["command_id"],
                    "issued_at": r["issued_at"],
                    "expires_at": r["expires_at"],
                    "status": r["status"],
                    "ack": dict(ack) if ack else None,
                }
            )
    return {"items": items, "total": total, "limit": limit, "offset": offset}


# ---------------------------------------------------------------------------
# Schedules + scheduler thread
# ---------------------------------------------------------------------------

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _validate_schedule_payload(body: dict, partial: bool = False) -> dict:
    out: dict = {}
    if "name" in body or not partial:
        name = (body.get("name") or "").strip() or "Irrigation"
        if len(name) > 100:
            raise HTTPException(status_code=400, detail="name too long")
        out["name"] = name
    if "time" in body or not partial:
        t = (body.get("time") or "").strip()
        if not _TIME_RE.match(t):
            raise HTTPException(status_code=400, detail="time must be HH:MM (24h)")
        out["time"] = t
    if "duration_minutes" in body or not partial:
        try:
            dur = int(body.get("duration_minutes", 10))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="duration_minutes must be an integer")
        if not 1 <= dur <= 480:
            raise HTTPException(status_code=400, detail="duration_minutes must be 1..480")
        out["duration_minutes"] = dur
    if "days" in body or not partial:
        days = body.get("days")
        if not isinstance(days, list) or not days:
            raise HTTPException(status_code=400, detail="days must be a non-empty list of weekday ints 0..6")
        try:
            days = sorted({int(d) for d in days})
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="days must be weekday ints 0..6")
        if any(d < 0 or d > 6 for d in days):
            raise HTTPException(status_code=400, detail="days must be weekday ints 0..6")
        out["days"] = json.dumps(days)
    if "command" in body:
        command = (body.get("command") or "start").strip()
        if command not in SCHEDULE_COMMANDS:
            raise HTTPException(status_code=400, detail="scheduled command must be 'start'")
        out["command"] = command
    if "enabled" in body:
        out["enabled"] = 1 if body.get("enabled") else 0
    return out


def _schedule_row_to_dict(r) -> dict:
    days = json.loads(r["days"]) if r["days"] else []
    return {
        "id": r["id"],
        "device_code": r["device_code"],
        "name": r["name"],
        "time": r["time"],
        "duration_minutes": r["duration_minutes"],
        "days": days,
        "command": r["command"],
        "enabled": bool(r["enabled"]),
        "last_fired_date": r["last_fired_date"],
        "created_at": r["created_at"],
    }


@app.get("/api/devices/{device_code}/schedules")
def list_schedules(device_code: str):
    with _db_lock:
        rows = db().execute(
            "SELECT * FROM schedules WHERE device_code = ? ORDER BY time ASC", (device_code,)
        ).fetchall()
    return {"items": [_schedule_row_to_dict(r) for r in rows]}


@app.post("/api/devices/{device_code}/schedules")
def create_schedule(device_code: str, body: dict):
    fields = _validate_schedule_payload(body)
    now = utcnow_iso()
    with _db_lock:
        cur = db().execute(
            """
            INSERT INTO schedules
                (device_code, name, time, duration_minutes, days, command, enabled, created_at)
            VALUES (?, ?, ?, ?, ?, 'start', ?, ?)
            """,
            (
                device_code,
                fields["name"],
                fields["time"],
                fields["duration_minutes"],
                fields["days"],
                1 if body.get("enabled", True) else 0,
                now,
            ),
        )
        db().commit()
        schedule_id = cur.lastrowid
    return {"ok": True, "id": schedule_id}


def _cancel_active_schedule_runs(schedule_id: int) -> int:
    """Stop any currently active irrigation run belonging to a disabled/deleted schedule."""
    with _db_lock:
        c = db()
        active_runs = c.execute(
            "SELECT id, device_code FROM schedule_runs WHERE schedule_id = ? AND stopped = 0",
            (schedule_id,),
        ).fetchall()
        for run in active_runs:
            stop_cmd = _issue_command(run["device_code"], "stop")
            c.execute(
                "UPDATE schedule_runs SET stopped = 1, stop_command_id = ? WHERE id = ?",
                (stop_cmd["command_id"], run["id"]),
            )
            print(
                f"[scheduler] cancelled active run {run['id']} on {run['device_code']}"
                f" (cmd {stop_cmd['command_id']})",
                flush=True,
            )
        if active_runs:
            c.commit()
        return len(active_runs)


@app.put("/api/schedules/{schedule_id}")
def update_schedule(schedule_id: int, body: dict):
    fields = _validate_schedule_payload(body, partial=True)
    if not fields:
        raise HTTPException(status_code=400, detail="nothing to update")
    sets = ", ".join(f"{k} = ?" for k in fields)
    stopped_runs = 0
    with _db_lock:
        cur = db().execute(
            f"UPDATE schedules SET {sets} WHERE id = ?", (*fields.values(), schedule_id)
        )
        db().commit()
        updated = cur.rowcount
        if updated and fields.get("enabled") == 0:
            stopped_runs = _cancel_active_schedule_runs(schedule_id)
    if not updated:
        raise HTTPException(status_code=404, detail="schedule not found")
    return {"ok": True, "stopped_active_runs": stopped_runs}


@app.delete("/api/schedules/{schedule_id}")
def delete_schedule(schedule_id: int):
    with _db_lock:
        existing = db().execute("SELECT id FROM schedules WHERE id = ?", (schedule_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="schedule not found")
        stopped_runs = _cancel_active_schedule_runs(schedule_id)
        cur = db().execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
        db().execute("DELETE FROM schedule_runs WHERE schedule_id = ?", (schedule_id,))
        db().commit()
        removed = cur.rowcount
    return {"ok": True, "removed": removed, "stopped_active_runs": stopped_runs}


def _latest_device_readings(c: sqlite3.Connection, device_code: str) -> tuple[float | None, float | None]:
    row = _latest_telemetry_row(c, device_code)
    if not row:
        return None, None
    try:
        payload = json.loads(row["payload"])
    except json.JSONDecodeError:
        return None, None
    soil = payload.get("soil_moisture_pct")
    rain = payload.get("rain_pct")
    return (
        float(soil) if isinstance(soil, (int, float)) else None,
        float(rain) if isinstance(rain, (int, float)) else None,
    )


def _scheduler_tick() -> None:
    """One scheduler pass: fire due schedules (with smart rain-skip), stop finished runs."""
    now_local = datetime.now()  # schedules use server local time
    today = now_local.strftime("%Y-%m-%d")
    now_hhmm = now_local.strftime("%H:%M")
    now_utc = datetime.now(timezone.utc)

    # Fetch cached/crawled weather outside _db_lock so network I/O never blocks requests.
    weather_snapshot = None
    if weather_crawler.rain_skip_enabled:
        try:
            weather_snapshot = weather_crawler.get_weather(force=False)
        except Exception:
            weather_snapshot = None

    with _db_lock:
        c = db()

        # 1. Fire due schedules (once per day).
        for s in c.execute("SELECT * FROM schedules WHERE enabled = 1").fetchall():
            if s["last_fired_date"] == today:
                continue
            days = json.loads(s["days"]) if s["days"] else []
            # days uses JS getDay() convention: 0=Sunday..6=Saturday.
            # Python weekday() is 0=Monday..6=Sunday, so convert.
            js_weekday = (now_local.weekday() + 1) % 7
            if js_weekday not in days:
                continue
            if s["time"] > now_hhmm:
                continue  # not due yet today

            if weather_crawler.rain_skip_enabled:
                soil_pct, rain_pct = _latest_device_readings(c, s["device_code"])
                decision = weather_crawler.evaluate_rain_skip(
                    weather_snapshot,
                    soil_moisture_pct=soil_pct,
                    local_rain_pct=rain_pct,
                )
                if decision["should_skip"]:
                    c.execute("UPDATE schedules SET last_fired_date = ? WHERE id = ?", (today, s["id"]))
                    c.commit()
                    weather_crawler.record_skip(s["name"], s["device_code"], decision["summary"])
                    print(
                        f"[scheduler] rain-skip '{s['name']}' on {s['device_code']}: {decision['summary']}",
                        flush=True,
                    )
                    continue

            payload = _issue_command(s["device_code"], s["command"] or "start")
            started = datetime.now(timezone.utc)
            stop_at = started + timedelta(minutes=s["duration_minutes"])
            c.execute(
                "INSERT INTO schedule_runs (schedule_id, device_code, started_at, stop_at)"
                " VALUES (?, ?, ?, ?)",
                (
                    s["id"],
                    s["device_code"],
                    started.isoformat().replace("+00:00", "Z"),
                    stop_at.isoformat().replace("+00:00", "Z"),
                ),
            )
            c.execute("UPDATE schedules SET last_fired_date = ? WHERE id = ?", (today, s["id"]))
            c.commit()
            print(
                f"[scheduler] fired '{s['name']}' on {s['device_code']}"
                f" at {s['time']} (cmd {payload['command_id']}), stop due in {s['duration_minutes']}m",
                flush=True,
            )

        # 2. Stop finished runs.
        now_iso = now_utc.isoformat().replace("+00:00", "Z")
        due = c.execute(
            "SELECT id, device_code FROM schedule_runs WHERE stopped = 0 AND stop_at <= ?",
            (now_iso,),
        ).fetchall()
        for run in due:
            payload = _issue_command(run["device_code"], "stop")
            c.execute(
                "UPDATE schedule_runs SET stopped = 1, stop_command_id = ? WHERE id = ?",
                (payload["command_id"], run["id"]),
            )
            c.execute(
                "DELETE FROM schedule_runs WHERE stopped = 1 AND stop_at < ?",
                ((now_utc - timedelta(days=SCHEDULE_RUN_RETENTION_DAYS)).isoformat().replace("+00:00", "Z"),),
            )
            c.commit()
            print(
                f"[scheduler] auto-stop for run {run['id']} on {run['device_code']}"
                f" (cmd {payload['command_id']})",
                flush=True,
            )


# ---------------------------------------------------------------------------
# Weather crawler & integrated ESP32 Hardware Lab simulator
# ---------------------------------------------------------------------------

weather_crawler = WeatherCrawler(default_location=os.environ.get("WEATHER_LOCATION", "Delhi"))


def _inproc_post(path: str, payload: dict) -> dict | None:
    m_tel = re.match(r"^/api/devices/([^/]+)/telemetry$", path)
    if m_tel:
        return ingest_telemetry(m_tel.group(1), payload)
    m_ack = re.match(r"^/api/devices/([^/]+)/ack$", path)
    if m_ack:
        return ingest_ack(m_ack.group(1), payload)
    return None


def _inproc_get(path: str) -> dict | None:
    m_cmd = re.match(r"^/api/devices/([^/]+)/command$", path)
    if m_cmd:
        res = get_command(m_cmd.group(1))
        issued_raw = res.get("issued_at")
        if res.get("command") != "none" and issued_raw:
            try:
                issued_dt = datetime.fromisoformat(issued_raw.replace("Z", "+00:00"))
                if (datetime.now(timezone.utc) - issued_dt).total_seconds() < 0.4:
                    return {"command": "none"}
            except ValueError:
                pass
        return res
    return None


SIM_AUTOSTART = os.environ.get("SIM_AUTOSTART", "1").lower() not in ("0", "false", "no")
sim_manager = SimulatorManager(
    transport_post=_inproc_post,
    transport_get=_inproc_get,
    weather_provider=lambda: weather_crawler.get_weather(force=False),
    device_code=os.environ.get("SIM_DEVICE_CODE", "ESP32-DEMO-001"),
)


@app.get("/api/weather")
def api_get_weather(
    location: str | None = None,
    url: str | None = None,
    refresh: bool = False,
    device_code: str | None = None,
):
    data = weather_crawler.get_weather(location=location, custom_url=url, force=refresh)
    code = device_code or sim_manager.esp.device_code
    with _db_lock:
        soil_pct, rain_pct = _latest_device_readings(db(), code)
    data["advisor"] = weather_crawler.evaluate_rain_skip(
        data, soil_moisture_pct=soil_pct, local_rain_pct=rain_pct
    )
    return data


@app.post("/api/weather/config")
def api_configure_weather(body: dict):
    try:
        data = weather_crawler.configure(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    with _db_lock:
        soil_pct, rain_pct = _latest_device_readings(db(), sim_manager.esp.device_code)
    data["advisor"] = weather_crawler.evaluate_rain_skip(
        data, soil_moisture_pct=soil_pct, local_rain_pct=rain_pct
    )
    return data


@app.get("/api/sim/state")
def api_sim_state():
    state = sim_manager.get_state()
    w = weather_crawler.get_weather(force=False)
    readings = state.get("readings") or {}
    w["advisor"] = weather_crawler.evaluate_rain_skip(
        w,
        soil_moisture_pct=readings.get("soil_moisture_pct"),
        local_rain_pct=readings.get("rain_pct"),
    )
    state["weather"] = w
    return state


@app.post("/api/sim/control")
def api_sim_control(body: dict):
    try:
        state = sim_manager.update_controls(body)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    w = weather_crawler.get_weather(force=False)
    readings = state.get("readings") or {}
    w["advisor"] = weather_crawler.evaluate_rain_skip(
        w,
        soil_moisture_pct=readings.get("soil_moisture_pct"),
        local_rain_pct=readings.get("rain_pct"),
    )
    state["weather"] = w
    return state


@app.post("/api/sim/wire")
def api_sim_wire(body: dict):
    wire_id = (body.get("wire_id") or "").strip()
    if not wire_id or "connected" not in body:
        raise HTTPException(status_code=400, detail="wire_id and connected required")
    try:
        state = sim_manager.set_wire(wire_id, bool(body["connected"]))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    w = weather_crawler.get_weather(force=False)
    readings = state.get("readings") or {}
    w["advisor"] = weather_crawler.evaluate_rain_skip(
        w,
        soil_moisture_pct=readings.get("soil_moisture_pct"),
        local_rain_pct=readings.get("rain_pct"),
    )
    state["weather"] = w
    return state


@app.post("/api/sim/preset")
def api_sim_preset(body: dict):
    preset = (body.get("preset") or "").strip()
    if not preset:
        raise HTTPException(status_code=400, detail="preset required")
    try:
        state = sim_manager.apply_preset(preset)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    w = weather_crawler.get_weather(force=False)
    readings = state.get("readings") or {}
    w["advisor"] = weather_crawler.evaluate_rain_skip(
        w,
        soil_moisture_pct=readings.get("soil_moisture_pct"),
        local_rain_pct=readings.get("rain_pct"),
    )
    state["weather"] = w
    return state


def _scheduler_loop() -> None:
    while True:
        try:
            _scheduler_tick()
        except Exception as exc:  # keep the scheduler alive no matter what
            print(f"[scheduler] tick error: {exc}", flush=True)
        time.sleep(SCHEDULER_TICK_SECONDS)


@app.on_event("startup")
def _startup() -> None:
    init_db()
    with _db_lock:
        now = utcnow_iso()
        db().execute(
            """
            INSERT INTO devices (device_code, name, location, latitude, longitude, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(device_code) DO NOTHING
            """,
            (sim_manager.esp.device_code, "ESP32 Field Bench (Sim)", "Greenhouse Plot A", 28.6139, 77.2090, now, now),
        )
        db().commit()
    if SIM_AUTOSTART:
        sim_manager.start_background()
    threading.Thread(target=_scheduler_loop, daemon=True, name="irrigation-scheduler").start()