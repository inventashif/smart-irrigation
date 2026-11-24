/* ==========================================================================
 * ESP32 Hardware Lab — Concrete 30-Pin DevKit & Multi-Terminal Schematic
 * Matches firmware/pin_map.md & hardware/wiring-diagram.md:
 *   Domain A: USB 5V (VIN L15), 3.3V (R15), Common GND (L14/R14),
 *             4.7kΩ DHT22 pull-up, 10kΩ/20kΩ YF-S201 divider,
 *             1kΩ/2kΩ HC-SR04 ECHO divider, 330Ω status LED, PC817 Opto-Relay
 *   Domain B: Galvanically isolated 12V DC PSU, Relay COM/NO, Pump M+/M-, 1N4007
 * ========================================================================== */

const LEFT_HEADER = [
  { hdr: 'L1', name: 'EN', note: 'RST', active: false },
  { hdr: 'L2', name: 'VP/G36', note: 'IN', active: false },
  { hdr: 'L3', name: 'VN/G39', note: 'IN', active: false },
  { hdr: 'L4', name: 'GPIO34', note: 'ADC1_6', active: true, key: 'GPIO34', color: '#22d3ee' },
  { hdr: 'L5', name: 'GPIO35', note: 'ADC1_7', active: true, key: 'GPIO35', color: '#facc15' },
  { hdr: 'L6', name: 'GPIO32', note: 'ADC1_4', active: true, key: 'GPIO32', color: '#00d4aa' },
  { hdr: 'L7', name: 'GPIO33', note: '1-WIRE', active: true, key: 'GPIO33', color: '#38bdf8' },
  { hdr: 'L8', name: 'GPIO25', note: 'IRQ', active: true, key: 'GPIO25', color: '#60a5fa' },
  { hdr: 'L9', name: 'GPIO26', note: 'TRIG', active: true, key: 'GPIO26', color: '#34d399' },
  { hdr: 'L10', name: 'GPIO27', note: 'RLY_IN', active: true, key: 'GPIO27', color: '#f59e0b' },
  { hdr: 'L11', name: 'GPIO14', note: 'ECHO', active: true, key: 'GPIO14', color: '#10b981' },
  { hdr: 'L12', name: 'GPIO12', note: 'STRAP!', strap: true, active: false },
  { hdr: 'L13', name: 'GPIO13', note: 'LED', active: true, key: 'GPIO13', color: '#a855f7' },
  { hdr: 'L14', name: 'GND', note: '0V', active: true, key: 'GND', color: '#94a3b8' },
  { hdr: 'L15', name: 'VIN/5V', note: '5.0V', active: true, key: 'VIN_5V', color: '#f43f5e' },
];

const RIGHT_HEADER = [
  { hdr: 'R1', name: 'GPIO23', note: 'MOSI', active: false },
  { hdr: 'R2', name: 'GPIO22', note: 'SCL', active: false },
  { hdr: 'R3', name: 'GPIO1', note: 'TX0', active: false },
  { hdr: 'R4', name: 'GPIO3', note: 'RX0', active: false },
  { hdr: 'R5', name: 'GPIO21', note: 'SDA', active: false },
  { hdr: 'R6', name: 'GPIO19', note: 'MISO', active: false },
  { hdr: 'R7', name: 'GPIO18', note: 'SCK', active: false },
  { hdr: 'R8', name: 'GPIO5', note: 'STRAP', strap: true, active: false },
  { hdr: 'R9', name: 'GPIO17', note: 'TX2', active: false },
  { hdr: 'R10', name: 'GPIO16', note: 'RX2', active: false },
  { hdr: 'R11', name: 'GPIO4', note: 'STRAP', strap: true, active: false },
  { hdr: 'R12', name: 'GPIO2', note: 'STRAP', strap: true, active: false },
  { hdr: 'R13', name: 'GPIO15', note: 'STRAP', strap: true, active: false },
  { hdr: 'R14', name: 'GND', note: '0V', active: true, key: 'GND_R', color: '#94a3b8' },
  { hdr: 'R15', name: '3V3', note: '3.3V', active: true, key: '3V3', color: '#ef4444' },
];

const WIRE_ROUTES = [
  {
    id: 'power_3v3',
    color: '#ef4444',
    d: 'M 548 532 L 560 532 L 560 44 L 244 44 L 244 452 M 244 82 L 222 82 M 244 212 L 222 212 M 244 338 L 222 338 M 244 452 L 222 452',
    dots: [[244, 82], [244, 212], [244, 338], [244, 452]],
  },
  {
    id: 'power_5v',
    color: '#f43f5e',
    d: 'M 332 532 L 316 532 L 316 568 L 574 568 L 574 226 L 670 226 M 574 440 L 664 440 M 574 554 L 664 554',
    dots: [[574, 226], [574, 440], [574, 554]],
  },
  {
    id: 'gnd_common',
    color: '#94a3b8',
    d: 'M 332 508 L 254 508 L 254 612 L 642 612 L 642 508 L 548 508 M 254 130 L 254 508 M 254 130 L 222 130 M 254 260 L 222 260 M 254 386 L 222 386 M 254 500 L 222 500 M 642 150 L 642 508 M 642 150 L 670 150 M 642 266 L 670 266 M 642 496 L 664 496 M 642 606 L 664 606',
    dots: [[254, 508], [254, 260], [254, 386], [254, 500], [642, 508], [642, 266], [642, 496], [642, 606]],
  },
  { id: 'rain_sig', color: '#22d3ee', d: 'M 332 268 L 272 268 L 272 362 L 222 362', dots: [] },
  { id: 'light_sig', color: '#facc15', d: 'M 332 292 L 282 292 L 282 476 L 222 476', dots: [] },
  { id: 'soil_sig', color: '#00d4aa', d: 'M 332 316 L 292 316 L 292 106 L 222 106', dots: [] },
  { id: 'dht_sig', color: '#38bdf8', d: 'M 332 340 L 302 340 L 302 236 L 222 236', dots: [[278, 236]] },
  { id: 'dht_pullup', color: '#7dd3fc', d: 'M 244 212 L 278 212 L 278 236', dots: [[244, 212], [278, 236]] },
  { id: 'flow_sig', color: '#60a5fa', d: 'M 332 364 L 310 364 L 310 582 L 598 582 L 598 468 L 664 468', dots: [[620, 468]] },
  { id: 'flow_div_gnd', color: '#93c5fd', d: 'M 620 468 L 620 512 L 642 512', dots: [[620, 468], [642, 512]] },
  { id: 'tank_trig', color: '#34d399', d: 'M 332 388 L 304 388 L 304 590 L 608 590 L 608 572 L 664 572', dots: [] },
  { id: 'relay_in', color: '#f59e0b', d: 'M 332 412 L 298 412 L 298 598 L 586 598 L 586 246 L 670 246', dots: [] },
  { id: 'tank_echo', color: '#10b981', d: 'M 332 436 L 290 436 L 290 604 L 618 604 L 618 590 L 664 590', dots: [] },
  { id: 'led_sig', color: '#a855f7', d: 'M 332 484 L 320 484 L 320 126 L 670 126', dots: [] },
  {
    id: 'pump_12v',
    color: '#fb923c',
    d: 'M 812 324 L 812 224 L 832 224 M 832 246 L 948 246 L 948 316 L 924 316 M 924 366 L 948 366 L 948 394 L 812 394 L 812 366',
    dots: [],
  },
  {
    id: 'flyback_diode',
    color: '#fdba74',
    d: 'M 936 316 L 936 330 M 936 352 L 936 366',
    dots: [[936, 316], [936, 366]],
  },
  { id: 'wifi_link', color: '#818cf8', d: 'M 440 126 L 440 52 L 670 52', dots: [] },
];

function renderPinRows() {
  const left = LEFT_HEADER.map((p, idx) => {
    const y = 196 + idx * 24;
    const fill = p.active ? p.color : p.strap ? '#475569' : '#334155';
    const textFill = p.active ? '#f8fafc' : p.strap ? '#94a3b8' : '#64748b';
    return `
      <g class="svg-mcu-pin" data-mcu-pin="${p.hdr}">
        <rect x="328" y="${y - 5}" width="10" height="10" rx="2" fill="#eab308" stroke="#713f12" stroke-width="0.8" />
        <circle id="svgPinLed_${p.hdr}" cx="344" cy="${y}" r="3.2" fill="${fill}" opacity="${p.active ? '0.95' : '0.35'}" />
        <text x="351" y="${y + 3}" fill="${textFill}" font-size="8.4" font-weight="${p.active ? '600' : '400'}" font-family="JetBrains Mono, monospace">${p.hdr} ${p.name}</text>
        <text id="svgPinNote_${p.hdr}" x="427" y="${y + 3}" text-anchor="end" fill="${p.strap ? '#f59e0b' : '#64748b'}" font-size="7.4" font-family="JetBrains Mono, monospace">${p.note}</text>
      </g>`;
  }).join('');

  const right = RIGHT_HEADER.map((p, idx) => {
    const y = 196 + idx * 24;
    const fill = p.active ? p.color : p.strap ? '#475569' : '#334155';
    const textFill = p.active ? '#f8fafc' : p.strap ? '#94a3b8' : '#64748b';
    return `
      <g class="svg-mcu-pin" data-mcu-pin="${p.hdr}">
        <rect x="542" y="${y - 5}" width="10" height="10" rx="2" fill="#eab308" stroke="#713f12" stroke-width="0.8" />
        <circle id="svgPinLed_${p.hdr}" cx="536" cy="${y}" r="3.2" fill="${fill}" opacity="${p.active ? '0.95' : '0.35'}" />
        <text x="529" y="${y + 3}" text-anchor="end" fill="${textFill}" font-size="8.4" font-weight="${p.active ? '600' : '400'}" font-family="JetBrains Mono, monospace">${p.name} ${p.hdr}</text>
        <text id="svgPinNote_${p.hdr}" x="452" y="${y + 3}" fill="${p.strap ? '#f59e0b' : '#64748b'}" font-size="7.4" font-family="JetBrains Mono, monospace">${p.note}</text>
      </g>`;
  }).join('');

  return left + right;
}

function padMark(x, y, label, align = 'left', color = '#eab308') {
  const tx = align === 'left' ? x - 6 : x + 6;
  const anchor = align === 'left' ? 'end' : 'start';
  return `
    <rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" rx="1.4" fill="${color}" stroke="#0f172a" stroke-width="0.9" />
    <text x="${tx}" y="${y + 3}" text-anchor="${anchor}" fill="#94a3b8" font-size="7.6" font-family="JetBrains Mono, monospace">${label}</text>`;
}

export function buildSchematicSvgMarkup() {
  const wireGroups = WIRE_ROUTES.map((w) => {
    const dots = (w.dots || [])
      .map(([cx, cy]) => `<circle class="svg-solder-dot" cx="${cx}" cy="${cy}" r="3.1" fill="${w.color}" />`)
      .join('');
    const passiveBody =
      w.id === 'dht_pullup'
        ? `<g class="svg-passive-tag"><rect x="266" y="216" width="24" height="15" rx="2.5" fill="#0f172a" stroke="#7dd3fc" stroke-width="1.1"/><text x="278" y="226" text-anchor="middle" fill="#e0f2fe" font-size="6.8" font-family="JetBrains Mono, monospace">4.7k</text></g>`
        : w.id === 'flow_div_gnd'
          ? `<g class="svg-passive-tag"><rect x="608" y="481" width="24" height="22" rx="2.5" fill="#0f172a" stroke="#93c5fd" stroke-width="1.1"/><text x="620" y="491" text-anchor="middle" fill="#dbeafe" font-size="6.5" font-family="JetBrains Mono, monospace">R2</text><text x="620" y="499" text-anchor="middle" fill="#93c5fd" font-size="6.5" font-family="JetBrains Mono, monospace">20k</text></g>`
          : w.id === 'flyback_diode'
            ? `<g class="svg-passive-tag" id="svgFlybackBody"><rect x="926" y="328" width="20" height="26" rx="2.5" fill="#18181b" stroke="#fdba74" stroke-width="1.1"/><line x1="927" y1="333" x2="945" y2="333" stroke="#f8fafc" stroke-width="2"/><polygon points="936,335 930,346 942,346" fill="#fdba74"/><text x="919" y="344" text-anchor="end" fill="#fdba74" font-size="6.8" font-family="JetBrains Mono, monospace">1N4007</text></g>`
            : '';
    return `
    <g class="svg-wire-group" data-wire-id="${w.id}">
      <title>Click to connect / disconnect net: ${w.id}</title>
      <path class="svg-wire-hit" d="${w.d}" />
      <path class="svg-wire-base" d="${w.d}" stroke="${w.color}" style="color:${w.color}" />
      <path class="svg-wire-pulse" d="${w.d}" stroke="${w.color}" />
      ${dots}
      ${passiveBody}
    </g>`;
  }).join('');

  return `
  <svg class="sim-schematic-svg" viewBox="0 0 968 632" role="img" aria-label="Concrete 30-pin ESP32 DevKit V1 hardware schematic with Domain A and isolated Domain B">
    <defs>
      <linearGradient id="pcbGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#152232" />
        <stop offset="100%" stop-color="#0b131e" />
      </linearGradient>
      <linearGradient id="tankWaterGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.9" />
        <stop offset="100%" stop-color="#0284c7" stop-opacity="0.96" />
      </linearGradient>
      <linearGradient id="soilWetGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#92400e" />
        <stop offset="100%" stop-color="#00d4aa" />
      </linearGradient>
      <filter id="ledGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- Domain A & Domain B Electrical Isolation Boundaries -->
    <rect x="10" y="12" width="644" height="608" rx="11" fill="rgba(15,23,42,0.42)" stroke="#1e293b" stroke-dasharray="4 4" />
    <text x="22" y="30" fill="#94a3b8" font-size="9.6" font-weight="600" font-family="JetBrains Mono, monospace">DOMAIN A · USB 5V (VIN) + 3.3V LOGIC + COMMON GND</text>

    <rect x="662" y="182" width="296" height="224" rx="11" fill="rgba(251,146,60,0.05)" stroke="rgba(251,146,60,0.42)" stroke-dasharray="5 4" />
    <text x="674" y="196" fill="#fb923c" font-size="9.4" font-weight="600" font-family="JetBrains Mono, monospace">DOMAIN B · GALVANICALLY ISOLATED 12V DC PUMP</text>

    <!-- Hydraulic Water Loop (Reservoir -> Pump -> YF-S201 -> Soil Bed) -->
    <g id="svgHydraulics">
      <path class="svg-pipe-outer" d="M 880 534 L 880 380" />
      <path class="svg-pipe-inner" d="M 880 534 L 880 380" />
      <path class="svg-pipe-water" id="svgPipeTankToPump" d="M 880 534 L 880 380" />

      <path class="svg-pipe-outer" d="M 852 380 L 852 422" />
      <path class="svg-pipe-inner" d="M 852 380 L 852 422" />
      <path class="svg-pipe-water" id="svgPipePumpToFlow" d="M 852 380 L 852 422" />

      <path class="svg-pipe-outer" d="M 852 508 L 852 522 L 16 522 L 16 106 L 22 106" />
      <path class="svg-pipe-inner" d="M 852 508 L 852 522 L 16 522 L 16 106 L 22 106" />
      <path class="svg-pipe-water" id="svgPipeFlowToSoil" d="M 852 508 L 852 522 L 16 522 L 16 106 L 22 106" />
    </g>

    <!-- 17 Interactive Electrical Nets & Passives -->
    <g id="svgWiresLayer">${wireGroups}</g>

    <!-- Series R1 10kΩ on YF-S201 SIG -> GPIO25 Tap -->
    <g pointer-events="none">
      <rect x="628" y="460" width="28" height="15" rx="2.5" fill="#0f172a" stroke="#60a5fa" stroke-width="1" />
      <text x="642" y="470" text-anchor="middle" fill="#dbeafe" font-size="6.8" font-family="JetBrains Mono, monospace">10kΩ</text>
      <text id="svgFlowTapBadge" x="620" y="455" text-anchor="middle" fill="#93c5fd" font-size="7.4" font-weight="600" font-family="JetBrains Mono, monospace">3.34V</text>
    </g>

    <!-- LEFT PERIPHERAL MODULES (Multi-Terminal Pads) -->
    <!-- 1. Capacitive Soil Moisture Sensor v1.2 -->
    <g transform="translate(22, 56)">
      <rect width="200" height="96" rx="8" fill="#111923" stroke="#1f3a3d" />
      <text x="12" y="19" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">Capacitive Soil Probe v1.2</text>
      <text x="12" y="33" fill="#64748b" font-size="8.8" font-family="JetBrains Mono, monospace">TL555C · 0–3.0V -> G32 (L6)</text>
      <rect x="12" y="43" width="136" height="9" rx="4.5" fill="#1e293b" />
      <rect id="svgSoilBar" x="12" y="43" width="60" height="9" rx="4.5" fill="url(#soilWetGrad)" />
      <text id="svgSoilVal" x="12" y="72" fill="#00d4aa" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">41.0% · 2230 ADC</text>
      <text id="svgSoilVolt" x="12" y="86" fill="#64748b" font-size="8.2" font-family="JetBrains Mono, monospace">AOUT = 1.80V (ADC1_CH4)</text>
    </g>
    ${padMark(222, 82, '1:VCC', 'left', '#ef4444')}
    ${padMark(222, 106, '3:AOUT', 'left', '#00d4aa')}
    ${padMark(222, 130, '2:GND', 'left', '#94a3b8')}

    <!-- 2. DHT22 Digital Temp/RH Sensor -->
    <g transform="translate(22, 186)">
      <rect width="200" height="96" rx="8" fill="#111923" stroke="#1e3a5f" />
      <text x="12" y="19" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">DHT22 (AM2302) 1-Wire</text>
      <text x="12" y="33" fill="#64748b" font-size="8.8" font-family="JetBrains Mono, monospace">Open-Drain -> G33 (L7) + 4.7kΩ</text>
      <text id="svgDhtTemp" x="12" y="57" fill="#38bdf8" font-size="12" font-weight="600" font-family="JetBrains Mono, monospace">27.5 °C</text>
      <text id="svgDhtHum" x="88" y="57" fill="#93c5fd" font-size="12" font-weight="600" font-family="JetBrains Mono, monospace">60.0 %RH</text>
      <text id="svgDhtStatus" x="12" y="82" fill="#64748b" font-size="8.4" font-family="JetBrains Mono, monospace">R_PU 4.7kΩ->3V3 · 40-bit OK</text>
    </g>
    ${padMark(222, 212, '1:VDD', 'left', '#ef4444')}
    ${padMark(222, 236, '2:DATA', 'left', '#38bdf8')}
    ${padMark(222, 248, '3:NC', 'left', '#475569')}
    ${padMark(222, 260, '4:GND', 'left', '#94a3b8')}

    <!-- 3. LM393 Rain Drop Board -->
    <g transform="translate(22, 312)">
      <rect width="200" height="94" rx="8" fill="#111923" stroke="#164e63" />
      <text x="12" y="19" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">LM393 Rain Drop Board</text>
      <text x="12" y="33" fill="#64748b" font-size="8.8" font-family="JetBrains Mono, monospace">Input-Only ADC1_CH6 -> G34 (L4)</text>
      <rect x="12" y="43" width="136" height="8" rx="4" fill="#1e293b" />
      <rect id="svgRainBar" x="12" y="43" width="4" height="8" rx="4" fill="#22d3ee" />
      <text id="svgRainVal" x="12" y="72" fill="#22d3ee" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">0.0% · DRY</text>
      <text id="svgRainSub" x="12" y="85" fill="#64748b" font-size="8.2" font-family="JetBrains Mono, monospace">DO unconnected · AO analog</text>
    </g>
    ${padMark(222, 338, '1:VCC', 'left', '#ef4444')}
    ${padMark(222, 362, '3:AO', 'left', '#22d3ee')}
    ${padMark(222, 374, '4:DO', 'left', '#475569')}
    ${padMark(222, 386, '2:GND', 'left', '#94a3b8')}

    <!-- 4. GL5528 LDR + 10kΩ Pull-Down Divider -->
    <g transform="translate(22, 428)">
      <rect width="200" height="94" rx="8" fill="#111923" stroke="#422006" />
      <text x="12" y="19" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">GL5528 LDR + 10kΩ</text>
      <text x="12" y="33" fill="#64748b" font-size="8.8" font-family="JetBrains Mono, monospace">Input-Only ADC1_CH7 -> G35 (L5)</text>
      <rect x="12" y="43" width="136" height="8" rx="4" fill="#1e293b" />
      <rect id="svgLightBar" x="12" y="43" width="90" height="8" rx="4" fill="#facc15" />
      <text id="svgLightVal" x="12" y="72" fill="#facc15" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">68% · 42000 lx</text>
      <text x="12" y="85" fill="#64748b" font-size="8.2" font-family="JetBrains Mono, monospace">3V3 -> LDR -> Tap -> 10kΩ -> GND</text>
    </g>
    ${padMark(222, 452, '1:3V3', 'left', '#ef4444')}
    ${padMark(222, 476, '2:TAP', 'left', '#facc15')}
    ${padMark(222, 500, '3:10k->0V', 'left', '#94a3b8')}

    <!-- CENTER: 30-Pin ESP32-WROOM-32 DevKit V1 -->
    <g id="svgEsp32Board">
      <rect x="334" y="118" width="212" height="436" rx="10" fill="url(#pcbGrad)" stroke="#334155" stroke-width="1.8" />
      <!-- PCB 2.4GHz Meander Antenna -->
      <rect x="386" y="102" width="108" height="24" rx="4" fill="#0b131e" stroke="#475569" />
      <path d="M 398 119 L 398 109 L 410 109 L 410 119 L 422 119 L 422 109 L 434 109 L 434 119 L 448 119 L 448 109 L 462 109 L 462 119 L 476 119" fill="none" stroke="#eab308" stroke-width="1.5" />
      <!-- RF Shield Can -->
      <rect x="386" y="132" width="108" height="50" rx="5" fill="#1e293b" stroke="#64748b" stroke-width="1.2" />
      <text x="440" y="150" text-anchor="middle" fill="#f8fafc" font-size="9.5" font-weight="700" font-family="JetBrains Mono, monospace">ESP32-WROOM-32</text>
      <text id="svgEspFw" x="440" y="163" text-anchor="middle" fill="#94a3b8" font-size="7.8" font-family="JetBrains Mono, monospace">FW 1.2.0-sim · 30-PIN</text>
      <text id="svgEspState" x="440" y="176" text-anchor="middle" fill="#00d4aa" font-size="7.8" font-weight="600" font-family="JetBrains Mono, monospace">BOOT SAFE · IDLE</text>
      <!-- AMS1117-3.3 LDO & Onboard PWR LED + USB-C -->
      <rect x="404" y="520" width="72" height="18" rx="3" fill="#0f172a" stroke="#475569" />
      <text x="440" y="532" text-anchor="middle" fill="#cbd5e1" font-size="7.2" font-family="JetBrains Mono, monospace">AMS1117-3.3</text>
      <circle id="svgEspPwrLed" cx="392" cy="529" r="3.5" fill="#ef4444" filter="url(#ledGlow)" />
      <rect x="412" y="544" width="56" height="14" rx="3" fill="#334155" stroke="#94a3b8" />
      <text x="440" y="554" text-anchor="middle" fill="#f8fafc" font-size="7.2" font-family="JetBrains Mono, monospace">USB 5V</text>
      ${renderPinRows()}
    </g>

    <!-- RIGHT TOP: Wi-Fi Backend & Status LED + 330Ω -->
    <g transform="translate(670, 22)">
      <rect width="282" height="58" rx="8" fill="#111923" stroke="#334155" />
      <circle id="svgWifiDot" cx="22" cy="29" r="5.5" fill="#818cf8" />
      <path class="svg-wifi-wave pulse" id="svgWifiWave" d="M 14 21 A 12 12 0 0 1 30 21 M 10 16 A 18 18 0 0 1 34 16" fill="none" stroke="#818cf8" stroke-width="1.7" stroke-linecap="round" />
      <text x="42" y="23" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">FastAPI :8000 &amp; Web Weather</text>
      <text id="svgWifiText" x="42" y="41" fill="#94a3b8" font-size="9.6" font-family="JetBrains Mono, monospace">ONLINE · 192.168.1.120</text>
    </g>

    <g transform="translate(670, 98)">
      <rect width="282" height="66" rx="8" fill="#111923" stroke="#334155" />
      <rect x="18" y="22" width="32" height="12" rx="2.5" fill="#0f172a" stroke="#a855f7" />
      <text x="34" y="31" text-anchor="middle" fill="#e9d5ff" font-size="7.2" font-family="JetBrains Mono, monospace">330Ω</text>
      <line x1="50" y1="28" x2="64" y2="28" stroke="#a855f7" stroke-width="1.6" />
      <circle id="svgStatusLed" cx="74" cy="28" r="8.5" fill="#334155" stroke="#64748b" stroke-width="1.4" />
      <text x="94" y="24" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">Status LED + R_LED 330Ω</text>
      <text id="svgLedText" x="94" y="41" fill="#94a3b8" font-size="9.4" font-family="JetBrains Mono, monospace">G13 (L13) -> A · K -> GND · OFF</text>
    </g>
    ${padMark(670, 126, 'A(330Ω)', 'right', '#a855f7')}
    ${padMark(670, 150, 'K(GND)', 'right', '#94a3b8')}

    <!-- DOMAIN B: PC817 Opto-Relay + 12V PSU + DC Pump + 1N4007 -->
    <g transform="translate(670, 202)">
      <rect width="162" height="80" rx="8" fill="#111923" stroke="#78350f" />
      <line x1="82" y1="8" x2="82" y2="72" stroke="#f59e0b" stroke-dasharray="3 3" opacity="0.55" />
      <circle id="svgRelayLamp" cx="68" cy="18" r="4.5" fill="#334155" />
      <text x="42" y="18" fill="#f8fafc" font-size="9.4" font-weight="600" font-family="Inter, sans-serif">PC817</text>
      <text x="90" y="18" fill="#fb923c" font-size="8.6" font-weight="600" font-family="JetBrains Mono, monospace">SPDT</text>
      <!-- Animated Relay Armature COM(162,22) -> NC(162,66) or NO(162,44) -->
      <line id="svgRelayBlade" x1="120" y1="22" x2="156" y2="62" stroke="#fb923c" stroke-width="2.4" stroke-linecap="round" />
      <circle cx="120" cy="22" r="3" fill="#fb923c" />
      <text id="svgRelayText" x="81" y="74" text-anchor="middle" fill="#f59e0b" font-size="7.8" font-family="JetBrains Mono, monospace">G27=HIGH · OPEN</text>
    </g>
    ${padMark(670, 226, 'VCC', 'right', '#f43f5e')}
    ${padMark(670, 246, 'IN', 'right', '#f59e0b')}
    ${padMark(670, 266, 'GND', 'right', '#94a3b8')}
    ${padMark(832, 224, 'COM', 'left', '#fb923c')}
    ${padMark(832, 246, 'NO', 'left', '#fb923c')}
    ${padMark(832, 268, 'NC', 'left', '#475569')}

    <!-- 12V DC Isolated Power Supply -->
    <g transform="translate(674, 308)">
      <rect width="138" height="72" rx="8" fill="#111923" stroke="#7c2d12" />
      <text x="12" y="21" fill="#fed7aa" font-size="10.5" font-weight="600" font-family="Inter, sans-serif">12V DC PSU (2A)</text>
      <text x="12" y="36" fill="#9a3412" font-size="8.4" font-family="JetBrains Mono, monospace">Isolated Domain B</text>
      <text id="svgPsuText" x="12" y="57" fill="#fb923c" font-size="9.2" font-family="JetBrains Mono, monospace">+12.0V · RTN ISO</text>
    </g>
    ${padMark(812, 324, '+12V', 'left', '#fb923c')}
    ${padMark(812, 366, '12V-', 'left', '#94a3b8')}

    <!-- 12V Diaphragm / Centrifugal Pump -->
    <g transform="translate(828, 304)">
      <rect width="96" height="76" rx="8" fill="#111923" stroke="#fb923c" />
      <g id="svgPumpImpeller" class="svg-impeller" transform="translate(34, 34)">
        <circle cx="0" cy="0" r="14" fill="#0f172a" stroke="#38bdf8" stroke-width="1.3" />
        <path d="M -9 0 L 9 0 M 0 -9 L 0 9 M -6 -6 L 6 6 M -6 6 L 6 -6" stroke="#38bdf8" stroke-width="1.6" />
      </g>
      <text x="54" y="26" fill="#f8fafc" font-size="9.5" font-weight="600" font-family="Inter, sans-serif">PUMP</text>
      <text id="svgPumpStateText" x="8" y="68" fill="#94a3b8" font-size="7.8" font-weight="600" font-family="JetBrains Mono, monospace">OFF · 0.00 L/m</text>
    </g>
    ${padMark(924, 316, 'M+', 'left', '#fb923c')}
    ${padMark(924, 366, 'M-', 'left', '#94a3b8')}

    <!-- YF-S201 Hall Flow Sensor (5V VCC + 10k/20k Divider) -->
    <g transform="translate(664, 422)">
      <rect width="288" height="86" rx="8" fill="#111923" stroke="#1e3a8a" />
      <text x="58" y="20" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">YF-S201 Hall Turbine Flow Sensor</text>
      <text x="58" y="34" fill="#64748b" font-size="8.6" font-family="JetBrains Mono, monospace">5V Hall -> R1 10kΩ / R2 20kΩ -> G25 (L8)</text>
      <text id="svgFlowVal" x="58" y="57" fill="#60a5fa" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">0.00 L/m · 0 pulses</text>
      <text id="svgFlowDividerNote" x="58" y="74" fill="#64748b" font-size="8.2" font-family="JetBrains Mono, monospace">Divider Tap = 3.34V SAFE (&lt;3.6V max)</text>
    </g>
    ${padMark(664, 440, '1:5V', 'right', '#f43f5e')}
    ${padMark(664, 468, '2:SIG', 'right', '#60a5fa')}
    ${padMark(664, 496, '3:GND', 'right', '#94a3b8')}

    <!-- HC-SR04 Ultrasonic Reservoir Sensor (5V VCC + TRIG G26 + ECHO 1k/2k G14) -->
    <g transform="translate(664, 534)">
      <rect width="288" height="84" rx="8" fill="#111923" stroke="#065f46" />
      <text x="64" y="19" fill="#e2e8f0" font-size="11" font-weight="600" font-family="Inter, sans-serif">HC-SR04 Ultrasonic + 50L Tank</text>
      <text x="64" y="33" fill="#64748b" font-size="8.4" font-family="JetBrains Mono, monospace">TRIG<-G26(L9) · ECHO->1k/2k->G14(L11)</text>
      <text id="svgTankVal" x="64" y="56" fill="#34d399" font-size="11" font-weight="600" font-family="JetBrains Mono, monospace">84.0% (42.0 L)</text>
      <text id="svgTankPinsSub" x="64" y="73" fill="#64748b" font-size="8.2" font-family="JetBrains Mono, monospace">TRIG OK · ECHO OK · Dry cutoff &lt;2%</text>
      <!-- Tank Gauge -->
      <rect x="242" y="12" width="34" height="60" rx="4" fill="#0f172a" stroke="#334155" />
      <rect id="svgTankFill" x="244" y="24" width="30" height="46" rx="2.5" fill="url(#tankWaterGrad)" />
    </g>
    ${padMark(664, 554, '1:5V', 'right', '#f43f5e')}
    ${padMark(664, 572, '2:TRIG', 'right', '#34d399')}
    ${padMark(664, 590, '3:ECHO', 'right', '#10b981')}
    ${padMark(664, 606, '4:GND', 'right', '#94a3b8')}
  </svg>`;
}

export function updateSchematicSvg(container, state) {
  if (!container || !state) return;
  const q = (sel) => container.querySelector(sel);
  const esp = state.esp32 || {};
  const r = state.readings || {};
  const pins = esp.pins || {};
  const wireMap = {};
  for (const w of state.wires || []) wireMap[w.id] = w;

  // 1. Toggle open/closed class on all 17 interactive wire & passive groups
  container.querySelectorAll('.svg-wire-group').forEach((g) => {
    const wid = g.dataset.wireId;
    const w = wireMap[wid];
    g.classList.toggle('open', w ? !w.connected : false);
  });

  // 2. Hydraulic water flow & pump rotor animation
  const physicalFlow = Number(esp.physical_flow_lpm || 0);
  const priming = !!esp.pump_priming && !!esp.pump_on;
  const flowing = physicalFlow > 0.05;
  ['#svgPipeTankToPump', '#svgPipePumpToFlow', '#svgPipeFlowToSoil'].forEach((id) => {
    const el = q(id);
    if (!el) return;
    el.classList.toggle('flowing', flowing);
    el.classList.toggle('priming', !flowing && priming);
  });
  const imp = q('#svgPumpImpeller');
  if (imp) {
    imp.classList.toggle('spinning', flowing);
    imp.classList.toggle('priming', !flowing && priming);
  }

  // 3. ESP32 chip banner, AMS1117 power LED, and 30-pin live pad readouts
  const fwEl = q('#svgEspFw');
  if (fwEl) fwEl.textContent = `FW ${esp.fw_version || '1.2.0-sim'} · 30-PIN`;
  const stEl = q('#svgEspState');
  if (stEl) {
    if (wireMap.power_5v?.connected === false) {
      stEl.textContent = 'MCU UNPOWERED · VIN OPEN';
      stEl.setAttribute('fill', '#ef4444');
    } else if (wireMap.gnd_common?.connected === false) {
      stEl.textContent = 'GND FLOATING · BUS DEAD';
      stEl.setAttribute('fill', '#ef4444');
    } else if (esp.flow_overvolt_warning) {
      stEl.textContent = 'G25 5.02V OVERVOLT!';
      stEl.setAttribute('fill', '#ef4444');
    } else if (esp.safety_lock) {
      stEl.textContent = 'SAFETY LOCK ACTIVE';
      stEl.setAttribute('fill', '#ef4444');
    } else if (esp.comms_fault || !esp.wifi_connected) {
      stEl.textContent = 'COMMS LOSS · LOCAL GUARD';
      stEl.setAttribute('fill', '#f59e0b');
    } else if (esp.pump_on) {
      stEl.textContent = priming ? 'PUMP PRIMING' : 'IRRIGATING (G27=LOW)';
      stEl.setAttribute('fill', '#00d4aa');
    } else {
      stEl.textContent = 'BOOT SAFE · IDLE';
      stEl.setAttribute('fill', '#94a3b8');
    }
  }
  const pwrLed = q('#svgEspPwrLed');
  if (pwrLed) {
    const railOk = wireMap.power_5v?.connected !== false && wireMap.gnd_common?.connected !== false;
    pwrLed.setAttribute('fill', railOk ? '#ef4444' : '#334155');
  }

  const pinWireBinding = {
    L4: 'rain_sig',
    L5: 'light_sig',
    L6: 'soil_sig',
    L7: 'dht_sig',
    L8: 'flow_sig',
    L9: 'tank_trig',
    L10: 'relay_in',
    L11: 'tank_echo',
    L13: 'led_sig',
    L14: 'gnd_common',
    L15: 'power_5v',
    R14: 'gnd_common',
    R15: 'power_3v3',
  };
  const pinShortText = {
    L4: r.rain_adc != null ? `${((r.rain_adc / 4095) * 3.3).toFixed(1)}V` : 'OPEN',
    L5: r.light_pct != null ? `${((r.light_pct / 100) * 3.0 + 0.1).toFixed(1)}V` : 'OPEN',
    L6: r.raw_adc != null ? `${((r.raw_adc / 4095) * 3.3).toFixed(2)}V` : 'OPEN',
    L7: r.temperature_c != null ? '1W OK' : esp.dht_pullup_ok === false ? 'FLOAT' : 'ERR',
    L8: esp.flow_overvolt_warning
      ? '5.02V!'
      : wireMap.flow_sig?.connected === false
        ? 'OPEN'
        : `${Number(esp.flow_freq_hz || 0).toFixed(0)}Hz`,
    L9: wireMap.tank_trig?.connected !== false ? '10µs' : 'OPEN',
    L10: esp.pump_on ? '0V ON' : '3.3V',
    L11: r.tank_level_pct != null ? 'ECHO' : '0µs',
    L13: esp.led_on ? '3.3V' : '0.0V',
    L14: wireMap.gnd_common?.connected !== false ? '0.00V' : 'OPEN',
    L15: wireMap.power_5v?.connected !== false ? '5.02V' : 'OPEN',
    R14: wireMap.gnd_common?.connected !== false ? '0.00V' : 'OPEN',
    R15:
      wireMap.power_5v?.connected === false
        ? '0.00V'
        : wireMap.power_3v3?.connected !== false
          ? '3.30V'
          : 'OPEN',
  };
  Object.entries(pinWireBinding).forEach(([hdr, wid]) => {
    const led = q(`#svgPinLed_${hdr}`);
    const note = q(`#svgPinNote_${hdr}`);
    // R15 (3V3) also drops when the upstream VIN 5V rail is cut: the AMS1117
    // regulator has no input, so the whole 3.3V bus collapses.
    const cascaded = hdr === 'R15' && wireMap.power_5v?.connected === false;
    const ok = wireMap[wid]?.connected !== false && !cascaded;
    const warn = hdr === 'L8' && !!esp.flow_overvolt_warning;
    if (led) {
      led.setAttribute('opacity', ok ? '1' : '0.28');
      if (warn) led.setAttribute('fill', '#ef4444');
    }
    if (note && pinShortText[hdr]) {
      note.textContent = pinShortText[hdr];
      note.setAttribute('fill', warn || !ok ? '#f87171' : '#94a3b8');
    }
  });

  // 4. Wi-Fi & Status LED (GPIO13 + 330Ω)
  const wifiOk = !!esp.wifi_connected && wireMap.wifi_link?.connected !== false;
  const wifiDot = q('#svgWifiDot');
  const wifiWave = q('#svgWifiWave');
  const wifiTxt = q('#svgWifiText');
  if (wifiDot) wifiDot.setAttribute('fill', wifiOk ? '#818cf8' : '#ef4444');
  if (wifiWave) wifiWave.classList.toggle('pulse', wifiOk);
  if (wifiTxt) {
    wifiTxt.textContent = wifiOk ? `ONLINE · ${esp.ip || '192.168.1.120'}` : 'LINK DOWN · WATCHDOG ARMED';
    wifiTxt.setAttribute('fill', wifiOk ? '#94a3b8' : '#f87171');
  }

  const ledCircle = q('#svgStatusLed');
  const ledTxt = q('#svgLedText');
  if (ledCircle) {
    ledCircle.setAttribute('fill', esp.led_on ? '#a855f7' : '#334155');
    if (esp.led_on) ledCircle.setAttribute('filter', 'url(#ledGlow)');
    else ledCircle.removeAttribute('filter');
  }
  if (ledTxt) {
    if (wireMap.led_sig?.connected === false) {
      ledTxt.textContent = 'G13 (L13) OPEN · 0.0mA';
      ledTxt.setAttribute('fill', '#f87171');
    } else {
      ledTxt.textContent = esp.led_on ? 'G13=3.3V · 330Ω · 4.2mA ON' : 'G13=0.0V · 330Ω · OFF';
      ledTxt.setAttribute('fill', esp.led_on ? '#d8b4fe' : '#94a3b8');
    }
  }

  // 5. Left-side Analog & 1-Wire Sensors
  const soilVal = q('#svgSoilVal');
  const soilBar = q('#svgSoilBar');
  const soilVolt = q('#svgSoilVolt');
  if (r.soil_moisture_pct != null && r.raw_adc != null) {
    if (soilVal) {
      soilVal.textContent = `${Number(r.soil_moisture_pct).toFixed(1)}% · ${r.raw_adc} ADC`;
      soilVal.setAttribute('fill', '#00d4aa');
    }
    if (soilVolt) {
      const v = ((r.raw_adc / 4095) * 3.3).toFixed(2);
      soilVolt.textContent = `AOUT ${v}V -> GPIO32 · ADC1_CH4`;
      soilVolt.setAttribute('fill', '#64748b');
    }
    if (soilBar) {
      const w = Math.max(3, Math.min(136, (Number(r.soil_moisture_pct) / 100) * 136));
      soilBar.setAttribute('width', String(w));
    }
  } else {
    if (soilVal) { soilVal.textContent = 'AOUT OPEN / NO 3V3'; soilVal.setAttribute('fill', '#f87171'); }
    if (soilVolt) { soilVolt.textContent = wireMap.power_3v3?.connected === false ? '3V3 Rail Disconnected' : 'Pin 3 -> G32 Open'; soilVolt.setAttribute('fill', '#f87171'); }
  }

  const dTemp = q('#svgDhtTemp');
  const dHum = q('#svgDhtHum');
  const dSt = q('#svgDhtStatus');
  if (r.temperature_c != null && r.humidity_pct != null) {
    if (dTemp) { dTemp.textContent = `${Number(r.temperature_c).toFixed(1)} °C`; dTemp.setAttribute('fill', '#38bdf8'); }
    if (dHum) dHum.textContent = `${Number(r.humidity_pct).toFixed(1)} %RH`;
    if (dSt) { dSt.textContent = 'R_PU 4.7kΩ->3V3 · 40-bit OK'; dSt.setAttribute('fill', '#64748b'); }
  } else {
    if (dTemp) { dTemp.textContent = 'FAULT'; dTemp.setAttribute('fill', '#f87171'); }
    if (dHum) dHum.textContent = '— %RH';
    if (dSt) {
      if (wireMap.dht_pullup?.connected === false) dSt.textContent = 'R_PU 4.7kΩ OPEN · Bus Floating!';
      else if (state.faults?.dht_checksum) dSt.textContent = 'CRC-8 Checksum Mismatch';
      else if (wireMap.power_3v3?.connected === false) dSt.textContent = 'VDD 3.3V Rail Open';
      else dSt.textContent = 'Pin 2 DATA Wire Open';
      dSt.setAttribute('fill', '#f87171');
    }
  }

  const rainVal = q('#svgRainVal');
  const rainBar = q('#svgRainBar');
  if (rainVal) {
    if (r.rain_pct != null) {
      const rp = Number(r.rain_pct);
      const tag = rp >= 50 ? 'HEAVY RAIN' : rp >= 20 ? 'WET' : 'DRY';
      rainVal.textContent = `${rp.toFixed(1)}% · ${tag}`;
      rainVal.setAttribute('fill', '#22d3ee');
    } else {
      rainVal.textContent = 'AO OPEN / NO 3V3';
      rainVal.setAttribute('fill', '#f87171');
    }
  }
  if (rainBar) {
    const rp = Math.max(0, Math.min(100, Number(r.rain_pct || 0)));
    rainBar.setAttribute('width', String(Math.max(3, (rp / 100) * 136)));
  }

  const lightVal = q('#svgLightVal');
  const lightBar = q('#svgLightBar');
  if (lightVal) {
    if (r.light_pct != null) {
      lightVal.textContent = `${Number(r.light_pct).toFixed(0)}% · ${r.light_lux ?? 0} lx`;
      lightVal.setAttribute('fill', '#facc15');
    } else {
      lightVal.textContent = 'TAP OPEN / NO 3V3';
      lightVal.setAttribute('fill', '#f87171');
    }
  }
  if (lightBar) {
    const lp = Math.max(0, Math.min(100, Number(r.light_pct || 0)));
    lightBar.setAttribute('width', String(Math.max(3, (lp / 100) * 136)));
  }

  // 6. Opto-Relay, Domain B 12V Loop & 1N4007 Flyback Clamp
  const relayCoilPowered =
    wireMap.power_5v?.connected !== false &&
    wireMap.gnd_common?.connected !== false &&
    wireMap.relay_in?.connected !== false;
  const relayEnergized = !!esp.pump_on && relayCoilPowered;
  const relayTxt = q('#svgRelayText');
  const relayLamp = q('#svgRelayLamp');
  const relayBlade = q('#svgRelayBlade');
  if (relayBlade) {
    relayBlade.setAttribute('y2', relayEnergized ? '44' : '62');
    relayBlade.setAttribute('stroke', relayEnergized ? '#00d4aa' : '#fb923c');
  }
  if (relayLamp) relayLamp.setAttribute('fill', relayEnergized ? '#00d4aa' : '#334155');
  if (relayTxt) {
    if (!relayCoilPowered) {
      relayTxt.textContent = wireMap.power_5v?.connected === false ? 'NO 5V COIL' : 'IN/GND OPEN';
      relayTxt.setAttribute('fill', '#f87171');
    } else {
      relayTxt.textContent = relayEnergized ? 'G27=LOW · COM->NO' : 'G27=HIGH · COM->NC';
      relayTxt.setAttribute('fill', relayEnergized ? '#00d4aa' : '#f59e0b');
    }
  }

  const psuTxt = q('#svgPsuText');
  const diodeOpen = wireMap.flyback_diode?.connected === false;
  const arcs = Number(esp.emi_back_emf_events || 0);
  if (psuTxt) {
    if (diodeOpen) {
      psuTxt.textContent = arcs > 0 ? `1N4007 OPEN · ${arcs} ARC!` : '1N4007 OPEN · UNGUARDED';
      psuTxt.setAttribute('fill', '#f87171');
    } else {
      psuTxt.textContent = flowing ? '+12.0V · 0.65A LOAD' : '+12.0V · 1N4007 OK';
      psuTxt.setAttribute('fill', '#fb923c');
    }
  }

  const pumpTxt = q('#svgPumpStateText');
  if (pumpTxt) {
    if (wireMap.pump_12v?.connected === false && relayEnergized) {
      pumpTxt.textContent = '12V LOOP OPEN';
      pumpTxt.setAttribute('fill', '#f87171');
    } else if (flowing) {
      pumpTxt.textContent = `ON · ${physicalFlow.toFixed(2)} L/m`;
      pumpTxt.setAttribute('fill', '#00d4aa');
    } else if (priming) {
      pumpTxt.textContent = `PRIME ${esp.pump_on_time_s}s`;
      pumpTxt.setAttribute('fill', '#38bdf8');
    } else {
      pumpTxt.textContent = 'OFF · 0.00 L/m';
      pumpTxt.setAttribute('fill', '#94a3b8');
    }
  }

  // 7. YF-S201 + 10kΩ/20kΩ Voltage Divider
  const flowVal = q('#svgFlowVal');
  const flowDivNote = q('#svgFlowDividerNote');
  const flowTapBadge = q('#svgFlowTapBadge');
  if (flowTapBadge) {
    const tv = esp.flow_overvolt_warning ? '5.02V!' : wireMap.power_5v?.connected === false ? '0.0V' : '3.34V';
    flowTapBadge.textContent = tv;
    flowTapBadge.setAttribute('fill', esp.flow_overvolt_warning ? '#ef4444' : '#93c5fd');
  }
  if (flowDivNote) {
    if (esp.flow_overvolt_warning) {
      flowDivNote.textContent = 'DANGER: R2 20kΩ GND OPEN -> 5.02V ON GPIO25!';
      flowDivNote.setAttribute('fill', '#ef4444');
    } else if (wireMap.power_5v?.connected === false) {
      flowDivNote.textContent = 'YF-S201 Pin 1 (5V VCC) Unpowered';
      flowDivNote.setAttribute('fill', '#f87171');
    } else {
      flowDivNote.textContent = `Divider Tap = 3.34V SAFE · ${Number(esp.flow_freq_hz || 0).toFixed(1)} Hz`;
      flowDivNote.setAttribute('fill', '#64748b');
    }
  }
  if (flowVal) {
    if (wireMap.flow_sig?.connected === false || wireMap.power_5v?.connected === false) {
      flowVal.textContent = wireMap.power_5v?.connected === false ? 'NO 5V SUPPLY' : 'G25 TAP OPEN (null)';
      flowVal.setAttribute('fill', '#f87171');
    } else if (state.faults?.flow_jam) {
      flowVal.textContent = 'ROTOR JAMMED · 0.00 L/m';
      flowVal.setAttribute('fill', '#f59e0b');
    } else {
      flowVal.textContent = `${Number(esp.sensed_flow_lpm || 0).toFixed(2)} L/m · ${esp.total_pulses || 0} pulses`;
      flowVal.setAttribute('fill', esp.flow_overvolt_warning ? '#f59e0b' : '#60a5fa');
    }
  }

  // 8. HC-SR04 Ultrasonic Reservoir (Split TRIG G26 + ECHO G14)
  const tankVal = q('#svgTankVal');
  const tankSub = q('#svgTankPinsSub');
  const tankFill = q('#svgTankFill');
  const pct = Number(r.tank_level_pct ?? state.sliders?.tank_level_pct ?? 0);
  const trigOk = wireMap.tank_trig?.connected !== false;
  const echoOk = wireMap.tank_echo?.connected !== false;
  if (tankVal) {
    if (r.tank_level_pct != null) {
      tankVal.textContent = `${pct.toFixed(1)}% (${Number(r.tank_litres || 0).toFixed(1)} L)`;
      tankVal.setAttribute('fill', pct < 10 ? '#f87171' : '#34d399');
    } else {
      tankVal.textContent = !trigOk ? 'G26 TRIG OPEN' : !echoOk ? 'G14 ECHO OPEN' : 'NO 5V / GND';
      tankVal.setAttribute('fill', '#f87171');
    }
  }
  if (tankSub) {
    tankSub.textContent = `TRIG:${trigOk ? 'OK' : 'OPEN'} · ECHO(1k/2k):${echoOk ? 'OK' : 'OPEN'} · Cutoff <2%`;
    tankSub.setAttribute('fill', trigOk && echoOk ? '#64748b' : '#f87171');
  }
  if (tankFill) {
    const clamped = Math.max(0, Math.min(100, pct));
    const h = Math.round((clamped / 100) * 56);
    tankFill.setAttribute('y', String(70 - h));
    tankFill.setAttribute('height', String(h));
  }
}


