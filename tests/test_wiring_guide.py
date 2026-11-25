"""Browser regression checks for the offline wiring guide.

Run: python3 -m unittest discover -s tests -p test_wiring_guide.py -v
Requires Playwright and Chromium (or CHROMIUM_BIN). No backend or ESP32 required.
"""

import os
from pathlib import Path
import re
import shutil
import unittest

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "frontend" / "static" / "wiring.html"
CHROMIUM = os.environ.get("CHROMIUM_BIN") or shutil.which("chromium")


@unittest.skipUnless(sync_playwright and CHROMIUM, "Requires Playwright and Chromium")
class WiringGuideTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=CHROMIUM, headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 1440, "height": 1000}, reduced_motion="reduce"
        )
        self.context.set_offline(True)
        self.page = self.context.new_page()
        self.errors = []
        self.requests = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("request", lambda request: self.requests.append(request.url))
        self.page.goto(GUIDE.as_uri())

    def tearDown(self):
        self.assertEqual(self.errors, [], "The wiring guide raised a browser exception")
        self.context.close()

    def test_offline_guide_and_interactive_wire_inspector(self):
        self.assertFalse(any(url.startswith(("http:", "https:")) for url in self.requests))
        self.assertEqual(self.page.locator("#wires .wire").count(), 27)
        self.assertEqual(self.page.locator("#connection-rows tr").count(), 27)
        self.page.locator('[data-filter="flow"]').click()
        self.assertEqual(self.page.locator("#wires .wire:not(.dim)").count(), 7)
        self.page.locator('[data-select="17"]').click()
        self.assertIn("GPIO25", self.page.locator("#inspect-title").inner_text())
        self.assertEqual(
            self.page.locator("#inspect-link").get_attribute("href"), "#flow-detail"
        )
        self.assertEqual(self.page.locator("#wires .wire:not(.dim)").count(), 1)
        self.page.locator("#wire-22").focus()
        self.page.keyboard.press("Enter")
        self.assertIn("conditional", self.page.locator("#inspect-title").inner_text())
        self.page.locator('[data-filter="all"]').click()
        self.assertEqual(self.page.locator("#wires .wire:not(.dim)").count(), 27)

    def test_both_header_layouts_land_on_the_firmware_gpio_pins(self):
        config = (ROOT / "firmware" / "config.h").read_text()
        connections = [
            ("07", "SOIL_ADC_PIN", "end"),
            ("10", "DHT_DATA_PIN", "end"),
            ("17", "FLOW_PULSE_PIN", "end"),
            ("22", "RELAY_PUMP_PIN", "start"),
        ]
        for layout in ("30", "38"):
            with self.subTest(layout=layout):
                self.page.select_option("#board-layout", layout)
                self.assertEqual(self.page.locator("#board-pins > g").count(), int(layout))
                for wire, macro, endpoint in connections:
                    pin = re.search(rf"#define\s+{macro}\s+(\d+)", config).group(1)
                    points = self.page.evaluate(
                        """({wire, pin, endpoint}) => {
                            const wire_path = document.querySelector(
                                `#wire-${wire} .wire-line`
                            );
                            const point = wire_path.getPointAtLength(
                                endpoint === "start" ? 0 : wire_path.getTotalLength()
                            );
                            const label = [...document.querySelectorAll(
                                "#board-pins .pin-label"
                            )].find((item) => item.textContent === pin);
                            const pin_path = label.parentElement.querySelector("path");
                            const socket = pin_path.getPointAtLength(0);
                            return {x: point.x, y: point.y, px: socket.x, py: socket.y};
                        }""",
                        {"wire": wire, "pin": pin, "endpoint": endpoint},
                    )
                    self.assertAlmostEqual(points["x"], points["px"], places=2)
                    self.assertAlmostEqual(points["y"], points["py"], places=2)

    def test_checklist_persists_and_reset_clears_it(self):
        self.page.locator('[data-check="24"]').check()
        self.page.reload()
        self.assertTrue(self.page.locator('[data-check="24"]').is_checked())
        self.assertEqual(self.page.locator("#progress-label").inner_text(), "1 / 27 checked")
        self.page.locator("#reset-checks").click()
        self.page.reload()
        self.assertFalse(self.page.locator('[data-check="24"]').is_checked())
        self.assertEqual(self.page.locator("#progress-label").inner_text(), "0 / 27 checked")

    def test_mobile_zoom_and_print_show_the_complete_diagram(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.page.locator("#zoom-fit").click()
        widths = self.page.evaluate(
            """() => ({
                page: document.documentElement.scrollWidth,
                viewport: innerWidth,
                svg: document.querySelector("#wiring-map").getBoundingClientRect().width
            })"""
        )
        self.assertLessEqual(widths["page"], widths["viewport"])
        self.page.locator("#zoom-in").click()
        zoomed_width = self.page.locator("#wiring-map").bounding_box()["width"]
        self.assertGreater(zoomed_width, widths["svg"])
        self.page.locator('[data-filter="pump"]').click()
        self.page.emulate_media(media="print")
        print_style = self.page.evaluate(
            """() => ({
                opacity: getComputedStyle(document.querySelector("#wire-07")).opacity,
                min_width: getComputedStyle(document.querySelector("#wiring-map")).minWidth,
                overflow: getComputedStyle(document.querySelector(".drawing-viewport")).overflow
            })"""
        )
        self.assertEqual(print_style["opacity"], "1")
        self.assertEqual(print_style["min_width"], "0px")
        self.assertEqual(print_style["overflow"], "visible")


if __name__ == "__main__":
    unittest.main()
