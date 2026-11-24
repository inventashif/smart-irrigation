# Run the integration server

```bash
cd ~/workspace/smart-irrigation/backend
python3 -m pip install --user --break-system-packages -r requirements.txt
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000
```

Open `http://<server-ip>:8000/` for the dashboard. Schedules set there use
server local time; the backend enforces them even when no browser is open.

The ESP32 firmware `BACKEND_BASE_URL` must point at this server, for example:

```c
#define BACKEND_BASE_URL "http://192.168.1.10:8000"
```

The SQLite database is created at `backend/smart_irrigation.db` on first run.
Set `DB_PATH` to override it.
