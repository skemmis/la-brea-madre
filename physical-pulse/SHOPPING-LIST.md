# Parking Pulse — what's left to buy

You already have: the 12V WS2811 pixel string, the Raspberry Pi, the official Pi USB-C supply.

## Cart 1 — Amazon (everything you need, one order)

| # | Part | Pick | Why |
|---|------|------|-----|
| 1 | 12V 5A power supply **for the LEDs** (not the Pi) | [Mean Well GST60A12-P1J](https://www.amazon.com/dp/B07KFPBGSM) | The official Pi supply only outputs 5V and only powers the Pi; the LED string needs its own 12V supply. |
| 2 | Female barrel → screw-terminal adapter (5.5×2.1mm) | [LitaElek 5 female + 5 male](https://www.amazon.com/dp/B019HAC6V4) | Turns the supply's plug into +12V / GND screw terminals. Also serves as the ground junction (see note). |
| 3 | JST-SM 3-pin pigtails | [BTF-LIGHTING 20 pairs](https://www.amazon.com/dp/B01DC0KIT2) | Mates with the string's input; breaks out +12V / DATA / GND. |
| 4 | Level shifter | [SN74AHCT125N, 10-pack](https://www.amazon.com/dp/B08R6BCSYC) | 3.3V → 5V data. Must say **AHCT** (not AHC or HC). |
| 5 | Jumper wires | [ELEGOO 120-pc (M/M, M/F, F/F)](https://www.amazon.com/dp/B01EV70C78) | Pi pins → breadboard, and the breadboard links. |
| 6 | Half-size breadboard | search Amazon: `400 tie point breadboard`, `half size solderless breadboard`, or `mini breadboard 400 points` | Holds the level-shifter chip. Any brand; multipacks are fine. About 3.3 × 2.2 in. |
| 7 | microSD card, 16–32GB | search Amazon: `SanDisk Ultra 32GB microSDHC` | Pi OS. Skip if you have one. |
| 8 | *(optional)* Multimeter | search Amazon: `AstroAI digital multimeter` | Turns "why isn't it working" into a 10-second check. |

Amazon blocks automated stock checks, so these listings couldn't be verified live —
if one is unavailable, the search phrase in its row finds an equivalent.

**No Wago connectors needed.** The barrel adapter's two screw terminals are the junction:
- `+` terminal: the string's +12V wire.
- `−` terminal: the string's GND wire **and** a jumper running to a Pi GND pin (common ground).

## Cart 2 — Adafruit (backup, verified in stock Nov 8 2026)

Only if any Amazon item falls through:
[3-pin JST SM cable set #1663](https://www.adafruit.com/product/1663) ($1.50) ·
[half-size breadboard #64](https://www.adafruit.com/product/64) ($4.95) ·
[F/M jumper wires #1954](https://www.adafruit.com/product/1954) ($1.95) ·
[pocket multimeter #850](https://www.adafruit.com/product/850) ($24.95).
(Adafruit's 12V supply, barrel adapter, 74AHCT125 and microSD were out of stock.)
