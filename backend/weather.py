"""Website-crawled weather service + smart irrigation rain-skip advisor.

Uses stdlib urllib + HTML/text extraction only (zero API keys). Crawls public
wttr.in web pages or any user-supplied public weather URL, caches results for
10 minutes, and falls back gracefully when offline.
"""

from __future__ import annotations

import html
import json
import re
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class _VisibleTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip = 0
        self.title = ""
        self._in_title = False
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        t = tag.lower()
        if t in ("script", "style", "noscript", "svg"):
            self._skip += 1
        elif t == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("script", "style", "noscript", "svg") and self._skip > 0:
            self._skip -= 1
        elif t == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._skip == 0:
            s = data.strip()
            if s:
                self.chunks.append(s)


def _http_get_text(url: str, ua: str = "curl/8.4.0", timeout: float = 7.0) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": ua,
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(250_000)
        charset = resp.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def _parse_float(s: str | None, default: float = 0.0) -> float:
    if not s:
        return default
    m = re.search(r"[-+]?\d+(?:\.\d+)?", str(s))
    return float(m.group(0)) if m else default


class WeatherCrawler:
    """Crawls public weather web pages and evaluates smart rain-skip rules."""

    CACHE_TTL_S = 600.0

    def __init__(self, default_location: str = "Delhi") -> None:
        self._lock = threading.RLock()
        self.location = default_location
        self.custom_url: str = ""
        self.rain_skip_enabled: bool = True
        self.rain_mm_threshold: float = 0.6
        self.rain_chance_threshold: float = 60.0
        self.humidity_threshold: float = 88.0
        self.soil_wet_threshold: float = 68.0
        self._cached: dict | None = None
        self._cached_at: float = 0.0
        self._cached_key: str = ""
        self.skip_log: list[dict] = []

    def configure(self, body: dict) -> dict:
        with self._lock:
            if "location" in body and str(body["location"]).strip():
                self.location = str(body["location"]).strip()[:80]
            if "custom_url" in body:
                self.custom_url = str(body.get("custom_url") or "").strip()[:300]
            if "rain_skip_enabled" in body:
                self.rain_skip_enabled = bool(body["rain_skip_enabled"])
            if "rain_mm_threshold" in body:
                self.rain_mm_threshold = max(0.0, min(50.0, float(body["rain_mm_threshold"])))
            if "rain_chance_threshold" in body:
                self.rain_chance_threshold = max(10.0, min(100.0, float(body["rain_chance_threshold"])))
            if "humidity_threshold" in body:
                self.humidity_threshold = max(30.0, min(100.0, float(body["humidity_threshold"])))
            if "soil_wet_threshold" in body:
                self.soil_wet_threshold = max(20.0, min(100.0, float(body["soil_wet_threshold"])))
        if body.get("refresh"):
            return self.get_weather(force=True)
        return self.get_weather(force=False)

    def _crawl_wttr(self, loc: str) -> dict:
        slug = urllib.parse.quote(loc.strip())
        page_url = f"https://wttr.in/{slug}?0&T"
        compact_url = f"https://wttr.in/{slug}?format=%l|%C|%t|%h|%w|%p|%u"
        j1_url = f"https://wttr.in/{slug}?format=j1"

        # 1. Crawl structured wttr.in page payload + ASCII weather report snippet
        snippet = ""
        try:
            snippet = _http_get_text(page_url, ua="curl/8.4.0", timeout=6.0).strip()
        except Exception:
            snippet = ""

        try:
            raw_j1 = _http_get_text(j1_url, ua="Mozilla/5.0", timeout=7.0)
            data = json.loads(raw_j1)
            cur = (data.get("current_condition") or [{}])[0]
            area = (data.get("nearest_area") or [{}])[0]
            area_name = ((area.get("areaName") or [{}])[0].get("value") or loc).strip()
            country = ((area.get("country") or [{}])[0].get("value") or "").strip()
            weather_day = (data.get("weather") or [{}])[0]
            hourly = weather_day.get("hourly") or []
            rain_chances = [_parse_float(h.get("chanceofrain"), 0.0) for h in hourly]
            max_rain_chance = max(rain_chances) if rain_chances else 0.0

            temp_c = _parse_float(cur.get("temp_C"), 27.0)
            feels_c = _parse_float(cur.get("FeelsLikeC"), temp_c)
            humidity = _parse_float(cur.get("humidity"), 55.0)
            precip_mm = _parse_float(cur.get("precipMM"), 0.0)
            wind_kmh = _parse_float(cur.get("windspeedKmph"), 6.0)
            uv_index = _parse_float(cur.get("uvIndex"), 5.0)
            cloud_pct = _parse_float(cur.get("cloudcover"), 30.0)
            cond = ((cur.get("weatherDesc") or [{}])[0].get("value") or "Clear").strip()

            return {
                "ok": True,
                "online": True,
                "location": f"{area_name}, {country}".strip(", "),
                "query": loc,
                "condition": cond,
                "temperature_c": round(temp_c, 1),
                "feels_like_c": round(feels_c, 1),
                "humidity_pct": round(max(0.0, min(100.0, humidity)), 1),
                "precip_mm": round(max(0.0, precip_mm), 2),
                "rain_chance_pct": round(max(0.0, min(100.0, max_rain_chance)), 0),
                "wind_kmh": round(max(0.0, wind_kmh), 1),
                "uv_index": round(uv_index, 1),
                "cloud_pct": round(max(0.0, min(100.0, cloud_pct)), 0),
                "source_url": f"https://wttr.in/{slug}",
                "crawled_report": snippet[:600] if snippet else f"{area_name}: {cond}, {temp_c}°C, RH {humidity}%, {precip_mm} mm",
                "fetched_at": _utcnow_iso(),
            }
        except Exception:
            pass

        # 2. Fallback to compact wttr.in text scrape
        line = _http_get_text(compact_url, ua="curl/8.4.0", timeout=6.0).strip()
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 6:
            cond = parts[1] or "Partly Cloudy"
            temp_c = _parse_float(parts[2], 27.0)
            hum = _parse_float(parts[3], 55.0)
            wind = _parse_float(parts[4], 6.0)
            precip = _parse_float(parts[5], 0.0)
            uv = _parse_float(parts[6], 4.0) if len(parts) > 6 else 4.0
            rain_word = any(w in cond.lower() for w in ("rain", "shower", "storm", "drizzle", "thunder"))
            chance = 80.0 if (precip > 0.2 or rain_word) else 15.0
            return {
                "ok": True,
                "online": True,
                "location": parts[0] or loc,
                "query": loc,
                "condition": cond,
                "temperature_c": round(temp_c, 1),
                "feels_like_c": round(temp_c, 1),
                "humidity_pct": round(hum, 1),
                "precip_mm": round(precip, 2),
                "rain_chance_pct": chance,
                "wind_kmh": round(wind, 1),
                "uv_index": uv,
                "cloud_pct": 75.0 if rain_word else 35.0,
                "source_url": f"https://wttr.in/{slug}",
                "crawled_report": snippet[:600] or line,
                "fetched_at": _utcnow_iso(),
            }
        raise RuntimeError("wttr.in crawl returned unrecognised page")

    def _crawl_custom_url(self, url: str) -> dict:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("Custom weather URL must start with http:// or https://")
        raw = _http_get_text(url, ua="Mozilla/5.0 (X11; Linux x86_64) Chrome/122.0", timeout=8.0)
        ext = _VisibleTextExtractor()
        ext.feed(raw)
        text = html.unescape(" ".join(ext.chunks))
        title = html.unescape(ext.title.strip()) or parsed.netloc

        t_match = re.search(r"(-?\d{1,2}(?:\.\d)?)\s*°\s*C\b", text, re.IGNORECASE)
        if not t_match:
            f_match = re.search(r"(-?\d{1,3}(?:\.\d)?)\s*°\s*F\b", text, re.IGNORECASE)
            temp_c = round((float(f_match.group(1)) - 32.0) * 5.0 / 9.0, 1) if f_match else 26.5
        else:
            temp_c = float(t_match.group(1))

        h_match = re.search(r"(?:humidity|rh)\D{0,18}(\d{1,3})\s*%", text, re.IGNORECASE)
        hum = float(h_match.group(1)) if h_match else 58.0

        p_match = re.search(r"(\d+(?:\.\d+)?)\s*mm\b", text, re.IGNORECASE)
        precip = float(p_match.group(1)) if p_match else 0.0

        w_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:km/h|kmh|kph)\b", text, re.IGNORECASE)
        wind = float(w_match.group(1)) if w_match else 8.0

        c_match = re.search(
            r"\b(Thunderstorm|Heavy Rain|Light Rain|Rain Showers|Drizzle|Rain|Overcast|Partly Cloudy|Mostly Cloudy|Cloudy|Clear|Sunny|Mist|Haze|Fog)\b",
            text,
            re.IGNORECASE,
        )
        cond = c_match.group(1).title() if c_match else "Scraped Web Weather"
        rain_word = any(w in cond.lower() for w in ("rain", "storm", "drizzle", "shower"))
        chance = 75.0 if (precip > 0.2 or rain_word) else 20.0

        return {
            "ok": True,
            "online": True,
            "location": title[:65],
            "query": url,
            "condition": cond,
            "temperature_c": round(max(-35.0, min(58.0, temp_c)), 1),
            "feels_like_c": round(max(-35.0, min(58.0, temp_c)), 1),
            "humidity_pct": round(max(0.0, min(100.0, hum)), 1),
            "precip_mm": round(max(0.0, precip), 2),
            "rain_chance_pct": chance,
            "wind_kmh": round(max(0.0, wind), 1),
            "uv_index": 5.0,
            "cloud_pct": 75.0 if rain_word else 35.0,
            "source_url": url,
            "crawled_report": text[:420],
            "fetched_at": _utcnow_iso(),
        }

    def _offline_fallback(self, key: str, err: str) -> dict:
        if self._cached is not None:
            stale = dict(self._cached)
            stale["online"] = False
            stale["stale"] = True
            stale["crawl_error"] = err
            return stale
        return {
            "ok": True,
            "online": False,
            "stale": True,
            "location": f"{key} (offline fallback)",
            "query": key,
            "condition": "Partly Cloudy (Offline)",
            "temperature_c": 28.0,
            "feels_like_c": 29.0,
            "humidity_pct": 58.0,
            "precip_mm": 0.0,
            "rain_chance_pct": 15.0,
            "wind_kmh": 7.5,
            "uv_index": 5.0,
            "cloud_pct": 35.0,
            "source_url": f"https://wttr.in/{urllib.parse.quote(self.location)}",
            "crawled_report": f"Offline fallback active ({err})",
            "fetched_at": _utcnow_iso(),
        }

    def get_weather(self, location: str | None = None, custom_url: str | None = None, force: bool = False) -> dict:
        with self._lock:
            loc = (location or self.location or "Delhi").strip()
            url = (custom_url if custom_url is not None else self.custom_url).strip()
            cache_key = f"url:{url}" if url else f"loc:{loc.lower()}"
            now = time.monotonic()
            if not force and self._cached and self._cached_key == cache_key and (now - self._cached_at) < self.CACHE_TTL_S:
                out = dict(self._cached)
                out["advisor"] = self.evaluate_rain_skip(out)
                out["rules"] = self.rules_dict()
                return out

        try:
            fresh = self._crawl_custom_url(url) if url else self._crawl_wttr(loc)
            with self._lock:
                self._cached = fresh
                self._cached_at = time.monotonic()
                self._cached_key = cache_key
        except Exception as exc:
            fresh = self._offline_fallback(url or loc, str(exc))

        out = dict(fresh)
        out["advisor"] = self.evaluate_rain_skip(out)
        out["rules"] = self.rules_dict()
        return out

    def rules_dict(self) -> dict:
        return {
            "location": self.location,
            "custom_url": self.custom_url,
            "rain_skip_enabled": self.rain_skip_enabled,
            "rain_mm_threshold": self.rain_mm_threshold,
            "rain_chance_threshold": self.rain_chance_threshold,
            "humidity_threshold": self.humidity_threshold,
            "soil_wet_threshold": self.soil_wet_threshold,
            "recent_skips": list(self.skip_log[-8:]),
        }

    def evaluate_rain_skip(
        self,
        weather: dict | None = None,
        soil_moisture_pct: float | None = None,
        local_rain_pct: float | None = None,
    ) -> dict:
        w = weather or self._cached or {}
        reasons: list[str] = []

        precip = float(w.get("precip_mm") or 0.0)
        chance = float(w.get("rain_chance_pct") or 0.0)
        hum = float(w.get("humidity_pct") or 0.0)
        cond = str(w.get("condition") or "").lower()

        if precip >= self.rain_mm_threshold:
            reasons.append(f"live precipitation {precip:.1f} mm >= {self.rain_mm_threshold:.1f} mm")
        if chance >= self.rain_chance_threshold:
            reasons.append(f"rain probability {chance:.0f}% >= {self.rain_chance_threshold:.0f}%")
        if any(k in cond for k in ("heavy rain", "thunderstorm", "rain shower", "moderate rain", "light rain", "drizzle")):
            reasons.append(f"active weather '{w.get('condition')}'")
        if hum >= self.humidity_threshold and chance >= 40.0:
            reasons.append(f"high humidity {hum:.0f}% with rain risk")
        if local_rain_pct is not None and local_rain_pct >= 25.0:
            reasons.append(f"ESP32 rain board wet ({local_rain_pct:.0f}%)")
        if soil_moisture_pct is not None and soil_moisture_pct >= self.soil_wet_threshold:
            reasons.append(f"soil already moist ({soil_moisture_pct:.1f}% >= {self.soil_wet_threshold:.0f}%)")

        should_skip = bool(self.rain_skip_enabled and reasons)
        temp_c = float(w.get("temperature_c") or 27.0)
        wind_kmh = float(w.get("wind_kmh") or 6.0)
        et_rate = round(max(0.25, min(3.8, 0.4 + max(0.0, temp_c - 15.0) * 0.065 + (100.0 - hum) * 0.012 + wind_kmh * 0.02)), 2)

        return {
            "should_skip": should_skip,
            "rain_skip_enabled": self.rain_skip_enabled,
            "recommendation": "SKIP_IRRIGATION" if should_skip else ("IRRIGATE_NEEDED" if (soil_moisture_pct is not None and soil_moisture_pct < 35.0) else "NORMAL"),
            "reasons": reasons,
            "summary": "; ".join(reasons) if reasons else "Clear to irrigate — no rain/wetness block active",
            "estimated_drying_pct_per_hr": et_rate,
        }

    def record_skip(self, schedule_name: str, device_code: str, summary: str) -> None:
        with self._lock:
            self.skip_log.append(
                {
                    "ts": _utcnow_iso(),
                    "schedule": schedule_name,
                    "device_code": device_code,
                    "reason": summary,
                }
            )
            if len(self.skip_log) > 25:
                self.skip_log = self.skip_log[-25:]
