// Stand-in for the Google Apps Script webhook used by lib/receipts.ts and
// lib/mirror.ts. Keeps receipts in memory and serves them back at
// /receipt/<id>, so the local app can log expenses without touching Drive.
//
// Started by scripts/local/dev.mjs; can also run standalone:
//   node scripts/local/gas-stub.mjs [port]
import http from "node:http";

const port = Number(process.argv[2] || process.env.GAS_STUB_PORT || 3999);
const files = new Map(); // id -> { mimeType, bytes }
let counter = 0;
let mirrors = 0;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  if (req.method === "GET" && url.pathname.startsWith("/receipt/")) {
    const f = files.get(url.pathname.slice("/receipt/".length));
    if (!f) return json(res, 404, { ok: false, error: "no such receipt" });
    res.writeHead(200, { "content-type": f.mimeType });
    return res.end(f.bytes);
  }
  if (req.method === "GET" && url.pathname === "/status") {
    return json(res, 200, { ok: true, receipts: files.size, mirrors });
  }
  if (req.method !== "POST") return json(res, 405, { ok: false });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(res, 400, { ok: false, error: "bad json" });
    }
    switch (body.action) {
      case "uploadReceipt": {
        const id = `local-${++counter}`;
        files.set(id, {
          mimeType: body.mimeType || "application/octet-stream",
          bytes: Buffer.from(body.dataBase64 || "", "base64"),
        });
        return json(res, 200, {
          ok: true,
          id,
          url: `http://localhost:${port}/receipt/${id}`,
        });
      }
      case "deleteReceipt":
        files.delete(body.id);
        return json(res, 200, { ok: true });
      case "mirror":
        mirrors += 1;
        return json(res, 200, { ok: true });
      default:
        return json(res, 200, { ok: true, ignored: body.action });
    }
  });
});

server.listen(port, () => {
  console.log(`[gas-stub] listening on http://localhost:${port}`);
});
