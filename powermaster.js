const { EventEmitter } = require("events");
const { sentCRC } = require("./crc_check.js");

const STX = 0x02;
const ETX = 0x03;
const CR = 0x0d;

// Build a packet: STX + payload + ETX + CRC (2 hex chars, complemented) + CR
function buildPacket(command) {
  const crc = sentCRC(command).toString(16).toUpperCase().padStart(2, "0");
  return Buffer.concat([
    Buffer.from([STX]),
    Buffer.from(command),
    Buffer.from([ETX]),
    Buffer.from(crc),
    Buffer.from([CR]),
  ]);
}

// Extract the payload from a received line. Framed packets are CRC checked;
// plain text lines (e.g. "A", "N", "Bad CRC") are returned as they are.
function parsePacket(line) {
  const text = line.replace(/[\n\r]/g, "");
  if (text.charCodeAt(0) !== STX) return text;
  const etx = text.indexOf(String.fromCharCode(ETX));
  if (etx < 0) throw new Error("No ETX");
  const payload = text.slice(1, etx);
  const crc = sentCRC(payload).toString(16).toUpperCase().padStart(2, "0");
  if (text.slice(etx + 1, etx + 3).toUpperCase() !== crc) throw new Error("Bad CRC");
  return payload;
}

// "D,fwd,ref,vswr,s1;s2;s3;s4;s5"
function parseRealtime(line) {
  const [, fwd, ref, vswr, status = ""] = line.split(",");
  const [vswrAlarm, lowPowerAlarm, highPowerAlarm, redLed, yellowLed] = status
    .split(";")
    .map((s) => s.trim() === "1");
  return {
    forwardPower: parseInt(fwd, 10),
    reflectedPower: parseInt(ref, 10),
    vswr: parseFloat(vswr),
    vswrAlarm, lowPowerAlarm, highPowerAlarm, redLed, yellowLed,
  };
}

class PowerMaster extends EventEmitter {
  // options.port: an already created stream (used for tests)
  constructor(serialPortPath, baudRate = 38400, options = {}) {
    super();
    this.timeout = options.timeout || 2000;
    this.queue = [];
    this.pending = null;
    this.buffer = "";

    if (options.port) {
      this.serialPort = options.port;
    } else {
      const { SerialPort } = require("serialport");
      this.serialPort = new SerialPort({ path: serialPortPath, baudRate });
    }
    this.serialPort.on("data", this.handleReceivedData.bind(this));
    this.serialPort.on("error", (err) => this.emit("error", err));
  }

  // The meter accepts one command at a time, so they are queued.
  // Resolves with the response string.
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      this.processQueue();
    });
  }

  processQueue() {
    if (this.pending || this.queue.length === 0) return;
    this.pending = this.queue.shift();
    this.pending.timer = setTimeout(() => {
      const { reject, command } = this.pending;
      this.pending = null;
      reject(new Error(`Timeout waiting for response to "${command}"`));
      this.processQueue();
    }, this.timeout);
    this.serialPort.write(buildPacket(this.pending.command));
  }

  handleReceivedData(data) {
    this.buffer += data.toString("latin1");
    const lines = this.buffer.split("\r");
    this.buffer = lines.pop();
    for (const line of lines) {
      if (line.replace(/\n/g, "") !== "") this.handleLine(line);
    }
  }

  handleLine(line) {
    let response;
    try {
      response = parsePacket(line);
    } catch (err) {
      return this.settle(err);
    }
    if (response.startsWith("D,")) {
      this.emit("realtime", parseRealtime(response));
    } else if (this.pending) {
      this.settle(null, response);
    } else {
      this.emit("message", response); // spontaneous change made from the meter menu
    }
  }

  settle(err, response) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const { resolve, reject } = this.pending;
    this.pending = null;
    if (err) reject(err);
    else resolve(response);
    this.processQueue();
  }

  // Dx: 0 = off, 1-4 = 35/70/140/280 ms, 5 = single packet
  setRealtime(x) {
    return this.sendCommand(`D${x}`);
  }
}

module.exports = PowerMaster;
module.exports.buildPacket = buildPacket;
module.exports.parsePacket = parsePacket;
module.exports.parseRealtime = parseRealtime;
