var http  = require("http");
var https = require("https");

var PLUGIN_NAME   = "homebridge-skyq-s62-usb";
var PLATFORM_NAME = "SkyQS62USB";

/* =============================================================================
   Sky Q S6.2 USB Bridge

   Polls Sky Q boxes for now-playing data (channel, programme, synopsis) and
   writes Sky Gnome RS232 protocol packets to USB serial ports connected to
   the Systemline S6.2 multi-room audio system.

   Each sky_box entry has its own USB-to-RS232 cable and Sky Q IP.
   No HomeKit accessories are created — this is a background bridge service.
   ============================================================================= */
module.exports = function(homebridge) {
  homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SkyQS62USBPlatform);
};

function SkyQS62USBPlatform(log, config) {
  this.log       = log;
  this.sky_boxes = config.sky_boxes || [];
  this._bridges  = [];
}

SkyQS62USBPlatform.prototype.accessories = function(callback) {
  var self = this;

  if (self.sky_boxes.length === 0) {
    self.log("WARNING: No sky_boxes configured.");
    callback([]);
    return;
  }

  var SerialPort;
  try {
    SerialPort = require("serialport").SerialPort;
  } catch(e) {
    self.log("ERROR: serialport module not available: " + e.message);
    self.log("Install with: npm install serialport");
    callback([]);
    return;
  }

  var started = 0;
  for (var i = 0; i < self.sky_boxes.length; i++) {
    (function(boxConfig) {
      var portPath = boxConfig.serial_port || "/dev/ttyUSB1";
      var baudRate = parseInt(boxConfig.baud_rate) || 57600;

      var port = new SerialPort({
        path:     portPath,
        baudRate: baudRate,
        dataBits: 8,
        parity:   "none",
        stopBits: 1,
        autoOpen: false
      });

      port.open(function(err) {
        if (err) {
          self.log("[" + boxConfig.name + "] ERROR: Failed to open " + portPath + ": " + err.message);
        } else {
          self.log("[" + boxConfig.name + "] Serial " + portPath + " open at " + baudRate + " baud");
          var bridge = new SkyQUSBBridge(boxConfig, self.log, port);
          self._bridges.push(bridge);
          bridge.start();
        }
        started++;
        if (started === self.sky_boxes.length) callback([]);
      });
    })(self.sky_boxes[i]);
  }
};

/* =============================================================================
   Sky Gnome RS232 Packet Builder
   Protocol: https://www.heenan.me.uk/control-sky-from-pc/gnome-protocol.html
   ============================================================================= */
var GnomePacket = {
  _subpacket: function(type, data) {
    var d = String(data || "");
    return type + String(7 + d.length).padStart(3, "0") + d;
  },
  _checksum: function(str) {
    var sum = 0;
    for (var i = 0; i < str.length; i++) sum += str.charCodeAt(i);
    return (sum & 0xff).toString(16).padStart(2, "0");
  },
  build: function(subpackets) {
    var body = "";
    for (var i = 0; i < subpackets.length; i++) body += this._subpacket(subpackets[i].type, subpackets[i].data);
    var totalLen = String(3 + body.length + 2).padStart(3, "0");
    var p = "\x0a" + totalLen + body;
    return p + this._checksum(p);
  },
  nowPlaying: function(channelNumber, channelName, currentTime, startTime, programmeName, programmeDescription) {
    return this.build([
      { type: "SSCN", data: channelNumber },
      { type: "SSCA", data: channelName },
      { type: "SSDT", data: currentTime },
      { type: "SST0", data: startTime },
      { type: "SSN0", data: programmeName },
      { type: "SSE0", data: programmeDescription }
    ]);
  },
  powerState: function(standby) {
    return this.build([{ type: "SYST", data: standby ? "1" : "0" }]);
  }
};

/* =============================================================================
   Sky Q API Client
   - SOAP/UPnP (port 49153): GetMediaInfo → current channel SID
   - REST (port 9006): channel list (SID → name/number)
   - Sky EPG (awk.epgsky.com): programme title, synopsis, start time
   ============================================================================= */
var SkyQClient = {
  _soap: function(ip, controlPath, action, callback) {
    var body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:' + action + ' xmlns:u="urn:schemas-nds-com:service:SkyPlay:2"><InstanceID>0</InstanceID></u:' + action + '></s:Body></s:Envelope>';
    var options = {
      host: ip, port: 49153, path: "/" + controlPath, method: "POST",
      headers: { "Content-Type": "text/xml", "SOAPACTION": '"urn:schemas-nds-com:service:SkyPlay:2#' + action + '"', "User-Agent": "SKYPLUS_skyplus", "Content-Length": Buffer.byteLength(body) }
    };
    var req = http.request(options, function(res) { var d = ""; res.on("data", function(c) { d += c; }); res.on("end", function() { callback(null, d); }); });
    req.setTimeout(5000, function() { req.destroy(); callback(new Error("SOAP timeout")); });
    req.on("error", function(err) { callback(err); }); req.write(body); req.end();
  },

  _getJSON: function(ip, path, callback) {
    var req = http.request({ host: ip, port: 9006, path: "/as/" + path, method: "GET", headers: { "User-Agent": "SKYPLUS_skyplus" } }, function(res) {
      var b = ""; res.on("data", function(c) { b += c; }); res.on("end", function() { try { callback(null, JSON.parse(b)); } catch(e) { callback(e); } });
    });
    req.setTimeout(5000, function() { req.destroy(); callback(new Error("Timeout")); });
    req.on("error", function(err) { callback(err); }); req.end();
  },

  getCurrentSID: function(ip, controlPath, callback) {
    this._soap(ip, controlPath, "GetMediaInfo", function(err, xml) {
      if (err) return callback(err);
      var m = xml.match(/<CurrentURI>(.*?)<\/CurrentURI>/);
      if (!m) return callback(null, { sid: null, standby: true });
      var uri = m[1];
      if (!uri || uri === "") return callback(null, { sid: null, standby: true });
      var hm = uri.match(/xsi:\/\/([0-9a-fA-F]+)/);
      if (hm) return callback(null, { sid: parseInt(hm[1], 16), standby: false });
      if (uri.startsWith("pvr://")) return callback(null, { sid: null, standby: false, pvr: true });
      callback(null, { sid: null, standby: false });
    });
  },

  getChannelMap: function(ip, callback) {
    this._getJSON(ip, "services/4/1", function(err, data) {
      if (err) return callback(err);
      var map = {};
      var svcs = (data && data.services) || [];
      for (var i = 0; i < svcs.length; i++) {
        var s = svcs[i];
        if (s.sid) map[String(s.sid)] = { channelNumber: String(s.c || ""), channelName: String(s.t || "") };
      }
      callback(null, map);
    });
  },

  getCurrentProgramme: function(sid, callback) {
    var now = Math.floor(Date.now() / 1000);
    var d = new Date();
    var dateStr = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
    var req = https.request({ hostname: "awk.epgsky.com", path: "/hawk/linear/schedule/" + dateStr + "/" + sid, method: "GET" }, function(res) {
      var body = ""; res.on("data", function(c) { body += c; }); res.on("end", function() {
        try {
          var data = JSON.parse(body);
          var schedule = data.schedule && data.schedule[0];
          var events = (schedule && schedule.events) || [];
          for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (e.st <= now && now < e.st + e.d) {
              return callback(null, { title: String(e.t || ""), synopsis: String(e.sy || ""), startTime: _formatTime(new Date(e.st * 1000)) });
            }
          }
          callback(null, null);
        } catch(e) { callback(e); }
      });
    });
    req.setTimeout(5000, function() { req.destroy(); callback(new Error("EPG timeout")); });
    req.on("error", function(err) { callback(err); }); req.end();
  },

  discoverControlPath: function(ip, callback) {
    var indices = [0, 1, 2, 3, 16, 17, 18, 19];
    var i = 0;
    function tryNext() {
      if (i >= indices.length) return callback(new Error("SkyPlay control path not found"));
      var idx = indices[i++];
      var req = http.request({ host: ip, port: 49153, path: "/description" + idx + ".xml", method: "GET", headers: { "User-Agent": "SKYPLUS_skyplus" } }, function(res) {
        var data = ""; res.on("data", function(c) { data += c; }); res.on("end", function() {
          if (data.includes("SkyPlay:2") && (data.includes("GatewaySkyControl") || data.includes("MRSkyControl"))) {
            var m = data.match(/<controlURL>\/([^<]+SkyPlay[^<]*)<\/controlURL>/);
            if (m) return callback(null, m[1]);
          }
          tryNext();
        });
      });
      req.setTimeout(3000, function() { req.destroy(); tryNext(); });
      req.on("error", function() { tryNext(); }); req.end();
    }
    tryNext();
  }
};

function _formatTime(d) {
  var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? "pm" : "am";
  var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (h % 12 || 12) + "." + String(m).padStart(2, "0") + ap + " " + days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()];
}

/* =============================================================================
   Bridge — one per Sky Q box, each with its own USB serial port
   ============================================================================= */
function SkyQUSBBridge(config, log, port) {
  this.name          = config.name || "Sky Q";
  this.skyq_ip       = config.skyq_ip;
  this.poll_interval = (config.poll_interval || 15) * 1000;
  this.log           = log;
  this._port         = port;
  this._controlPath  = null;
  this._channelMap   = null;
  this._lastStandby  = null;
  this._lastSID      = null;
  this._lastProg     = null;
  this._pollTimer    = null;
}

SkyQUSBBridge.prototype.start = function() {
  var self = this;
  self.log("[" + self.name + "] Starting — Sky Q: " + self.skyq_ip);

  SkyQClient.discoverControlPath(self.skyq_ip, function(err, controlPath) {
    if (err) {
      self.log("[" + self.name + "] Discovery failed: " + err.message + " — retry in 30s");
      setTimeout(function() { self.start(); }, 30000);
      return;
    }
    self._controlPath = controlPath;
    self.log("[" + self.name + "] SkyPlay path: " + controlPath);

    SkyQClient.getChannelMap(self.skyq_ip, function(err, map) {
      self._channelMap = err ? {} : map;
      self.log("[" + self.name + "] Channel map: " + Object.keys(self._channelMap).length + " channels");
      self._schedulePoll(0);
    });
  });
};

SkyQUSBBridge.prototype._schedulePoll = function(delay) {
  var self = this;
  if (self._pollTimer) clearTimeout(self._pollTimer);
  self._pollTimer = setTimeout(function() { self._pollTimer = null; self._poll(); }, delay !== undefined ? delay : self.poll_interval);
};

SkyQUSBBridge.prototype._poll = function() {
  var self = this;

  SkyQClient.getCurrentSID(self.skyq_ip, self._controlPath, function(err, result) {
    if (err) {
      self.log("[" + self.name + "] SOAP failed: " + err.message);
      self._schedulePoll();
      return;
    }

    // Power state change
    if (self._lastStandby !== result.standby) {
      self._lastStandby = result.standby;
      self.log("[" + self.name + "] Power: " + (result.standby ? "STANDBY" : "ON"));
      self._send(GnomePacket.powerState(result.standby));
    }

    if (result.standby || result.pvr || !result.sid) {
      self._schedulePoll();
      return;
    }

    var sid = result.sid;
    var ch = (self._channelMap && self._channelMap[String(sid)]) || {};
    var channelNumber = ch.channelNumber || String(sid);
    var channelName   = ch.channelName   || "Unknown";

    SkyQClient.getCurrentProgramme(sid, function(err, prog) {
      var title    = (prog && prog.title) || "";
      var synopsis = (prog && prog.synopsis) || "";
      var startTime = (prog && prog.startTime) || "";

      var changeKey = sid + "|" + title;
      if (changeKey === self._lastSID + "|" + self._lastProg) {
        self._schedulePoll();
        return;
      }

      self._lastSID  = sid;
      self._lastProg = title;
      self.log("[" + self.name + "] Now: CH" + channelNumber + " " + channelName + (title ? " — " + title : ""));

      self._send(GnomePacket.nowPlaying(channelNumber, channelName, _formatTime(new Date()), startTime, title, synopsis));
      self._schedulePoll();
    });
  });
};

SkyQUSBBridge.prototype._send = function(packet) {
  if (!this._port || !this._port.isOpen) {
    this.log("[" + this.name + "] Serial port not open — packet dropped");
    return;
  }
  this._port.write(packet, function(err) {
    if (err) this.log("[" + this.name + "] Write error: " + err.message);
  }.bind(this));
};
