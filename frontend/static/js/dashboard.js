/**
 * Smart Irrigation Dashboard
 * Front-end application: state, API client, charts, views, settings.
 */
import { SimulatorLab } from './simulator.js';

/* ==========================================================================
 * Constants & helpers
 * ========================================================================== */

const RANGE_SECONDS = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 24 * 3600,
  '30d': 30 * 24 * 3600,
};

const PUMP_STATE_LABEL = {
  on: 'Running',
  off: 'Stopped',
  priming: 'Priming',
  emergency: 'EMERGENCY',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(s) {
  // Entities built via concatenation so they cannot be stripped by tooling.
  const AMP = '&' + 'amp;';
  const LT = '&' + 'lt;';
  const GT = '&' + 'gt;';
  const QUOT = '&' + 'quot;';
  const APOS = '&' + '#039;';
  return String(s ?? '')
    .replaceAll('&', AMP)
    .replaceAll('<', LT)
    .replaceAll('>', GT)
    .replaceAll('"', QUOT)
    .replaceAll("'", APOS);
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function relTime(iso) {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtNum(v, digits = 1) {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

/* ==========================================================================
 * Settings (localStorage)
 * ========================================================================== */

const SETTINGS_KEY = 'irrigation.settings.v1';

const DEFAULT_SETTINGS = {
  pollInterval: 5,
  chartRetention: '6h',
  maxDataPoints: 300,
  autoRefresh: true,
  showNotifications: true,
  defaultDevice: '',
  deviceTimeout: 60,
  autoConnect: true,
  theme: 'dark',
  chartTheme: 'auto',
  density: 'compact',
  animations: true,
  reducedMotion: false,
};

const Settings = {
  data: { ...DEFAULT_SETTINGS },

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) this.data = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      this.data = { ...DEFAULT_SETTINGS };
    }
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    } catch { /* storage unavailable */ }
  },

  set(key, value) {
    this.data[key] = value;
    this.save();
  },

  reset() {
    this.data = { ...DEFAULT_SETTINGS };
    this.save();
  },
};

/* ==========================================================================
 * Toasts
 * ========================================================================== */

const Toast = {
  icons: {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  },

  show(message, type = 'info', title = '', timeout = 4500) {
    if (!Settings.data.showNotifications) return;
    const container = $('#toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <span class="toast-icon">${this.icons[type] || this.icons.info}</span>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
        <div class="toast-message">${escapeHtml(message)}</div>
      </div>
      <button class="toast-close" aria-label="Dismiss">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    const close = () => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 200);
    };
    $('.toast-close', el).addEventListener('click', close);
    container.appendChild(el);
    if (timeout > 0) setTimeout(close, timeout);
  },
};

/* ==========================================================================
 * API client
 * ========================================================================== */

const Api = {
  base: location.origin,
  ok: false,

  async _fetch(path, options = {}) {
    const res = await fetch(this.base + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    this.ok = true;
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && body.detail) detail = body.detail;
      } catch { /* non-json error body */ }
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return res.json();
  },

  async getDevices() {
    return this._fetch('/api/devices');
  },

  async getState(code) {
    return this._fetch(`/api/devices/${encodeURIComponent(code)}/state`);
  },

  async getTelemetry(code, { since, limit = 1000, offset = 0, order } = {}) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (since) q.set('since', since);
    if (order) q.set('order', order);
    return this._fetch(`/api/devices/${encodeURIComponent(code)}/telemetry?${q}`);
  },

  async getCommandHistory(code, { limit = 50, offset = 0 } = {}) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this._fetch(`/api/devices/${encodeURIComponent(code)}/commands/history?${q}`);
  },

  async sendCommand(code, command) {
    return this._fetch(`/api/devices/${encodeURIComponent(code)}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  },

  async upsertDevice(data) {
    return this._fetch('/api/devices', { method: 'POST', body: JSON.stringify(data) });
  },

  async deleteDevice(code) {
    return this._fetch(`/api/devices/${encodeURIComponent(code)}`, { method: 'DELETE' });
  },

  async getSchedules(code) {
    return this._fetch(`/api/devices/${encodeURIComponent(code)}/schedules`);
  },

  async createSchedule(code, data) {
    return this._fetch(`/api/devices/${encodeURIComponent(code)}/schedules`, {
      method: 'POST', body: JSON.stringify(data),
    });
  },

  async updateSchedule(id, data) {
    return this._fetch(`/api/schedules/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(data),
    });
  },

  async deleteSchedule(id) {
    return this._fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getMeta() {
    return this._fetch('/api/meta');
  },

  async getSimState() {
    return this._fetch('/api/sim/state');
  },

  async controlSim(body) {
    return this._fetch('/api/sim/control', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async setSimWire(wire_id, connected) {
    return this._fetch('/api/sim/wire', {
      method: 'POST',
      body: JSON.stringify({ wire_id, connected }),
    });
  },

  async setSimPreset(preset) {
    return this._fetch('/api/sim/preset', {
      method: 'POST',
      body: JSON.stringify({ preset }),
    });
  },

  async getWeather({ location, url, refresh = false, device_code } = {}) {
    const q = new URLSearchParams();
    if (location) q.set('location', location);
    if (url) q.set('url', url);
    if (refresh) q.set('refresh', 'true');
    if (device_code) q.set('device_code', device_code);
    const qs = q.toString();
    return this._fetch(`/api/weather${qs ? `?${qs}` : ''}`);
  },

  async configureWeather(body) {
    return this._fetch('/api/weather/config', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};

/* ==========================================================================
 * Chart manager
 * ========================================================================== */

const Charts = {
  instances: {},

  colorVars() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const light = document.documentElement.dataset.theme === 'light';
    return {
      text: v('--chart-text-color', light ? '#475569' : '#9aa7b3'),
      grid: v('--chart-grid-color', light ? '#e2e8f0' : '#2d3540'),
      tooltipBg: v('--chart-tooltip-bg', light ? '#ffffff' : '#1e242b'),
      tooltipBorder: v('--chart-tooltip-border', light ? '#e2e8f0' : '#3d4854'),
      teal: v('--color-accent-primary', '#00d4aa'),
      blue: v('--color-accent-secondary', '#3b82f6'),
      amber: v('--color-warning', '#f59e0b'),
      red: v('--color-danger', '#ef4444'),
      green: v('--color-success', '#00d4aa'),
    };
  },

  themeIsDark() {
    const pref = Settings.data.chartTheme;
    if (pref === 'dark') return true;
    if (pref === 'light') return false;
    return document.documentElement.dataset.theme !== 'light';
  },

  baseScales() {
    const c = this.colorVars();
    return {
      x: {
        type: 'time',
        time: { tooltipFormat: 'MMM d, HH:mm:ss', displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'MMM d' } },
        grid: { color: c.grid },
        ticks: { color: c.text, maxRotation: 0, autoSkipPadding: 24 },
      },
    };
  },

  baseOptions(yTitle) {
    const c = this.colorVars();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: Settings.data.animations && !Settings.data.reducedMotion ? 400 : false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { labels: { color: c.text, usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: c.tooltipBg,
          borderColor: c.tooltipBorder,
          borderWidth: 1,
          titleColor: c.text,
          bodyColor: c.text,
          padding: 10,
          displayColors: true,
        },
      },
      scales: {
        ...this.baseScales(),
        y: {
          grid: { color: c.grid },
          ticks: { color: c.text },
          title: yTitle ? { display: true, text: yTitle, color: c.text } : undefined,
        },
      },
    };
  },

  init() {
    if (typeof Chart === 'undefined') {
      console.error('Chart.js failed to load');
      return;
    }
    const c = this.colorVars();

    const soil = $('#soilChart');
    if (soil) this.instances.soil = new Chart(soil, {
      type: 'line',
      data: { datasets: [{
        label: 'Soil moisture (%)',
        data: [],
        borderColor: c.teal,
        backgroundColor: `${c.teal}33`,
        fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2,
      }] },
      options: this.baseOptions('%'),
    });

    const flow = $('#flowChart');
    if (flow) this.instances.flow = new Chart(flow, {
      type: 'line',
      data: { datasets: [{
        label: 'Flow rate (L/min)',
        data: [],
        borderColor: c.blue,
        backgroundColor: `${c.blue}33`,
        fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2,
      }] },
      options: (() => {
        const o = this.baseOptions('L/min');
        o.scales.y.suggestedMin = 0;  // never show negative flow on an empty axis
        return o;
      })(),
    });

    const env = $('#envChart');
    if (env) this.instances.env = new Chart(env, {
      type: 'line',
      data: { datasets: [
        { label: 'Temperature (°C)', data: [], borderColor: c.red, backgroundColor: `${c.red}22`, fill: false, tension: 0.25, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
        { label: 'Humidity (%)', data: [], borderColor: c.blue, backgroundColor: `${c.blue}22`, fill: false, tension: 0.25, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' },
      ] },
      options: (() => {
        const opts = this.baseOptions();
        opts.scales.y1 = {
          position: 'right', min: 0, max: 100,
          grid: { drawOnChartArea: false },
          ticks: { color: c.text },
          title: { display: true, text: '%', color: c.text },
        };
        opts.scales.y.title = { display: true, text: '°C', color: c.text };
        return opts;
      })(),
    });

    const pump = $('#pumpChart');
    if (pump) this.instances.pump = new Chart(pump, {
      type: 'line',
      data: { datasets: [{
        label: 'Pump state',
        data: [],
        borderColor: c.green,
        backgroundColor: `${c.green}33`,
        stepped: true, fill: true, pointRadius: 0, borderWidth: 2,
      }] },
      options: (() => {
        const opts = this.baseOptions();
        opts.scales.y = {
          min: -0.1, max: 1.1,
          grid: { color: c.grid },
          ticks: {
            color: c.text, stepSize: 1,
            callback: (v) => (v === 1 ? 'ON' : v === 0 ? 'OFF' : ''),
          },
        };
        return opts;
      })(),
    });
  },

  retheme() {
    const c = this.colorVars();
    for (const chart of Object.values(this.instances)) {
      if (!chart) continue;
      const o = chart.options;
      o.plugins.legend.labels.color = c.text;
      o.plugins.tooltip.backgroundColor = c.tooltipBg;
      o.plugins.tooltip.borderColor = c.tooltipBorder;
      o.plugins.tooltip.titleColor = c.text;
      o.plugins.tooltip.bodyColor = c.text;
      if (o.scales) {
        for (const s of Object.values(o.scales)) {
          if (s.grid && s.grid.color) s.grid.color = c.grid;
          if (s.ticks && s.ticks.color) s.ticks.color = c.text;
          if (s.title && s.title.color) s.title.color = c.text;
        }
      }
      chart.update('none');
    }
  },

  setData(name, points) {
    const chart = this.instances[name];
    if (!chart) return;
    const max = clamp(Number(Settings.data.maxDataPoints) || 300, 50, 5000);
    const trimmed = points.length > max ? points.slice(-max) : points;
    chart.data.datasets.forEach((ds, i) => {
      ds.data = trimmed.map((p) => ({ x: p.t, y: p.series[i] })).filter((d) => d.y != null);
    });
    chart.update('none');
  },
};

/* ==========================================================================
 * App state
 * ========================================================================== */

const App = {
  currentDevice: '',
  devices: [],
  lastState: null,
  telemetryCache: { points: [], range: null, device: null },
  telemetryPage: 1,
  telemetryPageSize: 25,
  telemetryTotal: 0,
  view: 'dashboard',
  pollTimer: null,
  pollCount: 0,
  editDevice: null, // device_code being edited, or null when adding
  editingSchedule: null,

  rangeSeconds(name) {
    return RANGE_SECONDS[name] || RANGE_SECONDS['6h'];
  },
};

/* ==========================================================================
 * Theme & appearance
 * ========================================================================== */

function applyTheme() {
  const pref = Settings.data.theme;
  let theme = pref;
  if (pref === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = theme;
  const toggle = $('#themeToggle');
  if (toggle) toggle.setAttribute('aria-pressed', String(theme === 'light'));
  Charts.retheme();
}

function applyDensity() {
  document.documentElement.dataset.density = Settings.data.density;
}

function applyMotionPrefs() {
  document.documentElement.dataset.reducedMotion = String(Settings.data.reducedMotion || !Settings.data.animations);
}

function applySidebarState() {
  const sidebar = $('#sidebar');
  if (!sidebar) return;
  if (window.innerWidth <= 768) sidebar.classList.remove('open');
}

/* ==========================================================================
 * Connection status
 * ========================================================================== */

let connFailures = 0;

function setConnection(status) {
  const indicator = $('#statusIndicator');
  const text = $('#statusText');
  if (!indicator || !text) return;
  indicator.className = 'status-indicator';
  if (status === 'connected') {
    indicator.classList.add('connected');
    text.textContent = 'Connected';
  } else if (status === 'connecting') {
    indicator.classList.add('connecting');
    text.textContent = 'Connecting…';
  } else {
    text.textContent = 'Disconnected';
  }
}

function trackFetch(promise) {
  setConnection('connecting');
  return promise.then(
    (r) => { setConnection('connected'); connFailures = 0; return r; },
    (e) => {
      connFailures += 1;
      if (connFailures >= 2) setConnection('disconnected');
      throw e;
    },
  );
}

/* ==========================================================================
 * Data refresh
 * ========================================================================== */

function deviceOnline(state) {
  if (!state || !state.latest_telemetry) return false;
  const seen = state.latest_telemetry._received_at;
  if (!seen) return false;
  const timeout = clamp(Number(Settings.data.deviceTimeout) || 60, 10, 3600) * 1000;
  return Date.now() - new Date(seen).getTime() < timeout;
}

function telemetryToPoints(items) {
  // items: flattened telemetry records, oldest -> newest assumed; sort defensively
  const pts = items
    .map((r) => {
      const t = r.recorded_at || r._received_at;
      if (!t) return null;
      const ts = new Date(t).getTime();
      if (Number.isNaN(ts)) return null;
      const pump = r.pump_state === 'on' || r.pump_state === 'running' ? 1 : 0;
      return {
        t: ts,
        soil: r.soil_moisture_pct,
        flow: r.flow_rate_lpm,
        temp: r.temperature_c,
        hum: r.humidity_pct,
        pump,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
  return pts;
}

async function refreshDevicesList() {
  const res = await trackFetch(Api.getDevices());
  App.devices = res.items || [];
  renderDeviceSelect();
  renderDevicesTable();
}

async function refreshCurrentDevice() {
  const code = App.currentDevice;
  if (!code) return;
  const state = await trackFetch(Api.getState(code));
  App.lastState = state;
  renderDashboardCards(state);
  renderPumpBadge(state);
  if (App.view === 'commands') renderCommandHistory();
  if (App.view === 'dashboard') {
    // Append newest point to charts (dedupe by timestamp)
    const latest = state.latest_telemetry;
    if (latest) {
      const t = latest.recorded_at || latest._received_at;
      const ts = t ? new Date(t).getTime() : null;
      const cache = App.telemetryCache;
      if (ts != null && (!cache.points.length || ts > cache.points[cache.points.length - 1].t)) {
        const pt = telemetryToPoints([latest])[0];
        if (pt) {
          cache.points.push(pt);
          updateDashboardCharts();
        }
      }
    }
    // Periodically backfill full history (in case of missed points)
    App.pollCount += 1;
    if (App.pollCount % 12 === 0) await loadDashboardHistory();
  }
}

async function loadDashboardHistory() {
  const code = App.currentDevice;
  if (!code) return;
  const rangeSel = $('#soilChartRange');
  const range = rangeSel ? rangeSel.value : '6h';
  const seconds = App.rangeSeconds(range);
  try {
    const res = await Api.getTelemetry(code, { since: isoSecondsAgo(seconds), limit: 2000 });
    App.telemetryCache.points = telemetryToPoints(res.items || []);
    App.telemetryCache.range = range;
    App.telemetryCache.device = code;
    updateDashboardCharts();
  } catch (e) {
    console.warn('history fetch failed:', e.message);
  }
}

function updateDashboardCharts() {
  const pts = App.telemetryCache.points;
  Charts.setData('soil', pts.map((p) => ({ t: p.t, series: [p.soil] })));
  Charts.setData('flow', pts.map((p) => ({ t: p.t, series: [p.flow] })));
  Charts.setData('env', pts.map((p) => ({ t: p.t, series: [p.temp, p.hum] })));
  Charts.setData('pump', pts.map((p) => ({ t: p.t, series: [p.pump] })));
}

function restartPolling() {
  if (App.pollTimer) clearInterval(App.pollTimer);
  App.pollTimer = null;
  if (!Settings.data.autoRefresh) return;
  const secs = clamp(Number(Settings.data.pollInterval) || 5, 1, 300);
  App.pollTimer = setInterval(() => {
    pollCycle().catch((e) => console.warn('poll error:', e.message));
  }, secs * 1000);
}

async function refreshWeatherCard() {
  try {
    const w = await Api.getWeather({ device_code: App.currentDevice || undefined });
    const locEl = $('#weatherCardLocation');
    if (locEl) locEl.textContent = w.location || 'Crawled forecast';
    const valEl = $('#weatherCardValue');
    if (valEl) valEl.textContent = w.temperature_c != null ? `${fmtNum(w.temperature_c)} °C` : '— °C';
    const condEl = $('#weatherCardCond');
    if (condEl) {
      const hum = w.humidity_pct != null ? ` · ${fmtNum(w.humidity_pct, 0)}% RH` : '';
      const pr = w.precip_mm != null ? ` · ${fmtNum(w.precip_mm, 1)} mm` : '';
      condEl.textContent = `${w.condition || '—'}${hum}${pr}`;
    }
    const pill = $('#weatherCardPill');
    const adv = w.advisor || {};
    if (pill) {
      const rec = adv.recommendation || 'NORMAL';
      pill.textContent = adv.should_skip ? 'RAIN SKIP' : rec === 'IRRIGATE_NEEDED' ? 'DRY SOIL' : 'CLEAR';
      pill.className = `weather-pill ${adv.should_skip ? 'skip' : rec === 'IRRIGATE_NEEDED' ? 'needed' : 'clear'}`;
      pill.title = adv.summary || '';
    }
  } catch { /* non-blocking weather card */ }
}

async function pollCycle() {
  if (App.view === 'dashboard') {
    await refreshCurrentDevice();
    if (App.pollCount % 3 === 0) refreshWeatherCard();
    App.pollCount += 1;
  }
  else if (App.view === 'devices') await refreshDevicesList();
  else if (App.view === 'telemetry') await refreshCurrentDevice();
  else if (App.view === 'commands') await refreshCurrentDevice();
}

async function fullRefresh() {
  const btn = $('#refreshBtn');
  if (btn) btn.classList.add('loading');
  try {
    if (App.view === 'simulator') {
      await SimulatorLab.refresh();
    }
    await Promise.allSettled([refreshDevicesList(), refreshCurrentDevice(), refreshWeatherCard()]);
    if (App.view === 'dashboard') await loadDashboardHistory();
  } catch (e) {
    Toast.show(e.message, 'error', 'Refresh failed');
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

/* ==========================================================================
 * Dashboard rendering
 * ========================================================================== */

function renderDashboardCards(state) {
  const t = state?.latest_telemetry;
  const online = deviceOnline(state);

  // Pump
  const pumpEl = $('#pumpStatus');
  if (pumpEl) {
    const pump = t?.pump_state || 'unknown';
    pumpEl.textContent = PUMP_STATE_LABEL[pump] || String(pump);
    pumpEl.style.color =
      pump === 'on' ? 'var(--color-pump-running)'
      : pump === 'priming' ? 'var(--color-pump-priming)'
      : 'var(--color-text-primary)';
  }
  const pumpMeta = $('#pumpMeta');
  if (pumpMeta) pumpMeta.textContent = `Last update: ${fmtTime(t?._received_at)}`;

  // Soil
  const soilEl = $('#soilValue');
  if (soilEl) soilEl.textContent = t?.soil_moisture_pct != null ? `${fmtNum(t.soil_moisture_pct)} %` : '—';
  const fill = $('#soilProgressFill');
  const bar = $('#soilProgress');
  if (fill && bar) {
    const pct = clamp(Number(t?.soil_moisture_pct) || 0, 0, 100);
    fill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  const adcEl = $('#rawAdc');
  if (adcEl) adcEl.textContent = t?.raw_adc != null ? String(t.raw_adc) : '—';
  // Thresholds are contract-optional; only show when the firmware sends them
  const thrEl = $('#thresholdMeta');
  if (thrEl) {
    const dry = t?.soil_dry_pct;
    const wet = t?.soil_wet_pct;
    if (dry != null || wet != null) {
      thrEl.classList.remove('hidden');
      const dEl = $('#dryThreshold');
      const wEl = $('#wetThreshold');
      if (dEl) dEl.textContent = dry != null ? `${fmtNum(dry)}%` : '—';
      if (wEl) wEl.textContent = wet != null ? `${fmtNum(wet)}%` : '—';
    } else {
      thrEl.classList.add('hidden');
    }
  }

  // Flow
  const flowEl = $('#flowValue');
  if (flowEl) flowEl.textContent = t?.flow_rate_lpm != null ? `${fmtNum(t.flow_rate_lpm, 2)} L/min` : '— L/min';
  const volEl = $('#totalVolume');
  if (volEl) volEl.textContent = t?.cumulative_water_litres != null ? fmtNum(t.cumulative_water_litres, 2) : '—';
  const flowFaultEl = $('#flowFaultBadge');
  if (flowFaultEl) flowFaultEl.classList.toggle('hidden', !t?.flow_fault);

  // Environment
  const tempEl = $('#tempValue');
  if (tempEl) tempEl.textContent = t?.temperature_c != null ? `${fmtNum(t.temperature_c)} °C` : '— °C';
  const humEl = $('#humidityValue');
  if (humEl) humEl.textContent = t?.humidity_pct != null ? `${fmtNum(t.humidity_pct)} %` : '— %';

  // Safety
  const safetyEl = $('#safetyStatus');
  if (safetyEl) {
    const lock = !!t?.safety_lock;
    const fault = !!t?.comms_fault;
    safetyEl.textContent = lock ? 'LOCKED' : fault ? 'FAULT' : 'Normal';
    safetyEl.style.color = lock ? 'var(--color-danger)' : fault ? 'var(--color-warning)' : 'var(--color-success)';
  }
  const estopEl = $('#estopState');
  if (estopEl) estopEl.textContent = t?.safety_lock ? 'ACTIVE' : 'Inactive';

  // Uptime
  const upEl = $('#uptimeValue');
  if (upEl) upEl.textContent = online ? fmtDuration(t?.uptime_ms) : 'offline';
  const seenEl = $('#lastSeen');
  if (seenEl) seenEl.textContent = relTime(t?._received_at);

  // Reservoir Tank, Rain Sensor & LDR Light
  const tankEl = $('#tankValue');
  if (tankEl) tankEl.textContent = t?.tank_level_pct != null ? `${fmtNum(t.tank_level_pct)} %` : '— %';
  const tankLitEl = $('#tankLitresValue');
  if (tankLitEl) tankLitEl.textContent = t?.tank_litres != null ? fmtNum(t.tank_litres, 1) : '—';
  const rainEl = $('#rainBoardValue');
  if (rainEl) rainEl.textContent = t?.rain_pct != null ? `${fmtNum(t.rain_pct, 0)}%` : '—';
  const luxEl = $('#lightLuxValue');
  if (luxEl) luxEl.textContent = t?.light_lux != null ? `${t.light_lux} lx` : '—';
  const tFill = $('#tankProgressFill');
  const tBar = $('#tankProgress');
  if (tFill && tBar) {
    const tPct = clamp(Number(t?.tank_level_pct) || 0, 0, 100);
    tFill.style.width = `${tPct}%`;
    tBar.setAttribute('aria-valuenow', String(Math.round(tPct)));
  }

  // Device selector reflects online state
  renderDeviceSelect();
}

function renderPumpBadge(state) {
  // used by commands view quick action feedback — placeholder for future inline badge
  const t = state?.latest_telemetry;
  const btn = document.querySelector('.cmd-btn[data-command="start"]');
  if (!btn) return;
  btn.disabled = !App.currentDevice;
  const stopBtn = document.querySelector('.cmd-btn[data-command="stop"]');
  if (stopBtn) stopBtn.disabled = !App.currentDevice;
}

/* ==========================================================================
 * Device selector & devices table
 * ========================================================================== */

function renderDeviceSelect() {
  const sel = $('#deviceSelect');
  if (!sel) return;
  const prev = App.currentDevice;
  sel.innerHTML = '';
  if (!App.devices.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No devices yet';
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const d of App.devices) {
    const opt = document.createElement('option');
    opt.value = d.device_code;
    const label = d.name ? `${d.name} (${d.device_code})` : d.device_code;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (prev && App.devices.some((d) => d.device_code === prev)) {
    sel.value = prev;
  } else {
    const def = Settings.data.defaultDevice;
    if (def && App.devices.some((d) => d.device_code === def)) {
      sel.value = def;
      App.currentDevice = def;
    } else {
      sel.value = App.devices[0].device_code;
      App.currentDevice = App.devices[0].device_code;
    }
  }
  // default-device select in settings
  const defSel = $('#defaultDevice');
  if (defSel) {
    defSel.innerHTML = '<option value="">Select a device…</option>'
      + App.devices.map((d) => `<option value="${escapeHtml(d.device_code)}">${escapeHtml(d.name ? `${d.name} (${d.device_code})` : d.device_code)}</option>`).join('');
    defSel.value = Settings.data.defaultDevice || '';
  }
  // telemetry device filter
  const tSel = $('#telemetryDeviceFilter');
  if (tSel) {
    tSel.innerHTML = '<option value="">All Devices</option>'
      + App.devices.map((d) => `<option value="${escapeHtml(d.device_code)}">${escapeHtml(d.device_code)}</option>`).join('');
  }
}

function renderDevicesTable() {
  const body = $('#devicesTableBody');
  if (!body) return;
  if (!App.devices.length) {
    body.innerHTML = `<tr><td colspan="6" class="muted text-center">No devices registered. Devices appear here automatically once they send telemetry, or add one manually.</td></tr>`;
    return;
  }
  const timeout = clamp(Number(Settings.data.deviceTimeout) || 60, 10, 3600) * 1000;
  body.innerHTML = App.devices.map((d) => {
    const seenMs = d.last_seen ? Date.now() - new Date(d.last_seen).getTime() : Infinity;
    const online = seenMs < timeout;
    return `<tr>
      <td>
        <div class="font-semibold">${escapeHtml(d.name || d.device_code)}</div>
        <div class="text-muted" style="font-size:var(--font-size-xs)">${escapeHtml(d.device_code)}</div>
      </td>
      <td><span class="status-badge ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span></td>
      <td title="${escapeHtml(fmtDateTime(d.last_seen))}">${escapeHtml(relTime(d.last_seen))}</td>
      <td class="muted">${escapeHtml(d.firmware_version || '—')}</td>
      <td class="muted font-mono">${escapeHtml(d.ip || '—')}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-secondary" data-action="select" data-code="${escapeHtml(d.device_code)}" title="Open in dashboard">Open</button>
          <button class="btn btn-sm btn-secondary" data-action="edit" data-code="${escapeHtml(d.device_code)}" title="Edit metadata">Edit</button>
          ${d.registered ? `<button class="btn btn-sm btn-danger" data-action="delete" data-code="${escapeHtml(d.device_code)}" title="Remove registration">Remove</button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');

  $$('#devicesTableBody [data-action]').forEach((btn) => {
    btn.addEventListener('click', () => onDeviceAction(btn.dataset.action, btn.dataset.code));
  });
}

async function onDeviceAction(action, code) {
  if (action === 'select') {
    App.currentDevice = code;
    $('#deviceSelect').value = code;
    await enterView('dashboard');
  } else if (action === 'edit') {
    openDeviceModal(code);
  } else if (action === 'delete') {
    if (!confirm(`Remove registration for "${code}"?\nTelemetry history is kept.`)) return;
    try {
      await Api.deleteDevice(code);
      Toast.show(`Removed ${code}`, 'success');
      await refreshDevicesList();
    } catch (e) {
      Toast.show(e.message, 'error', 'Delete failed');
    }
  }
}

/* ==========================================================================
 * Telemetry view
 * ========================================================================== */

async function loadTelemetryPage(page = 1) {
  App.telemetryPage = page;
  const deviceFilter = $('#telemetryDeviceFilter');
  const rangeFilter = $('#telemetryTimeFilter');
  const code = deviceFilter && deviceFilter.value ? deviceFilter.value : App.currentDevice;
  const range = rangeFilter ? rangeFilter.value : '6h';
  if (!code) {
    $('#telemetryTableBody').innerHTML = '<tr><td colspan="10" class="muted text-center">No device selected.</td></tr>';
    return;
  }
  const since = isoSecondsAgo(RANGE_SECONDS[range] || RANGE_SECONDS['6h']);
  const offset = (page - 1) * App.telemetryPageSize;
  try {
    const res = await trackFetch(Api.getTelemetry(code, { since, limit: App.telemetryPageSize, offset, order: 'desc' }));
    App.telemetryTotal = res.total || 0;
    renderTelemetryTable(res.items || [], code);
    renderTelemetryPagination();
  } catch (e) {
    $('#telemetryTableBody').innerHTML = `<tr><td colspan="10" class="muted text-center">Error: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderTelemetryTable(items, code) {
  const body = $('#telemetryTableBody');
  if (!body) return;
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="10" class="muted text-center">No telemetry for ${escapeHtml(code)} in this range.</td></tr>`;
    return;
  }
  body.innerHTML = items.map((r) => {
    const pump = r.pump_state || 'off';
    const badge = pump === 'on' ? 'running' : 'stopped';
    const lock = !!r.safety_lock;
    const extraParts = [
      r.tank_level_pct != null ? `${fmtNum(r.tank_level_pct, 0)}%` : '—',
      r.rain_pct != null ? `${fmtNum(r.rain_pct, 0)}%` : '—',
      r.light_lux != null ? `${r.light_lux}lx` : '—',
    ].join(' / ');
    return `<tr>
      <td class="font-mono" title="${escapeHtml(r._received_at)}">${escapeHtml(fmtDateTime(r.recorded_at || r._received_at))}</td>
      <td class="muted font-mono">${escapeHtml(r.device_code || code)}</td>
      <td>${r.soil_moisture_pct != null ? fmtNum(r.soil_moisture_pct) + ' %' : '—'}</td>
      <td>${r.flow_rate_lpm != null ? fmtNum(r.flow_rate_lpm, 2) : '—'}</td>
      <td>${r.cumulative_water_litres != null ? fmtNum(r.cumulative_water_litres, 2) : '—'}</td>
      <td>${r.temperature_c != null ? fmtNum(r.temperature_c) : '—'}</td>
      <td>${r.humidity_pct != null ? fmtNum(r.humidity_pct) : '—'}</td>
      <td class="font-mono muted">${escapeHtml(extraParts)}</td>
      <td><span class="pump-badge ${badge}">${escapeHtml(PUMP_STATE_LABEL[pump] || pump)}</span></td>
      <td>${lock ? '<span class="status-badge failed">LOCK</span>' : '<span class="status-badge online">OK</span>'}</td>
    </tr>`;
  }).join('');
}

function renderTelemetryPagination() {
  const el = $('#telemetryPagination');
  if (!el) return;
  const pages = Math.max(1, Math.ceil(App.telemetryTotal / App.telemetryPageSize));
  const cur = App.telemetryPage;
  const btns = [];
  const mk = (label, page, disabled = false, active = false) =>
    `<button class="pagination-btn ${active ? 'active' : ''}" data-page="${page}" ${disabled ? 'disabled' : ''}>${label}</button>`;

  btns.push(mk('‹ Prev', cur - 1, cur <= 1));
  const window = 2;
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - cur) <= window) {
      btns.push(mk(String(p), p, false, p === cur));
    } else if (Math.abs(p - cur) === window + 1) {
      btns.push('<span class="pagination-ellipsis">…</span>');
    }
  }
  btns.push(mk('Next ›', cur + 1, cur >= pages));
  el.innerHTML = btns.join('');
  $$('#telemetryPagination .pagination-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const p = Number(b.dataset.page);
      if (p >= 1 && p <= pages) loadTelemetryPage(p);
    });
  });
}

async function exportTelemetryCsv() {
  const deviceFilter = $('#telemetryDeviceFilter');
  const rangeFilter = $('#telemetryTimeFilter');
  const code = deviceFilter && deviceFilter.value ? deviceFilter.value : App.currentDevice;
  if (!code) { Toast.show('Select a device first', 'warning'); return; }
  const range = rangeFilter ? rangeFilter.value : '6h';
  const since = isoSecondsAgo(RANGE_SECONDS[range] || RANGE_SECONDS['6h']);
  try {
    const res = await Api.getTelemetry(code, { since, limit: 5000 });
    const items = res.items || [];
    if (!items.length) { Toast.show('No data to export', 'warning'); return; }
    const cols = ['recorded_at', '_received_at', 'device_code', 'soil_moisture_pct', 'raw_adc',
      'temperature_c', 'humidity_pct', 'rain_pct', 'tank_level_pct', 'tank_litres',
      'light_pct', 'light_lux', 'flow_rate_lpm', 'flow_pulse_count',
      'cumulative_water_litres', 'flow_fault', 'pump_state', 'safety_lock', 'comms_fault', 'uptime_ms'];
    const esc = (v) => (v == null ? '' : `"${String(v).replaceAll('"', '""')}"`);
    const csv = [cols.join(',')]
      .concat(items.map((r) => cols.map((c) => esc(r[c])).join(',')))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `telemetry_${code}_${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    Toast.show(`Exported ${items.length} rows`, 'success');
  } catch (e) {
    Toast.show(e.message, 'error', 'Export failed');
  }
}

/* ==========================================================================
 * Commands view
 * ========================================================================== */

async function sendCommand(command) {
  const code = App.currentDevice;
  if (!code) { Toast.show('No device selected', 'warning'); return; }
  if (command === 'emergency_stop' || command === 'clear_safety') {
    const msg = command === 'emergency_stop'
      ? 'Send EMERGENCY STOP? The pump stops immediately and locks until cleared.'
      : 'Clear the safety lock? This re-enables pump commands.';
    if (!confirm(msg)) return;
  }
  try {
    const res = await trackFetch(Api.sendCommand(code, command));
    Toast.show(`${command} issued (id ${res.command_id})`, 'success');
    await refreshCurrentDevice();
    await renderCommandHistory();
  } catch (e) {
    Toast.show(e.message, 'error', 'Command failed');
  }
}

async function renderCommandHistory() {
  const body = $('#commandHistoryBody');
  if (!body) return;
  const code = App.currentDevice;
  if (!code) {
    body.innerHTML = '<tr><td colspan="6" class="muted text-center">No device selected.</td></tr>';
    return;
  }
  try {
    const res = await Api.getCommandHistory(code, { limit: 25 });
    const items = res.items || [];
    if (!items.length) {
      body.innerHTML = `<tr><td colspan="6" class="muted text-center">No commands sent to ${escapeHtml(code)} yet.</td></tr>`;
      return;
    }
    body.innerHTML = items.map((c) => {
      const status = c.status === 'acked' ? 'acked' : c.status === 'pending' ? 'pending' : c.status;
      const ack = c.ack;
      return `<tr>
        <td class="font-mono" title="${escapeHtml(c.issued_at)}">${escapeHtml(fmtDateTime(c.issued_at))}</td>
        <td class="muted font-mono">${escapeHtml(code)}</td>
        <td><span class="pump-badge ${c.command === 'emergency_stop' ? 'emergency' : c.command === 'start' ? 'running' : 'stopped'}">${escapeHtml(c.command)}</span></td>
        <td><span class="status-badge ${status}">${escapeHtml(status)}</span></td>
        <td>${ack ? (ack.accepted ? '<span class="status-badge acked">accepted</span>' : '<span class="status-badge failed">rejected</span>') : '<span class="muted">—</span>'}</td>
        <td class="muted" title="${escapeHtml(ack?.reason || '')}">${escapeHtml(ack ? `${ack.reason || ''} · pump=${ack.pump_state || '—'}` : '—')}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="muted text-center">Error: ${escapeHtml(e.message)}</td></tr>`;
  }
}

/* Schedules */

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function renderSchedules() {
  const list = $('#scheduleList');
  if (!list) return;
  const code = App.currentDevice;
  if (!code) {
    list.innerHTML = '<p class="muted">Select a device first.</p>';
    return;
  }
  try {
    const res = await Api.getSchedules(code);
    const items = res.items || [];
    if (!items.length) {
      list.innerHTML = '<p class="muted">No schedules configured for this device.</p>';
      return;
    }
    list.innerHTML = items.map((s) => `
      <div class="schedule-item">
        <div class="schedule-info">
          <span class="schedule-name">${escapeHtml(s.name)}</span>
          <div class="schedule-meta">
            <span class="schedule-time">${escapeHtml(s.time)}</span>
            <span>·</span>
            <span>${escapeHtml(String(s.duration_minutes))} min</span>
            <span>·</span>
            <span class="schedule-days">
              ${DAY_LABELS.map((d, i) => `<span class="schedule-day ${(s.days || []).includes(i) ? 'active' : ''}">${d[0]}</span>`).join('')}
            </span>
          </div>
        </div>
        <div class="schedule-actions">
          <button class="btn btn-sm ${s.enabled ? 'btn-success' : 'btn-secondary'}" data-action="toggle" data-id="${s.id}" data-enabled="${s.enabled ? '0' : '1'}">${s.enabled ? 'Enabled' : 'Disabled'}</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}">Delete</button>
        </div>
      </div>`).join('');
    $$('#scheduleList [data-action]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.id;
        try {
          if (b.dataset.action === 'toggle') {
            await Api.updateSchedule(id, { enabled: b.dataset.enabled === '1' });
            Toast.show('Schedule updated', 'success');
          } else if (b.dataset.action === 'delete') {
            if (!confirm('Delete this schedule?')) return;
            await Api.deleteSchedule(id);
            Toast.show('Schedule deleted', 'success');
          }
          await renderSchedules();
        } catch (e) {
          Toast.show(e.message, 'error', 'Schedule update failed');
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="muted">Error: ${escapeHtml(e.message)}</p>`;
  }
}

/* ==========================================================================
 * Modals
 * ========================================================================== */

function openModal(id) {
  const el = $(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = $(id);
  if (el) el.classList.add('hidden');
}

function openDeviceModal(editCode = null) {
  App.editDevice = editCode;
  const title = $('#deviceModalTitle');
  if (title) title.textContent = editCode ? 'Edit Device' : 'Add Device';
  const existing = App.devices.find((d) => d.device_code === editCode);
  $('#deviceCode').value = existing?.device_code || '';
  $('#deviceCode').disabled = !!editCode; // code is the key; don't change on edit
  $('#deviceName').value = existing?.name || '';
  $('#deviceLocation').value = existing?.location || '';
  $('#deviceLat').value = existing?.latitude ?? '';
  $('#deviceLon').value = existing?.longitude ?? '';
  $('#deviceActive').checked = existing ? existing.is_active !== false : true;
  openModal('#deviceModal');
  setTimeout(() => $('#deviceCode').focus(), 50);
}

async function saveDeviceModal(e) {
  e.preventDefault();
  const payload = {
    device_code: $('#deviceCode').value.trim(),
    name: $('#deviceName').value.trim() || null,
    location: $('#deviceLocation').value.trim() || null,
    latitude: $('#deviceLat').value ? Number($('#deviceLat').value) : null,
    longitude: $('#deviceLon').value ? Number($('#deviceLon').value) : null,
    is_active: $('#deviceActive').checked,
  };
  if (!payload.device_code) { Toast.show('Device code is required', 'warning'); return; }
  try {
    await Api.upsertDevice(payload);
    Toast.show(`${payload.device_code} saved`, 'success');
    closeModal('#deviceModal');
    await refreshDevicesList();
  } catch (err) {
    Toast.show(err.message, 'error', 'Save failed');
  }
}

function openScheduleModal() {
  if (!App.currentDevice) { Toast.show('Select a device first', 'warning'); return; }
  $('#scheduleForm').reset();
  $('#scheduleName').value = '';
  $('#scheduleTime').value = '06:00';
  $('#scheduleDuration').value = 10;
  $$('#dayCheckboxes input').forEach((c) => { c.checked = false; });
  openModal('#scheduleModal');
}

async function saveScheduleModal(e) {
  e.preventDefault();
  const days = $$('#dayCheckboxes input:checked').map((c) => Number(c.value));
  if (!days.length) { Toast.show('Pick at least one day', 'warning'); return; }
  const payload = {
    name: $('#scheduleName').value.trim() || 'Irrigation',
    time: $('#scheduleTime').value,
    duration_minutes: clamp(Number($('#scheduleDuration').value) || 10, 1, 480),
    days,
    command: 'start',
    enabled: $('#scheduleEnabled').checked,
  };
  if (!payload.time) { Toast.show('Time is required', 'warning'); return; }
  try {
    await Api.createSchedule(App.currentDevice, payload);
    Toast.show('Schedule created', 'success');
    closeModal('#scheduleModal');
    await renderSchedules();
  } catch (err) {
    Toast.show(err.message, 'error', 'Save failed');
  }
}

/* ==========================================================================
 * Router & views
 * ========================================================================== */

const VIEW_TITLES = {
  dashboard: ['Dashboard', 'Real-time overview'],
  simulator: ['ESP32 Hardware Lab', 'Interactive schematic, pin wiring, sliders & weather crawler'],
  devices: ['Devices', 'Registered irrigation controllers'],
  telemetry: ['Telemetry', 'Sensor history & export'],
  commands: ['Commands', 'Manual control & schedules'],
  settings: ['Settings', 'Dashboard preferences'],
};

async function enterView(view) {
  if (!VIEW_TITLES[view]) view = 'dashboard';
  if (App.view === 'simulator' && view !== 'simulator') {
    SimulatorLab.deactivate();
  }
  App.view = view;

  $$('.view').forEach((v) => v.classList.add('hidden'));
  const target = $(`#view-${view}`);
  if (target) target.classList.remove('hidden');

  $$('.nav-item').forEach((n) => {
    const active = n.dataset.view === view;
    n.classList.toggle('active', active);
    if (active) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });

  const [title, crumb] = VIEW_TITLES[view];
  const titleEl = $('#pageTitle');
  if (titleEl) titleEl.textContent = title;
  const bc = $('#breadcrumb');
  if (bc) bc.innerHTML = `<span>Smart Irrigation</span><span class="breadcrumb-separator">/</span><span class="breadcrumb-current">${escapeHtml(crumb)}</span>`;

  applySidebarState();

  if (view === 'dashboard') {
    await Promise.allSettled([refreshCurrentDevice(), loadDashboardHistory(), refreshWeatherCard()]);
  } else if (view === 'simulator') {
    await SimulatorLab.activate();
  } else if (view === 'devices') {
    await refreshDevicesList();
  } else if (view === 'telemetry') {
    await loadTelemetryPage(1);
  } else if (view === 'commands') {
    await Promise.allSettled([renderCommandHistory(), renderSchedules()]);
    renderPumpBadge(App.lastState);
  } else if (view === 'settings') {
    bindSettingsForm();
    await loadMeta();
  }
}

async function loadMeta() {
  try {
    const meta = await Api.getMeta();
    const v = $('#backendVersion');
    if (v) v.textContent = meta.version || '—';
    const ab = $('#apiBase');
    if (ab) ab.textContent = Api.base;
  } catch { /* non-critical */ }
}

/* ==========================================================================
 * Settings form
 * ========================================================================== */

const SETTINGS_BINDINGS = [
  ['pollInterval', 'pollInterval', 'number', true],
  ['chartRetention', 'chartRetention', 'value', false],
  ['maxDataPoints', 'maxDataPoints', 'number', true],
  ['autoRefresh', 'autoRefresh', 'checked', false],
  ['showNotifications', 'showNotifications', 'checked', false],
  ['defaultDevice', 'defaultDevice', 'value', false],
  ['deviceTimeout', 'deviceTimeout', 'number', true],
  ['autoConnect', 'autoConnect', 'checked', false],
  ['theme', 'themeSelect', 'value', false],
  ['chartTheme', 'chartTheme', 'value', false],
  ['density', 'density', 'value', false],
  ['animations', 'animations', 'checked', false],
  ['reducedMotion', 'reducedMotion', 'checked', false],
];

function bindSettingsForm() {
  for (const [key, id, kind] of SETTINGS_BINDINGS) {
    const el = $(`#${id}`);
    if (!el) continue;
    if (kind === 'checked') el.checked = !!Settings.data[key];
    else el.value = Settings.data[key];
  }
}

function onSettingChange(key, value, kind) {
  Settings.set(key, value);
  switch (key) {
    case 'pollInterval':
    case 'autoRefresh':
      restartPolling();
      break;
    case 'theme':
      applyTheme();
      break;
    case 'chartTheme':
      Charts.retheme();
      break;
    case 'density':
      applyDensity();
      break;
    case 'animations':
    case 'reducedMotion':
      applyMotionPrefs();
      break;
    case 'chartRetention':
      if (App.view === 'dashboard') loadDashboardHistory();
      break;
    case 'maxDataPoints':
      updateDashboardCharts();
      break;
    case 'deviceTimeout':
      renderDevicesTable();
      renderDashboardCards(App.lastState);
      break;
    case 'defaultDevice':
      if (value) { App.currentDevice = value; $('#deviceSelect').value = value; }
      break;
  }
}

function exportSettings() {
  const blob = new Blob([JSON.stringify(Settings.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'irrigation-dashboard-settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
  Toast.show('Settings exported', 'success');
}

function importSettings(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      Settings.data = { ...DEFAULT_SETTINGS, ...data };
      Settings.save();
      applyTheme(); applyDensity(); applyMotionPrefs(); bindSettingsForm(); restartPolling();
      Toast.show('Settings imported', 'success');
    } catch {
      Toast.show('Invalid settings file', 'error');
    }
  };
  reader.readAsText(file);
}

/* ==========================================================================
 * Init & event wiring
 * ========================================================================== */

function wireEvents() {
  // Navigation
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = `#${item.dataset.view}`;
    });
  });

  window.addEventListener('hashchange', () => {
    const view = (location.hash || '#dashboard').slice(1);
    enterView(view).catch((e) => Toast.show(e.message, 'error'));
  });

  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    const toggle = () => {
      const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      Settings.set('theme', cur === 'dark' ? 'light' : 'dark');
      $('#themeSelect').value = Settings.data.theme;
      applyTheme();
    };
    themeToggle.addEventListener('click', toggle);
    themeToggle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }

  // Mobile sidebar toggles (top-bar button + in-sidebar button + overlay)
  const setSidebar = (open) => {
    const sidebar = $('#sidebar');
    const overlay = $('#sidebarOverlay');
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (overlay) overlay.classList.toggle('visible', open);
    const mb = $('#mobileMenuBtn');
    if (mb) mb.setAttribute('aria-expanded', String(open));
    const st = $('#sidebarToggle');
    if (st) st.setAttribute('aria-expanded', String(open));
  };
  const mbBtn = $('#mobileMenuBtn');
  if (mbBtn) mbBtn.addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('open')));
  const sbToggle = $('#sidebarToggle');
  if (sbToggle) sbToggle.addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('open')));
  const sbOverlay = $('#sidebarOverlay');
  if (sbOverlay) sbOverlay.addEventListener('click', () => setSidebar(false));
  // Close sidebar on nav click (mobile)
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => { if (window.innerWidth <= 768) setSidebar(false); });
  });

  // Refresh button
  const refreshBtn = $('#refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', fullRefresh);

  // Device selector
  const deviceSel = $('#deviceSelect');
  if (deviceSel) {
    deviceSel.addEventListener('change', async () => {
      App.currentDevice = deviceSel.value;
      App.telemetryCache.points = [];
      if (App.view === 'dashboard') {
        await refreshCurrentDevice();
        await loadDashboardHistory();
      } else {
        await enterView(App.view);
      }
      if (Settings.data.autoConnect) Settings.set('defaultDevice', App.currentDevice);
    });
  }

  // Chart range selectors
  ['#soilChartRange', '#flowChartRange', '#envChartRange', '#pumpChartRange'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.addEventListener('change', () => {
        // Keep all chart ranges in sync for a coherent dashboard
        $$('#view-dashboard .chart-range-select').forEach((s) => { s.value = el.value; });
        loadDashboardHistory();
      });
    }
  });

  // Command buttons
  $$('.cmd-btn').forEach((btn) => {
    btn.addEventListener('click', () => sendCommand(btn.dataset.command));
  });

  // Telemetry view controls
  const tFilter = $('#telemetryDeviceFilter');
  if (tFilter) tFilter.addEventListener('change', () => loadTelemetryPage(1));
  const tRange = $('#telemetryTimeFilter');
  if (tRange) tRange.addEventListener('change', () => loadTelemetryPage(1));
  const exportBtn = $('#exportTelemetryBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportTelemetryCsv);

  // Devices view
  const addBtn = $('#addDeviceBtn');
  if (addBtn) addBtn.addEventListener('click', () => openDeviceModal(null));
  $('#deviceModalClose').addEventListener('click', () => closeModal('#deviceModal'));
  $('#deviceModalCancel').addEventListener('click', () => closeModal('#deviceModal'));
  $('#deviceForm').addEventListener('submit', saveDeviceModal);
  $('#deviceModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('#deviceModal'); });

  // Schedule modal
  const addSched = $('#addScheduleBtn');
  if (addSched) addSched.addEventListener('click', openScheduleModal);
  $('#scheduleModalClose').addEventListener('click', () => closeModal('#scheduleModal'));
  $('#scheduleModalCancel').addEventListener('click', () => closeModal('#scheduleModal'));
  $('#scheduleForm').addEventListener('submit', saveScheduleModal);
  $('#scheduleModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal('#scheduleModal'); });

  // Settings inputs
  for (const [key, id, kind] of SETTINGS_BINDINGS) {
    const el = $(`#${id}`);
    if (!el) continue;
    const handler = () => {
      const value = kind === 'checked' ? el.checked
        : kind === 'number' ? clamp(Number(el.value) || DEFAULT_SETTINGS[key], 1, 100000)
        : el.value;
      onSettingChange(key, value, kind);
    };
    el.addEventListener(kind === 'checked' ? 'change' : 'change', handler);
  }

  // Settings buttons
  const clearCacheBtn = $('#clearCacheBtn');
  if (clearCacheBtn) clearCacheBtn.addEventListener('click', () => {
    App.telemetryCache = { points: [], range: null, device: null };
    Toast.show('Local cache cleared', 'success');
    loadDashboardHistory();
  });
  const exportSet = $('#exportSettingsBtn');
  if (exportSet) exportSet.addEventListener('click', exportSettings);
  const importBtn = $('#importSettingsBtn');
  const importFile = $('#importSettingsFile');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => { if (importFile.files[0]) importSettings(importFile.files[0]); });
  }

  // Escape closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('#deviceModal');
      closeModal('#scheduleModal');
    }
  });

  // System theme listener
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (Settings.data.theme === 'system') applyTheme();
  });

  // Keyboard shortcut: "r" refreshes, "1-5" switches views (when not typing)
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'r') fullRefresh();
    const idx = Number(e.key);
    const keys = Object.keys(VIEW_TITLES);
    if (idx >= 1 && idx <= keys.length) location.hash = `#${keys[idx - 1]}`;
  });
}

async function init() {
  Settings.load();
  applyTheme();
  applyDensity();
  applyMotionPrefs();
  Charts.init();
  SimulatorLab.init($('#simulatorWorkbenchRoot'), {
    Api,
    Toast,
    onDeviceTelemetryChanged: () => {
      refreshCurrentDevice().catch(() => {});
    },
  });
  wireEvents();

  try {
    await refreshDevicesList();
    // Auto-connect to last/default device
    const def = Settings.data.defaultDevice;
    if (Settings.data.autoConnect && def && App.devices.some((d) => d.device_code === def)) {
      App.currentDevice = def;
    }
    renderDeviceSelect();
  } catch (e) {
    setConnection('disconnected');
    Toast.show(e.message, 'error', 'Backend unreachable');
  }

  let startView = (location.hash || '').slice(1);
  if (!startView) {
    startView = location.pathname === '/simulator' ? 'simulator' : 'dashboard';
  }
  await enterView(startView);
  restartPolling();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((e) => {
    console.error('init failed:', e);
    Toast.show(e.message, 'error', 'Initialization error');
  });
});