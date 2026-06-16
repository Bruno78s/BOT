const http = require("http");
const fs = require("fs");
const path = require("path");

const session = "payment-webhook-confirmation";
const outdir = path.join(process.cwd(), ".dbg");
const logFile = path.join(outdir, `trae-debug-log-${session}.ndjson`);
const envFile = path.join(outdir, `${session}.env`);
const port = 7777;

fs.mkdirSync(outdir, { recursive: true });
fs.writeFileSync(logFile, "");
fs.writeFileSync(
  envFile,
  `DEBUG_SERVER_URL=http://127.0.0.1:${port}/event\nDEBUG_SESSION_ID=${session}\n`
);

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, session, port }));
  }

  if (req.method === "DELETE" && req.url.startsWith("/logs")) {
    fs.writeFileSync(logFile, "");
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, cleared: true }));
  }

  if (req.method === "POST" && req.url.startsWith("/event")) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const event = JSON.parse(body || "{}");
        if (!event.ts) event.ts = Date.now();
        fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: error.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not_found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Debug server on http://127.0.0.1:${port} session=${session}`);
});
