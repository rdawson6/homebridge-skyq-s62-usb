# Changelog

## [1.1.0] - 2026-08-13

### Fixed
- **Serial port now reconnects automatically.** Previously, if the USB serial adapter dropped off the bus (cable unplugged, power glitch, hub hiccup) the plugin silently stopped writing to the S6.2 until Homebridge was restarted. It now detects the loss and retries every 10 seconds until the device returns.
- Plugin no longer fails permanently if the serial port is unavailable at startup — it retries instead
- Write errors now trigger reconnection rather than being logged and ignored

### Changed
- Each Sky Q box now owns and manages its own serial port independently, so one cable dropping out no longer affects the other
- After a reconnect, change-detection state is cleared so the current channel and programme are resent immediately — the S6.2 would otherwise keep displaying whatever was on screen when the cable dropped

## [1.0.1] - 2026-08-10

### Added
- README: "Stable device paths" section explaining udev rules for consistent USB serial assignment across reboots
- README: Troubleshooting section updated with "wrong device opened after reboot" guidance

## [1.0.0] - 2026-08-07

### Initial release
- Sky Q now-playing data forwarded to S6.2 via USB-to-RS232 serial cables
- Each Sky Q box gets its own serial port — no shared connections
- SOAP/UPnP for current channel SID (supports both main box and Mini)
- Full EPG data from awk.epgsky.com (programme title, synopsis, start time)
- Sky Gnome RS232 packet builder (byte-perfect, verified against spec)
- Only sends packets on change — quiet logs, no unnecessary serial writes
- Auto-discovery of SkyPlay control path on both GatewaySkyControl and MRSkyControl devices
- Channel map cached at startup (300+ channels)
- Configurable poll interval (default 15s)
- Built with Kiro AI
