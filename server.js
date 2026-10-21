// Web interface for the PowerMaster. Usage:
//   node server.js /dev/ttyUSB0 [baud] [httpPort]
//   node server.js --demo [httpPort]      (simulated meter, no hardware)
const http = require("http");
const fs = require("fs");
const path = require("path");
const PowerMaster = require("./powermaster.js");

const args = process.argv.slice(2);
const demo = args[0] === "--demo";
const [serialPath, baud, port] = demo ? [null, null, args[1]] : args;
if (!demo && !serialPath) {
  console.error("Usage: node server.js <serial port> [baud] [httpPort]\n       node server.js --demo [httpPort]");
  process.exit(1);
}
const httpPort = Number(port) || 3000;

const pm = new PowerMaster(
  serialPath,
  Number(baud) || 38400,
  demo ? { port: new (require("./demo.js"))() } : {}
);
pm.on("error", (err) => console.error("Serial error:", err.message));

// Never allow flash/bootloader/factory commands from the browser.
const BLOCKED = /^[epPrxN]$/;

const clients = new Set();
pm.on("realtime", (d) => {
  const msg = `data: ${JSON.stringify(d)}\n\n`;
  for (const res of clients) res.write(msg);
});
pm.on("message", (m) => {
  const msg = `event: meter\ndata: ${JSON.stringify(m)}\n\n`;
  for (const res of clients) res.write(msg);
});

function updateRealtime() {
  pm.setRealtime(clients.size > 0 ? 3 : 0).catch((e) => console.error(e.message));
}

const index = path.join(__dirname, "web", "index.html");

const server = http.createServer((req, res) => {
  req.url = new URL(req.url, "http://localhost").pathname; // ignore the query string (e.g. /?lang=en)
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(index).pipe(res);
  }
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write("\n");
    clients.add(res);
    if (clients.size === 1) updateRealtime();
    req.on("close", () => {
      clients.delete(res);
      if (clients.size === 0) updateRealtime();
    });
    return;
  }
  if (req.method === "POST" && req.url === "/api/command") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      res.setHeader("Content-Type", "application/json");
      try {
        const command = String(JSON.parse(body).command || "").trim();
        if (!command) throw new Error("Empty command");
        if (BLOCKED.test(command)) throw new Error(`Command "${command}" is blocked`);
        const response = await pm.sendCommand(command);
        res.end(JSON.stringify({ response }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }
  res.writeHead(404).end("Not found");
});

// Localhost only: the meter has no authentication.
server.listen(httpPort, "127.0.0.1", () =>
  console.log(`PowerMaster web interface: http://127.0.0.1:${httpPort}${demo ? " (demo mode)" : ""}`)
);
