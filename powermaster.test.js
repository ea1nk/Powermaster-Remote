const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("events");
const PowerMaster = require("./powermaster.js");
const { calculateCRC, sentCRC } = require("./crc_check.js");

class FakePort extends EventEmitter {
  constructor() { super(); this.written = []; }
  write(b) { this.written.push(b); }
}

test("CRC of empty payload is 0, sent complemented as FF", () => {
  assert.strictEqual(calculateCRC(""), 0);
  assert.strictEqual(sentCRC(""), 0xff);
});

test("packet framing and roundtrip", () => {
  const p = PowerMaster.buildPacket("A?");
  assert.strictEqual(p[0], 0x02);
  assert.strictEqual(p[3], 0x03);
  assert.strictEqual(p[p.length - 1], 0x0d);
  assert.strictEqual(PowerMaster.parsePacket(p.toString("latin1")), "A?");
});

test("bad CRC is rejected", () => {
  assert.throws(() => PowerMaster.parsePacket("\x02A\x0300"), /Bad CRC/);
});

test("sendCommand resolves with response, split across chunks", async () => {
  const port = new FakePort();
  const pm = new PowerMaster(null, 38400, { port });
  const p = pm.sendCommand("S?");
  assert.deepStrictEqual(port.written[0], PowerMaster.buildPacket("S?"));
  port.emit("data", Buffer.from("S"));
  port.emit("data", Buffer.from("1\r"));
  assert.strictEqual(await p, "S1");
});

test("commands are queued one at a time", async () => {
  const port = new FakePort();
  const pm = new PowerMaster(null, 38400, { port });
  const a = pm.sendCommand("A");
  const b = pm.sendCommand("v?");
  assert.strictEqual(port.written.length, 1);
  port.emit("data", Buffer.from("A\r"));
  await a;
  assert.strictEqual(port.written.length, 2);
  port.emit("data", Buffer.from("v1.0\r"));
  assert.strictEqual(await b, "v1.0");
});

test("realtime packets are parsed and emitted", () => {
  const port = new FakePort();
  const pm = new PowerMaster(null, 38400, { port });
  let got;
  pm.on("realtime", (d) => (got = d));
  port.emit("data", Buffer.from("D,1000,50,1.50,0;0;0;0;1\r"));
  assert.deepStrictEqual(got, {
    forwardPower: 1000, reflectedPower: 50, vswr: 1.5,
    vswrAlarm: false, lowPowerAlarm: false, highPowerAlarm: false,
    redLed: false, yellowLed: true,
  });
});

test("timeout rejects", async () => {
  const pm = new PowerMaster(null, 38400, { port: new FakePort(), timeout: 20 });
  await assert.rejects(pm.sendCommand("A"), /Timeout/);
});
