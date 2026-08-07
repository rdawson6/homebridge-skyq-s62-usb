# homebridge-skyq-s62-usb

A Homebridge plugin that polls Sky Q boxes for now-playing data and forwards it to a **Systemline S6.2** multi-room audio system via **USB-to-RS232 serial cables** connected directly to a Raspberry Pi.

This is a simpler, cheaper alternative to the [homebridge-skyq-s62-bridge](https://www.npmjs.com/package/homebridge-skyq-s62-bridge) plugin which uses a Global Cache iTach IP2SL network-to-serial adapter. If your Homebridge runs on a Pi with USB ports, a £5 FTDI USB-RS232 cable replaces a £100+ iTach.

[![npm](https://img.shields.io/npm/v/homebridge-skyq-s62-usb)](https://www.npmjs.com/package/homebridge-skyq-s62-usb)

---

## How it works

```
Sky Q box (SOAP/UPnP + Sky EPG API)
        ↓
  Homebridge plugin (Raspberry Pi)
        ↓
  USB-to-RS232 cable (/dev/ttyUSB*)
        ↓
  S6.2 RS232 input
        ↓
  Channel + programme info on touch screen
```

Each Sky Q box is polled every 15 seconds (configurable). When the channel or programme changes, a Sky Gnome protocol packet is written to the serial port containing:

- Channel number and name
- Current time
- Programme start time, title, and synopsis

The S6.2 touch screen displays this information exactly as it did with the original Sky RS232 output.

---

## Hardware required

- **Raspberry Pi** running Homebridge (Pi 4 or later recommended)
- **USB-to-RS232 cable** (FTDI FT232R chipset recommended) — one per Sky Q box
- **RS232 cable** from USB adapter to S6.2 RS232 input
- **Sky Q box** with a static IP address on your local network

---

## Identifying your serial ports

```bash
ls /dev/ttyUSB*
```

To identify which USB device is which:
```bash
udevadm info /dev/ttyUSB1 | grep ID_USB_MODEL
```

---

## Installation

```bash
npm install -g homebridge-skyq-s62-usb
```

Or install via the Homebridge UI plugin search.

**Note:** The `serialport` npm package requires native compilation. On a Raspberry Pi this happens automatically during install but may take a minute.

---

## Configuration

Add to your Homebridge `config.json`:

```json
{
  "platform": "SkyQS62USB",
  "name": "Sky Q S6.2 USB",
  "sky_boxes": [
    {
      "name": "Sky Q",
      "skyq_ip": "192.168.4.227",
      "serial_port": "/dev/ttyUSB2",
      "baud_rate": 57600,
      "poll_interval": 15
    },
    {
      "name": "Sky Q Mini",
      "skyq_ip": "192.168.4.232",
      "serial_port": "/dev/ttyUSB1",
      "baud_rate": 57600,
      "poll_interval": 15
    }
  ]
}
```

### Config options

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `name` | No | `Sky Q S6.2 USB` | Platform name |
| `sky_boxes` | Yes | — | Array of Sky Q box entries |
| `sky_boxes[].name` | Yes | — | Friendly name for logs |
| `sky_boxes[].skyq_ip` | Yes | — | IP address of the Sky Q box |
| `sky_boxes[].serial_port` | Yes | — | USB serial device path (e.g. `/dev/ttyUSB1`) |
| `sky_boxes[].baud_rate` | No | `57600` | Baud rate — must be 57600 for S6.2 |
| `sky_boxes[].poll_interval` | No | `15` | Poll interval in seconds (5–60) |

---

## Troubleshooting

**Serial port permission denied**
```bash
sudo usermod -a -G dialout $USER
```
Then log out and back in. The Homebridge user needs to be in the `dialout` group.

**Port not found**
- Check the cable is plugged in: `ls /dev/ttyUSB*`
- USB port assignment can change on reboot. Use `udevadm info` to identify by serial number.

**S6.2 not showing channel info**
- Check baud rate is 57600
- Check TX/RX wiring (pin 2/3 on DB9 — may need a null modem crossover)
- Check Homebridge logs for `Now:` lines confirming packets are being sent

**Sky Q queries failing**
- Confirm the Sky Q IP is reachable from the Pi
- Both boxes must be on the same local network

---

## Credits

**Sky Gnome RS232 protocol** — documented by Joseph Heenan at https://www.heenan.me.uk/control-sky-from-pc/gnome-protocol.html

**Sky Q UPnP API** — reverse engineered by Liam Gladdy at https://gladdy.uk/blog/2017/03/13/skyq-upnp-rest-and-websocket-api-interfaces/

**Built with Kiro AI** — https://kiro.dev

---

## License

MIT
