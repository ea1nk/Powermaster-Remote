const { EventEmitter } = require("events");
const { parsePacket } = require("./powermaster.js");

const RATES = { 1: 35, 2: 70, 3: 140, 4: 280 };

// Fake serial port that behaves like a meter, to try the web UI without hardware.
// Vectors and menu settings as documented in "Packet Payload definitions" (v3 firmware).
const VECTORS = {
  "B?": "B50,250,1250,100,500,2500,200,1000,3000,400,2000,3000",
  "H?": "0,175,225,700,1100,1600,2600,3000",
  "L?": "0,5,50,100,250,500,1000,2000",
  "W?": "W0,1.5,2.0,2.5,3.0",
  "U?": "U-10,15",
  "R?": "R1",
};
const SETTINGS = { V: "2", l: "0", h: "5,1", a: "1", P: "1", S: "1", T: "0", t: "0", I: "2", d: "1", b: "1", M: "1" };

// Fake serial port that behaves like a meter, to try the web UI without hardware.
class DemoMeter extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.t = 0;
    this.call = "EA1NK";
    this.settings = { ...SETTINGS };
    this.resetAlarms();
  }

  write(buf) {
    let cmd;
    try {
      cmd = parsePacket(buf.toString("latin1"));
    } catch (err) {
      return this.reply(err.message);
    }
    if (cmd === "A") {
      this.resetAlarms();
      return this.reply("A");
    }
    if (cmd === "v?") return this.reply("PowerMaster DEMO v3.0");
    if (cmd === "C?") return this.reply(this.call);
    if (cmd.startsWith("C ")) {
      this.call = cmd.slice(2).slice(0, 16);
      return this.reply("A");
    }
    if (VECTORS[cmd]) return this.reply(VECTORS[cmd]);
    if (/^D[0-5]$/.test(cmd)) {
      this.setRealtime(Number(cmd[1]));
      return this.reply("A");
    }
    const m = /^([A-Za-z])(\??)(.*)$/.exec(cmd);
    if (m && m[1] in this.settings) {
      if (m[2]) return this.reply(m[1] + this.settings[m[1]]);
      this.settings[m[1]] = m[3];
      return this.reply("A");
    }
    this.reply("N");
  }

  reply(text) {
    setTimeout(() => this.emit("data", Buffer.from(text + "\r")), 5);
  }

  setRealtime(x) {
    clearInterval(this.timer);
    this.timer = null;
    if (x === 5) setTimeout(() => this.sendSample(), 50);
    else if (x > 0) this.timer = setInterval(() => this.sendSample(), RATES[x]);
  }

  // Alarm thresholds follow the menu settings, like the real meter.
  thresholds() {
    const num = (v) => Number(String(v).split(",")[0]);
    return {
      vswr: [0, 1.5, 2.0, 2.5, 3.0][num(this.settings.V)] || 0,
      low: [0, 5, 50, 100, 250, 500, 1000, 2000][num(this.settings.l)] || 0,
      high: [0, 175, 225, 700, 1100, 1600, 2600, 3000][num(this.settings.h)] || 0,
      resetMs: [0, 5000, 10000, 20000][num(this.settings.a)] || 0, // PowerMaster I: Off/5/10/20 s
    };
  }

  resetAlarms() {
    this.alarms = { vswr: 0, low: 0, high: 0, lowSince: 0 };
  }

  // Powers are sent in 0.5 W units (assumed), like the real meter appears to do.
  // Every 60 s the demo has a mismatch (high VSWR) and, a bit later, a power surge,
  // so the alarms can be seen. Alarms are latched until ALARM RESET or the auto reset time.
  sendSample() {
    this.t += 1;
    const now = Date.now(), cycle = (now / 1000) % 60;
    const mismatch = cycle >= 20 && cycle < 27, surge = cycle >= 45 && cycle < 49;
    let watts = Math.max(0, 700 + 650 * Math.sin(this.t / 40) + Math.random() * 20);
    if (surge) watts = 1800 + Math.random() * 40;
    const idle = !surge && Math.sin(this.t / 40) < -0.95;
    const fwd = idle ? 0 : Math.round(watts * 2);
    const refRatio = mismatch ? 0.2 : 0.04 + 0.03 * Math.sin(this.t / 50) ** 2;
    const ref = Math.round(fwd * refRatio);
    const rho = fwd ? Math.sqrt(ref / fwd) : 0;
    const vswr = fwd ? Math.min(99.99, (1 + rho) / (1 - rho)) : 0;

    const th = this.thresholds(), al = this.alarms;
    if (th.vswr && fwd / 2 >= 10 && vswr > th.vswr && !al.vswr) al.vswr = now;
    if (th.high && fwd / 2 > th.high && !al.high) al.high = now;
    if (th.low && fwd / 2 < th.low) { al.lowSince = al.lowSince || now; if (now - al.lowSince > 3000 && !al.low) al.low = now; }
    else al.lowSince = 0;
    if (th.resetMs) for (const k of ["vswr", "low", "high"]) if (al[k] && now - al[k] > th.resetMs) al[k] = 0;
    if (!th.vswr) al.vswr = 0;
    if (!th.low) al.low = 0;
    if (!th.high) al.high = 0;

    const flash = this.t % 4 < 2; // high power alarm LED flashes
    const red = al.vswr ? 1 : 0, yellow = al.low || (al.high && flash) ? 1 : 0;
    this.emit("data", Buffer.from(`D,${fwd},${ref},${vswr.toFixed(2)},${red};${al.low ? 1 : 0};${al.high ? 1 : 0};${red};${yellow}\r`));
  }
}

module.exports = DemoMeter;
