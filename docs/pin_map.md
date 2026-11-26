# Classic ESP32 DevKit pin map

These are the native GPIO numbers from the supplied configuration. Physical wiring has not been verified.

| Function | GPIO | Wiring from the project |
| --- | --- | --- |
| Soil moisture | 32 | Connect the sensor's analog output (AOUT). This ADC1 input can be used while Wi-Fi runs. The sensor in the supplied diagram uses a 3.3 V supply. |
| DHT22 data | 33 | The original diagram specifies a 4.7 kΩ pull-up from DATA to 3.3 V. Check whether the sensor breakout already supplies it. |
| Flow pulses | 25 | Digital input counting falling edges. Match the sensor's output type to a 3.3 V input. A 5 V driven signal needs level conversion. An open-collector output can use a 3.3 V pull-up if the sensor specification permits it. |
| Relay IN | 27 | Controls a relay module or driver. The supplied configuration expects GPIO LOW to energize it. Verify the module's input levels, polarity and behavior during reset. |
| Status LED | 13 | LED output. The circuit must include a suitable series resistor when using a bare external LED. |

The original diagram uses a common logic ground for the ESP32 and its directly connected signals. Follow the actual relay module schematic for isolated or optocoupled inputs. Keep the DC pump on its own rated supply. The drawing uses COM and normally open (NO) for a pump that is off with the relay released, and a flyback diode across the DC pump with its cathode toward pump positive. Disconnect load power before inspecting contacts.

GPIO32 is ADC1 channel 4. GPIO25 and GPIO27 are used digitally. The strapping pins on the classic ESP32 are GPIO0, GPIO2, GPIO5, GPIO12 and GPIO15. This pin map avoids them. The hardware determines the relay level before firmware starts. [Espressif GPIO reference](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html)
