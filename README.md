# Powermaster NodeJS class
2023 SCQ Devices - EA1NK

### Description:

Simple javascript class to remote control the Array Solution PowerMaster VSWR Meter from a NodeJS app.

### Usage:
```
npm install
```
```
const PowerMaster = require("./powermaster.js")
const pm = new PowerMaster("/dev/ttyUSB0", 38400); // 38400 is the meter default

pm.sendCommand("v?").then(console.log);   // version string
pm.on("realtime", (d) => console.log(d)); // {forwardPower, reflectedPower, vswr, ...}
pm.setRealtime(3);                        // D3: real time data every 140 ms
```
Commands are wrapped as STX + payload + ETX + CRC + CR automatically and sent one at a time.
Tests (no hardware needed): `npm test`
