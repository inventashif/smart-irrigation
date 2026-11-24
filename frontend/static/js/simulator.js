/* ==========================================================================
 * ESP32 Hardware Lab & Website Weather Workbench Controller
 * Mounted inside #view-simulator by dashboard.js
 * ========================================================================== */

import { buildSchematicSvgMarkup, updateSchematicSvg } from './sim-schematic.js';

const SLIDER_SPECS = [
  {
    key: 'soil_moisture_pct',
    manualKey: 'soil_manual',
    releaseTarget: 'soil',
    label: 'Soil Moisture',
    pin: 'G32 · L6',
    min: 0,
    max: 100,
    step: 0.5,
    unit: '%',
    sub: (r) => `${r.soil_voltage_v != null ? r.soil_voltage_v.toFixed(2) + 'V' : 'OPEN'} · ADC ${r.raw_adc ?? '—'} · Dry ${r.drying_pct_per_hour ?? 0.6}%/hr`,
  },
  {
    key: 'temperature_c',
    manualKey: 'temperature_manual',
    releaseTarget: 'temperature',
    label: 'DHT22 Temp',
    pin: 'G33 · L7',
    min: -5,
    max: 52,
    step: 0.5,
    unit: '°C',
    sub: (r) => `1-Wire + 4.7kΩ: ${r.temperature_c != null ? r.temperature_c + ' °C' : 'BUS FAULT'}`,
  },
  {
    key: 'humidity_pct',
    manualKey: 'humidity_manual',
    releaseTarget: 'humidity',
    label: 'DHT22 Humidity',
    pin: 'G33 · L7',
    min: 5,
    max: 100,
    step: 1,
    unit: '%',
    sub: (r) => `1-Wire + 4.7kΩ: ${r.humidity_pct != null ? r.humidity_pct + ' %RH' : 'BUS FAULT'}`,
  },
  {
    key: 'rain_pct',
    manualKey: 'rain_manual',
    releaseTarget: 'rain',
    label: 'Rain Sensor Wetness',
    pin: 'G34 · L4',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    sub: (r) => `${r.rain_voltage_v != null ? r.rain_voltage_v.toFixed(2) + 'V' : 'OPEN'} · ADC ${r.rain_adc ?? '—'} · ${Number(r.rain_pct || 0) >= 25 ? 'Rain-skip active' : 'Dry board'}`,
  },
  {
    key: 'tank_level_pct',
    manualKey: 'tank_manual',
    releaseTarget: 'tank',
    label: 'Reservoir Level',
    pin: 'G26·L9 / G14·L11',
    min: 0,
    max: 100,
    step: 0.5,
    unit: '%',
    sub: (r) => `${r.tank_echo_us != null ? r.tank_echo_us + 'µs' : 'NO ECHO'} · ${r.tank_litres != null ? r.tank_litres + ' L' : '—'} / ${r.tank_capacity_litres ?? 50} L`,
  },
  {
    key: 'light_pct',
    manualKey: 'light_manual',
    releaseTarget: 'light',
    label: 'Ambient Light (LDR)',
    pin: 'G35 · L5',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    sub: (r) => `${r.light_voltage_v != null ? r.light_voltage_v.toFixed(2) + 'V' : 'OPEN'} · ${r.light_lux != null ? r.light_lux + ' lux' : '—'}`,
  },
];

const PRESETS = [
  { id: 'all_healthy', label: 'Restore All Healthy', cls: 'healthy' },
  { id: 'soil_disconnect', label: 'Open Soil Probe', cls: '' },
  { id: 'dht_fault', label: 'DHT22 CRC Fault', cls: '' },
  { id: 'dry_run_jam', label: 'Jam Flow Rotor', cls: '' },
  { id: 'tank_empty', label: 'Drain Tank (0.5%)', cls: '' },
  { id: 'wifi_drop', label: 'Drop Wi-Fi Link', cls: '' },
];

const SPEEDS = [0.5, 1, 5, 15, 30];

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function fmtUptime(ms) {
  if (ms == null) return '0s';
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor((sec % 3600) / 60);
  const h = Math.floor(sec / 3600);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtSerialTs(ts) {
  if (ts == null) return '--:--:--';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(String(ts));
  if (!Number.isNaN(d.getTime())) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }
  return String(ts);
}

export const SimulatorLab = {
  mounted: false,
  active: false,
  state: null,
  root: null,
  deps: null, // { Api, Toast, onDeviceTelemetryChanged }
  pollTimer: null,
  sliderTimers: {},
  draggingKey: null,
  lastSerialLen: 0,
  schematicZoom: 1,

  init(rootEl, deps) {
    this.root = rootEl;
    this.deps = deps;
    if (!this.root || this.mounted) return;
    this.renderShell();
    this.bindEvents();
    this.mounted = true;
  },

  async activate() {
    if (!this.mounted) return;
    this.active = true;
    await this.refresh();
    this.startPolling();
  },

  deactivate() {
    this.active = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.active && !document.hidden) {
        this.refresh(true);
      }
    }, 1200);
  },

  async refresh(silent = false) {
    try {
      const state = await this.deps.Api.getSimState();
      this.applyState(state);
    } catch (err) {
      if (!silent) {
        this.deps.Toast.show(err.message, 'error', 'Simulator error');
      }
    }
  },

  applySchematicZoom() {
    const stage = this.root?.querySelector('#simSvgContainer');
    const svg = stage?.querySelector('.sim-schematic-svg');
    if (!stage || !svg) return;
    const z = this.schematicZoom || 1;
    svg.style.width = `${Math.round(z * 100)}%`;
    stage.classList.toggle('zoomed', z > 1.001);
    this.root.querySelectorAll('[data-sim-zoom]').forEach((b) => {
      const mode = b.dataset.simZoom;
      b.classList.toggle('active', mode === 'fit' ? z <= 1.001 : false);
    });
    const label = this.root.querySelector('[data-sim-zoom="fit"]');
    if (label) label.textContent = z <= 1.001 ? 'Fit' : `${Math.round(z * 100)}%`;
  },

  renderShell() {
    const presetButtons = PRESETS.map(
      (p) => `<button type="button" class="sim-preset-btn ${p.cls}" data-preset="${p.id}">${esc(p.label)}</button>`
    ).join('');

    const speedButtons = SPEEDS.map(
      (sp) => `<button type="button" class="sim-speed-btn" data-speed="${sp}">${sp}x</button>`
    ).join('');

    const slidersMarkup = SLIDER_SPECS.map(
      (s) => `
      <div class="sim-slider-item" data-slider-wrap="${s.key}">
        <div class="sim-slider-top">
          <div class="sim-slider-label">
            <span>${esc(s.label)}</span>
            <span class="sim-slider-pin">${esc(s.pin)}</span>
          </div>
          <div class="sim-slider-right">
            <button type="button" class="sim-mode-pill" data-release="${s.releaseTarget}" title="Click when locked to release back to physics simulation">AUTO</button>
            <span class="sim-slider-readout" id="simReadout_${s.key}">—</span>
          </div>
        </div>
        <input
          type="range"
          class="sim-range"
          id="simRange_${s.key}"
          data-slider-key="${s.key}"
          min="${s.min}"
          max="${s.max}"
          step="${s.step}"
          value="50"
          aria-label="${esc(s.label)}"
        />
        <div class="sim-slider-sub">
          <span id="simSub_${s.key}">—</span>
          <span>${s.min}${s.unit}–${s.max}${s.unit}</span>
        </div>
      </div>`
    ).join('');

    this.root.innerHTML = `
      <!-- Top Workbench Bar -->
      <div class="sim-toolbar">
        <div class="sim-toolbar-left">
          <div class="sim-chip-badge">
            <span class="sim-pulse-dot" id="simPulseDot"></span>
            <span id="simDeviceBadge">ESP32-DEMO-001</span>
          </div>
          <div class="sim-stat-strip">
            <span class="sim-mini-stat">Uptime: <strong id="simUptimeStat">0s</strong></span>
            <span class="sim-mini-stat">Pump: <strong id="simPumpStat">OFF</strong></span>
            <span class="sim-mini-stat">Dispensed: <strong id="simVolStat">0.000 L</strong></span>
            <span class="sim-mini-stat">Telemetry: <strong id="simTelemRate">4.0s</strong></span>
          </div>
        </div>
        <div class="sim-toolbar-right">
          <div class="sim-speed-group" role="group" aria-label="Physics timewarp speed">
            ${speedButtons}
          </div>
          <button type="button" class="sim-btn-xs" id="simPauseResumeBtn">Pause Clock</button>
          <button type="button" class="sim-btn-xs" id="simRebootBtn" title="Reboot virtual ESP32 (safe boot latch)">Reboot MCU</button>
        </div>
      </div>

      <!-- 3-Column Workbench -->
      <div class="sim-workbench">
        <!-- LEFT SIDEBAR: Dedicated Pinout & Wire Connections -->
        <aside class="sim-panel sim-connections-sidebar" aria-label="Pinout and component wiring">
          <div class="sim-panel-header">
            <div class="sim-panel-title-wrap">
              <div class="sim-panel-title">Pinout &amp; Netlist (30-Pin ESP32)</div>
              <div class="sim-panel-subtitle">Concrete header pins, passives &amp; terminal pads</div>
            </div>
            <span class="sim-count-pill" id="simWireCountPill">17 / 17 OK</span>
          </div>

          <div class="sim-preset-section">
            <div class="sim-section-kicker">
              <span>Fault Injection Drills</span>
              <span>Instant</span>
            </div>
            <div class="sim-preset-grid">${presetButtons}</div>
            <div class="sim-fault-inline">
              <button type="button" class="sim-fault-chip" id="simToggleDhtCrc">DHT22 CRC Err: OFF</button>
              <button type="button" class="sim-fault-chip" id="simToggleFlowJam">Flow Jam: OFF</button>
            </div>
          </div>

          <div class="sim-wire-list" id="simWireList" role="list">
            <!-- Populated dynamically from state.wires -->
          </div>

          <div class="sim-domain-legend">
            <div class="sim-domain-row">
              <span class="sim-domain-dot" style="background:#00d4aa"></span>
              <span><strong>Domain A:</strong> VIN 5V (L15) · 3V3 (R15) · 4.7kΩ · 10k/20k · 1k/2k</span>
            </div>
            <div class="sim-domain-row">
              <span class="sim-domain-dot" style="background:#fb923c"></span>
              <span><strong>Domain B:</strong> Isolated 12V PSU · Relay COM/NO · 1N4007 clamp</span>
            </div>
          </div>
        </aside>

        <!-- CENTER STAGE: Interactive SVG Hardware Bench + Serial Monitor -->
        <div class="sim-center-stage">
          <div class="sim-panel sim-canvas-card">
            <div class="sim-panel-header">
              <div class="sim-panel-title-wrap">
                <div class="sim-panel-title">ESP32-WROOM-32 Interactive Bench</div>
                <div class="sim-panel-subtitle">Animated signal buses, opto-relay state &amp; hydraulic loop</div>
              </div>
              <div class="sim-bench-btn-group">
                <span class="weather-pill clear" id="simBenchRainBadge">Weather Sync ON</span>
                <div class="sim-zoom-group" id="simZoomGroup" role="group" aria-label="Schematic zoom">
                  <button type="button" class="sim-zoom-btn" data-sim-zoom="out" title="Zoom out">&minus;</button>
                  <button type="button" class="sim-zoom-btn active" data-sim-zoom="fit" title="Fit schematic to width">Fit</button>
                  <button type="button" class="sim-zoom-btn" data-sim-zoom="in" title="Zoom in to read pin labels">+</button>
                </div>
              </div>
            </div>

            <div class="sim-safety-banner hidden" id="simSafetyBanner">
              <span id="simSafetyBannerText">Safety watchdog engaged</span>
              <button type="button" class="sim-btn-xs" id="simBannerClearBtn">Clear Lock</button>
            </div>

            <div class="sim-svg-stage" id="simSvgContainer">
              ${buildSchematicSvgMarkup()}
            </div>

            <div class="sim-bench-actions">
              <div class="sim-bench-btn-group">
                <button type="button" class="sim-btn-xs primary" data-bench-action="start">Start Pump</button>
                <button type="button" class="sim-btn-xs warning" data-bench-action="stop">Stop Pump</button>
                <button type="button" class="sim-btn-xs danger" data-bench-action="emergency_stop">E-Stop Latch</button>
                <button type="button" class="sim-btn-xs" data-bench-action="clear_safety">Clear Safety</button>
                <button type="button" class="sim-btn-xs" data-bench-action="refill_tank">Refill 50L Tank</button>
              </div>
              <span class="sim-canvas-hint">Click any colored wire trace on the board to cut/reconnect it</span>
            </div>
          </div>

          <!-- ESP32 UART Serial Console -->
          <div class="sim-panel sim-serial-card">
            <div class="sim-panel-header">
              <div class="sim-panel-title-wrap">
                <div class="sim-panel-title">UART0 Serial Monitor (115200 baud)</div>
                <div class="sim-panel-subtitle">Boot state, GPIO transitions, HTTP telemetry &amp; safety cutoffs</div>
              </div>
              <button type="button" class="sim-btn-xs" id="simForceTelemBtn">Send Telemetry Frame</button>
            </div>
            <div class="sim-serial-output" id="simSerialOutput" aria-live="polite"></div>
          </div>
        </div>

        <!-- RIGHT DECK: Real-Time Sensor Sliders + Website Weather Crawler -->
        <div class="sim-right-deck">
          <!-- Sensor Sliders -->
          <div class="sim-panel">
            <div class="sim-panel-header">
              <div class="sim-panel-title-wrap">
                <div class="sim-panel-title">Real-Time Sensor Sliders</div>
                <div class="sim-panel-subtitle">Drag to override · click LOCKED pill for live physics</div>
              </div>
              <button type="button" class="sim-btn-xs" id="simReleaseAllBtn" title="Return all overridden sensors to physics & weather coupling">All Auto</button>
            </div>
            <div class="sim-sliders-body">
              ${slidersMarkup}
              <div class="sim-pump-tuning">
                <div class="sim-mini-field">
                  <label for="simInputFlowLpm">Pump L/min</label>
                  <input type="number" id="simInputFlowLpm" min="0.4" max="12" step="0.2" value="2.6" />
                </div>
                <div class="sim-mini-field">
                  <label for="simInputPriming">Priming (s)</label>
                  <input type="number" id="simInputPriming" min="0" max="15" step="0.5" value="2.0" />
                </div>
                <div class="sim-mini-field">
                  <label for="simInputMaxRun">Max Run (s)</label>
                  <input type="number" id="simInputMaxRun" min="5" max="7200" step="5" value="900" />
                </div>
              </div>
            </div>
          </div>

          <!-- Website Weather Crawler & Rain-Skip Advisor -->
          <div class="sim-panel">
            <div class="sim-panel-header">
              <div class="sim-panel-title-wrap">
                <div class="sim-panel-title">Web Weather Crawler &amp; Rain-Skip</div>
                <div class="sim-panel-subtitle">No API keys · crawls live weather pages directly</div>
              </div>
              <button type="button" class="sim-btn-xs primary" id="simCrawlNowBtn">Crawl Now</button>
            </div>
            <div class="sim-weather-body">
              <div class="sim-weather-hero">
                <div>
                  <div class="sim-weather-loc" id="simWLoc">Loading weather...</div>
                  <div class="sim-weather-cond" id="simWCond">—</div>
                </div>
                <div class="sim-weather-temp" id="simWTemp">—°C</div>
              </div>

              <div class="sim-weather-metrics">
                <div class="sim-w-metric"><span>Humidity</span><strong id="simWHum">—%</strong></div>
                <div class="sim-w-metric"><span>Precip</span><strong id="simWPrecip">— mm</strong></div>
                <div class="sim-w-metric"><span>Rain Prob</span><strong id="simWChance">—%</strong></div>
                <div class="sim-w-metric"><span>Wind</span><strong id="simWWind">— km/h</strong></div>
                <div class="sim-w-metric"><span>Cloud / UV</span><strong id="simWCloud">—</strong></div>
                <div class="sim-w-metric"><span>Soil Drying</span><strong id="simWDrying">—%/h</strong></div>
              </div>

              <div class="sim-advisor-box" id="simAdvisorBox">
                <div class="sim-advisor-head">
                  <span id="simAdvisorTitle">Irrigation Advisor</span>
                  <span class="weather-pill clear" id="simAdvisorBadge">NORMAL</span>
                </div>
                <div class="sim-advisor-summary" id="simAdvisorSummary">Evaluating local sensors &amp; crawled weather...</div>
              </div>

              <form class="sim-weather-form" id="simWeatherForm">
                <div class="sim-input-row">
                  <input type="text" class="sim-text-input" id="simWeatherLocation" placeholder="City or region (e.g., Delhi, Mumbai, London)" />
                  <button type="submit" class="sim-btn-xs">Apply</button>
                </div>
                <div class="sim-input-row">
                  <input type="url" class="sim-text-input" id="simWeatherUrl" placeholder="Optional custom weather URL (https://...)" />
                </div>
                <label class="sim-toggle-line">
                  <span>Sync crawled weather → ambient sensors</span>
                  <input type="checkbox" id="simWeatherSyncToggle" checked />
                </label>
                <label class="sim-toggle-line">
                  <span>Auto-skip scheduled runs on rain / wet soil</span>
                  <input type="checkbox" id="simRainSkipToggle" checked />
                </label>
              </form>

              <div class="sim-crawl-preview" id="simCrawlPreview">Waiting for crawl report...</div>
              <div class="sim-source-link">
                <span id="simWeatherFreshness">—</span>
                <a href="https://wttr.in" target="_blank" rel="noopener noreferrer" id="simWeatherSourceUrl">wttr.in</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  bindEvents() {
    const q = (sel) => this.root.querySelector(sel);

    // Speed buttons
    this.root.querySelectorAll('.sim-speed-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sendControl({ speed_multiplier: Number(btn.dataset.speed), force_telemetry: false });
      });
    });

    // Pause / Resume
    q('#simPauseResumeBtn')?.addEventListener('click', () => {
      const next = !(this.state?.running ?? true);
      this.sendControl({ running: next, force_telemetry: false });
    });

    // Reboot MCU
    q('#simRebootBtn')?.addEventListener('click', () => {
      this.sendControl({ action: 'reboot' }, 'ESP32 rebooted cleanly (GPIO27 safe HIGH)');
    });

    // Force immediate telemetry
    q('#simForceTelemBtn')?.addEventListener('click', () => {
      this.sendControl({ force_telemetry: true }, 'Telemetry frame posted');
    });

    // Safety banner clear
    q('#simBannerClearBtn')?.addEventListener('click', () => {
      this.sendControl({ action: 'clear_safety' }, 'Safety lock cleared');
    });

    // Bench action buttons
    this.root.querySelectorAll('[data-bench-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.benchAction;
        this.sendControl({ action }, `Bench action: ${action}`);
      });
    });

    // Fault presets
    this.root.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const state = await this.deps.Api.setSimPreset(btn.dataset.preset);
          this.applyState(state);
          this.deps.onDeviceTelemetryChanged?.();
          this.deps.Toast.show(`Applied preset: ${btn.textContent}`, 'info');
        } catch (err) {
          this.deps.Toast.show(err.message, 'error');
        }
      });
    });

    // Schematic zoom (Fit / − / +)
    q('#simZoomGroup')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-sim-zoom]');
      if (!btn) return;
      const mode = btn.dataset.simZoom;
      if (mode === 'fit') {
        this.schematicZoom = 1;
      } else if (mode === 'in') {
        this.schematicZoom = Math.min(3, Math.round((this.schematicZoom + 0.35) * 100) / 100);
      } else {
        this.schematicZoom = Math.max(1, Math.round((this.schematicZoom - 0.35) * 100) / 100);
      }
      this.applySchematicZoom();
    });

    // Inline fault toggles (CRC + Jam)
    q('#simToggleDhtCrc')?.addEventListener('click', () => {
      const cur = !!this.state?.faults?.dht_checksum;
      this.sendControl({ dht_checksum: !cur });
    });
    q('#simToggleFlowJam')?.addEventListener('click', () => {
      const cur = !!this.state?.faults?.flow_jam;
      this.sendControl({ flow_jam: !cur });
    });

    // Wire list delegated click & hover highlight synced with SVG
    const wireList = q('#simWireList');
    wireList?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-wire-row]');
      if (!row) return;
      const wid = row.dataset.wireRow;
      const cur = row.dataset.connected === 'true';
      this.toggleWire(wid, !cur);
    });
    wireList?.addEventListener('mouseover', (e) => {
      const row = e.target.closest('[data-wire-row]');
      this.highlightWire(row ? row.dataset.wireRow : null);
    });
    wireList?.addEventListener('mouseleave', () => this.highlightWire(null));

    // SVG wire click & hover
    const svgStage = q('#simSvgContainer');
    svgStage?.addEventListener('click', (e) => {
      const g = e.target.closest('.svg-wire-group');
      if (!g) return;
      const wid = g.dataset.wireId;
      const w = (this.state?.wires || []).find((item) => item.id === wid);
      if (w) this.toggleWire(wid, !w.connected);
    });
    svgStage?.addEventListener('mouseover', (e) => {
      const g = e.target.closest('.svg-wire-group');
      this.highlightWire(g ? g.dataset.wireId : null);
    });
    svgStage?.addEventListener('mouseleave', () => this.highlightWire(null));

    // Sensor Sliders (live readout + debounced API post)
    this.root.querySelectorAll('[data-slider-key]').forEach((input) => {
      const key = input.dataset.sliderKey;
      const spec = SLIDER_SPECS.find((s) => s.key === key);
      input.addEventListener('pointerdown', () => { this.draggingKey = key; });
      input.addEventListener('pointerup', () => { this.draggingKey = null; });
      input.addEventListener('input', () => {
        const val = Number(input.value);
        const ro = q(`#simReadout_${key}`);
        if (ro && spec) ro.textContent = `${val}${spec.unit}`;
        clearTimeout(this.sliderTimers[key]);
        this.sliderTimers[key] = setTimeout(() => {
          this.sendControl({ [key]: val, lock_manual: true });
        }, 110);
      });
    });

    // Release individual manual locks
    this.root.querySelectorAll('[data-release]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sendControl({ release_manual: btn.dataset.release }, `Released ${btn.dataset.release} to live physics`);
      });
    });
    q('#simReleaseAllBtn')?.addEventListener('click', () => {
      this.sendControl({ release_manual: 'all' }, 'All sensors returned to live physics & weather sync');
    });

    // Pump & safety numeric parameters
    const bindNumeric = (sel, field) => {
      const el = q(sel);
      el?.addEventListener('change', () => {
        const v = Number(el.value);
        if (Number.isFinite(v)) this.sendControl({ [field]: v });
      });
    };
    bindNumeric('#simInputFlowLpm', 'rated_flow_lpm');
    bindNumeric('#simInputPriming', 'priming_s');
    bindNumeric('#simInputMaxRun', 'max_pump_run_s');

    // Weather form & crawl controls
    q('#simWeatherForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveWeatherConfig(true);
    });
    q('#simCrawlNowBtn')?.addEventListener('click', async () => {
      await this.crawlWeatherNow();
    });
    q('#simWeatherSyncToggle')?.addEventListener('change', (e) => {
      this.sendControl({ weather_sync: e.target.checked, force_telemetry: false });
    });
    q('#simRainSkipToggle')?.addEventListener('change', async () => {
      await this.saveWeatherConfig(false);
    });
  },

  highlightWire(wireId) {
    this.root.querySelectorAll('.svg-wire-group').forEach((g) => {
      g.classList.toggle('hovered', !!wireId && g.dataset.wireId === wireId);
    });
    this.root.querySelectorAll('[data-wire-row]').forEach((r) => {
      r.classList.toggle('hovered', !!wireId && r.dataset.wireRow === wireId);
    });
  },

  async toggleWire(wireId, connected) {
    try {
      const state = await this.deps.Api.setSimWire(wireId, connected);
      this.applyState(state);
      this.deps.onDeviceTelemetryChanged?.();
    } catch (err) {
      this.deps.Toast.show(err.message, 'error', 'Wire toggle failed');
    }
  },

  async sendControl(payload, toastMsg = '') {
    try {
      const state = await this.deps.Api.controlSim(payload);
      this.applyState(state);
      this.deps.onDeviceTelemetryChanged?.();
      if (toastMsg) this.deps.Toast.show(toastMsg, 'success');
    } catch (err) {
      this.deps.Toast.show(err.message, 'error', 'Control failed');
    }
  },

  async saveWeatherConfig(notify = true) {
    const q = (sel) => this.root.querySelector(sel);
    const location = q('#simWeatherLocation')?.value.trim() || '';
    const custom_url = q('#simWeatherUrl')?.value.trim() || '';
    const rain_skip_enabled = !!q('#simRainSkipToggle')?.checked;
    try {
      const weather = await this.deps.Api.configureWeather({
        location: location || undefined,
        custom_url,
        rain_skip_enabled,
      });
      if (this.state) {
        this.state.weather = weather;
        this.renderWeather(weather, this.state.weather_sync);
      }
      await this.refresh(true);
      if (notify) this.deps.Toast.show(`Weather target updated (${weather.location})`, 'success');
    } catch (err) {
      this.deps.Toast.show(err.message, 'error', 'Weather config error');
    }
  },

  async crawlWeatherNow() {
    const q = (sel) => this.root.querySelector(sel);
    const btn = q('#simCrawlNowBtn');
    const loc = q('#simWeatherLocation')?.value.trim() || '';
    const url = q('#simWeatherUrl')?.value.trim() || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Crawling...'; }
    try {
      if (loc || url) {
        await this.deps.Api.configureWeather({
          location: loc || undefined,
          custom_url: url,
        });
      }
      const weather = await this.deps.Api.getWeather({ refresh: true });
      if (this.state) {
        this.state.weather = weather;
        this.renderWeather(weather, this.state.weather_sync);
      }
      await this.refresh(true);
      this.deps.Toast.show(
        weather.online ? `Crawled live weather for ${weather.location}` : `Offline fallback (${weather.location})`,
        weather.online ? 'success' : 'warning'
      );
    } catch (err) {
      this.deps.Toast.show(err.message, 'error', 'Crawl failed');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Crawl Now'; }
    }
  },

  applyState(state) {
    if (!state || !this.root) return;
    this.state = state;
    const q = (sel) => this.root.querySelector(sel);
    const esp = state.esp32 || {};
    const r = state.readings || {};
    const sliders = state.sliders || {};

    // Top bar stats
    const dot = q('#simPulseDot');
    if (dot) {
      dot.classList.toggle('paused', !state.running);
      dot.classList.toggle('offline', !esp.wifi_connected);
    }
    const badge = q('#simDeviceBadge');
    if (badge) badge.textContent = `${state.device_code} · ${esp.wifi_connected ? (esp.ip || 'Wi-Fi OK') : 'Wi-Fi OPEN'}`;
    const upEl = q('#simUptimeStat');
    if (upEl) upEl.textContent = fmtUptime(esp.uptime_ms);
    const pumpEl = q('#simPumpStat');
    if (pumpEl) {
      const pTxt = esp.safety_lock
        ? 'LOCKED'
        : esp.pump_on
          ? (esp.pump_priming ? 'PRIMING' : `ON (${Number(esp.physical_flow_lpm || 0).toFixed(1)} L/m)`)
          : 'OFF';
      pumpEl.textContent = pTxt;
      pumpEl.style.color = esp.safety_lock
        ? 'var(--color-danger)'
        : esp.pump_on
          ? 'var(--color-accent-primary)'
          : 'var(--color-text-primary)';
    }
    const volEl = q('#simVolStat');
    if (volEl) volEl.textContent = `${Number(esp.cumulative_litres || 0).toFixed(3)} L`;
    const trEl = q('#simTelemRate');
    if (trEl) trEl.textContent = `${Number(state.telemetry_interval_s || 4).toFixed(1)}s`;

    // Speed & Pause controls
    this.root.querySelectorAll('.sim-speed-btn').forEach((b) => {
      b.classList.toggle('active', Math.abs(Number(b.dataset.speed) - Number(state.speed_multiplier)) < 0.05);
    });
    const pauseBtn = q('#simPauseResumeBtn');
    if (pauseBtn) pauseBtn.textContent = state.running ? 'Pause Clock' : 'Resume Clock';

    // Safety banner
    const banner = q('#simSafetyBanner');
    const bannerTxt = q('#simSafetyBannerText');
    const clearBtn = q('#simBannerClearBtn');
    if (banner && bannerTxt) {
      if (esp.flow_overvolt_warning) {
        banner.classList.remove('hidden', 'warning');
        bannerTxt.textContent = 'ELECTRICAL HAZARD: R2 20kΩ divider ground leg open — GPIO25 exposed to 5.02V (>3.6V max)!';
        if (clearBtn) clearBtn.style.display = 'none';
      } else if (esp.safety_lock) {
        banner.classList.remove('hidden', 'warning');
        bannerTxt.textContent = `SAFETY LATCH: ${esp.safety_reason || 'Emergency / dry-tank protection active — pump inhibited'}`;
        if (clearBtn) clearBtn.style.display = '';
      } else if (esp.comms_fault || esp.safety_reason || esp.flyback_diode_ok === false) {
        banner.classList.remove('hidden');
        banner.classList.add('warning');
        bannerTxt.textContent =
          esp.flyback_diode_ok === false
            ? `PASSIVE WARNING: D1 1N4007 flyback diode open — relay contacts unguarded (${esp.emi_back_emf_events || 0} back-EMF arcs)`
            : `WATCHDOG NOTICE: ${esp.safety_reason || 'Backend Wi-Fi communication lost — local auto-stop armed'}`;
        if (clearBtn) clearBtn.style.display = 'none';
      } else {
        banner.classList.add('hidden');
      }
    }

    // Connections Sidebar
    const wires = state.wires || [];
    const connectedCount = wires.filter((w) => w.connected).length;
    const countPill = q('#simWireCountPill');
    if (countPill) {
      countPill.textContent = `${connectedCount} / ${wires.length} OK`;
      countPill.classList.toggle('degraded', connectedCount < wires.length);
    }
    const wireList = q('#simWireList');
    if (wireList) {
      wireList.innerHTML = wires
        .map((w) => {
          const sigWarn = /OVERVOLT|RISK|ARC|FLOAT|NO 5V|NO 3V3|CRC|JAM/i.test(w.signal || '');
          return `
          <div class="sim-wire-row ${w.connected ? '' : 'disconnected'} ${sigWarn && w.connected ? 'warn' : ''}" data-wire-row="${esc(w.id)}" data-connected="${w.connected}" role="listitem">
            <div class="sim-wire-swatch" style="background:${esc(w.color)}"></div>
            <div class="sim-wire-info">
              <div class="sim-wire-top">
                <span class="sim-pin-badge">${esc(w.pin)}</span>
                <span class="sim-wire-label" title="${esc(w.label)}">${esc(w.label)}</span>
              </div>
              <div class="sim-wire-route" title="${esc(w.pin)} ↔ ${esc(w.to_pin || w.component)}">↳ ${esc(w.to_pin || w.component)}</div>
              <div class="sim-wire-meta">
                <span class="sim-wire-component" title="${esc(w.detail)}">${esc(w.detail || w.component)}</span>
                <span class="sim-wire-signal ${sigWarn ? 'warn' : ''}">${esc(w.signal)}</span>
              </div>
            </div>
            <button type="button" class="sim-wire-toggle ${w.connected ? 'on' : ''}" aria-label="Toggle ${esc(w.label)}" aria-pressed="${w.connected}"></button>
          </div>`;
        })
        .join('');
    }

    // Inline Fault Chips
    const crcBtn = q('#simToggleDhtCrc');
    if (crcBtn) {
      const on = !!state.faults?.dht_checksum;
      crcBtn.classList.toggle('active', on);
      crcBtn.textContent = `DHT22 CRC Err: ${on ? 'ON' : 'OFF'}`;
    }
    const jamBtn = q('#simToggleFlowJam');
    if (jamBtn) {
      const on = !!state.faults?.flow_jam;
      jamBtn.classList.toggle('active', on);
      jamBtn.textContent = `Flow Jam: ${on ? 'ON' : 'OFF'}`;
    }

    // Update Interactive SVG Schematic
    updateSchematicSvg(q('#simSvgContainer'), state);

    // Update Sensor Sliders (skip thumb position if user is actively dragging that slider)
    for (const s of SLIDER_SPECS) {
      const val = sliders[s.key];
      const locked = !!sliders[s.manualKey];
      const rangeEl = q(`#simRange_${s.key}`);
      const readoutEl = q(`#simReadout_${s.key}`);
      const subEl = q(`#simSub_${s.key}`);
      const pillEl = this.root.querySelector(`[data-slider-wrap="${s.key}"] .sim-mode-pill`);
      if (rangeEl && this.draggingKey !== s.key && val != null) {
        rangeEl.value = String(val);
      }
      if (readoutEl && this.draggingKey !== s.key && val != null) {
        readoutEl.textContent = `${val}${s.unit}`;
      }
      if (subEl) subEl.textContent = s.sub(r);
      if (pillEl) {
        pillEl.classList.toggle('manual', locked);
        pillEl.textContent = locked ? 'LOCKED ×' : 'PHYSICS';
      }
    }

    // Numeric tuning inputs (update only when not focused)
    const setNumIfIdle = (sel, val) => {
      const el = q(sel);
      if (el && document.activeElement !== el && val != null) el.value = String(val);
    };
    setNumIfIdle('#simInputFlowLpm', sliders.rated_flow_lpm);
    setNumIfIdle('#simInputPriming', sliders.priming_s);
    setNumIfIdle('#simInputMaxRun', esp.max_pump_run_s);

    // Serial console
    const serialEl = q('#simSerialOutput');
    const logs = state.serial_log || [];
    if (serialEl) {
      serialEl.innerHTML = logs
        .map(
          (entry) => `
          <div class="sim-serial-line">
            <span class="sim-serial-ts">${esc(fmtSerialTs(entry.ts))}</span>
            <span class="sim-serial-tag ${esc(entry.tag)}">[${esc(entry.tag)}]</span>
            <span class="sim-serial-msg">${esc(entry.message ?? entry.msg)}</span>
          </div>`
        )
        .join('');
      serialEl.scrollTop = serialEl.scrollHeight;
    }

    // Weather Crawler & Rain-Skip
    if (state.weather) {
      this.renderWeather(state.weather, state.weather_sync);
    }
  },

  renderWeather(w, weatherSync = true) {
    const q = (sel) => this.root.querySelector(sel);
    const adv = w.advisor || {};
    const rules = w.rules || {};

    const locEl = q('#simWLoc');
    if (locEl) locEl.textContent = w.location || 'Unknown Location';
    const condEl = q('#simWCond');
    if (condEl) condEl.textContent = `${w.condition || '—'}${w.online === false ? ' · cached/offline' : ' · live crawl'}`;
    const tempEl = q('#simWTemp');
    if (tempEl) tempEl.textContent = w.temperature_c != null ? `${Number(w.temperature_c).toFixed(1)}°C` : '—°C';

    const setTxt = (sel, txt) => { const el = q(sel); if (el) el.textContent = txt; };
    setTxt('#simWHum', w.humidity_pct != null ? `${Number(w.humidity_pct).toFixed(0)}%` : '—');
    setTxt('#simWPrecip', w.precip_mm != null ? `${Number(w.precip_mm).toFixed(1)} mm` : '—');
    setTxt('#simWChance', w.rain_chance_pct != null ? `${Number(w.rain_chance_pct).toFixed(0)}%` : '—');
    setTxt('#simWWind', w.wind_kmh != null ? `${Number(w.wind_kmh).toFixed(1)} km/h` : '—');
    setTxt('#simWCloud', `${w.cloud_pct != null ? Number(w.cloud_pct).toFixed(0) + '%' : '—'} / UV ${w.uv_index ?? '—'}`);
    setTxt('#simWDrying', adv.estimated_drying_pct_per_hr != null ? `${adv.estimated_drying_pct_per_hr}%/h` : '—');

    const box = q('#simAdvisorBox');
    const badge = q('#simAdvisorBadge');
    const summary = q('#simAdvisorSummary');
    const benchBadge = q('#simBenchRainBadge');
    const rec = adv.recommendation || 'NORMAL';
    if (box) box.classList.toggle('skip', !!adv.should_skip);
    if (badge) {
      badge.textContent = rec.replace('_', ' ');
      badge.className = `weather-pill ${adv.should_skip ? 'skip' : rec === 'IRRIGATE_NEEDED' ? 'needed' : 'clear'}`;
    }
    if (summary) summary.textContent = adv.summary || '—';
    if (benchBadge) {
      benchBadge.textContent = adv.should_skip
        ? 'RAIN-SKIP ARMED'
        : weatherSync
          ? `Weather Sync · ${Number(w.temperature_c ?? 27).toFixed(0)}°C`
          : 'Weather Sync Paused';
      benchBadge.className = `weather-pill ${adv.should_skip ? 'skip' : 'clear'}`;
    }

    const locInput = q('#simWeatherLocation');
    if (locInput && document.activeElement !== locInput && rules.location) {
      locInput.value = rules.location;
    }
    const urlInput = q('#simWeatherUrl');
    if (urlInput && document.activeElement !== urlInput && rules.custom_url !== undefined) {
      urlInput.value = rules.custom_url || '';
    }
    const syncToggle = q('#simWeatherSyncToggle');
    if (syncToggle) syncToggle.checked = !!weatherSync;
    const skipToggle = q('#simRainSkipToggle');
    if (skipToggle && rules.rain_skip_enabled !== undefined) {
      skipToggle.checked = !!rules.rain_skip_enabled;
    }

    const preview = q('#simCrawlPreview');
    if (preview) {
      preview.textContent = w.crawled_report || 'No crawled report snippet available.';
    }
    const srcLink = q('#simWeatherSourceUrl');
    if (srcLink && w.source_url) {
      srcLink.href = w.source_url;
      srcLink.textContent = w.source_url.replace(/^https?:\/\//, '');
    }
    setTxt('#simWeatherFreshness', w.online ? 'Crawled via HTML/HTTP' : 'Offline fallback');
  },
};
