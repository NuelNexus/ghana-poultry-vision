// HTTPS in front of the app on this Pi, so phones and laptops on the network can
// use the microphone (browsers only allow it on HTTPS or localhost).
//
//   https://<pi>:8443  ->  http://127.0.0.1:8080 (the web app; the Pi agent keeps using that)
//   https://<pi>:8443/poultrygrid-ca.crt  ->  the certificate authority to install on phones
//
// Certificates come from scripts/make-cert.sh. Env: HTTPS_PORT (8443), APP_PORT (8080), PG_CERT_DIR.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";

const dir = process.env.PG_CERT_DIR || path.join(import.meta.dirname, "..", ".certs");
const port = Number(process.env.HTTPS_PORT || 8443);
const app = { host: "127.0.0.1", port: Number(process.env.APP_PORT || 8080) };

const server = https.createServer(
  {
    key: fs.readFileSync(path.join(dir, "server.key")),
    cert: fs.readFileSync(path.join(dir, "server.crt")),
  },
  (req, res) => {
    if (req.url === "/poultrygrid-ca.crt") {
      res.writeHead(200, {
        "content-type": "application/x-x509-ca-cert",
        "content-disposition": 'attachment; filename="poultrygrid-ca.crt"',
      });
      fs.createReadStream(path.join(dir, "ca.crt")).pipe(res);
      return;
    }
    const upstream = http.request(
      {
        ...app,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-proto": "https", "x-forwarded-host": req.headers.host ?? "" },
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`The app isn't answering on port ${app.port} (${e.message}). Is poultrygrid-web running?`);
    });
    req.pipe(upstream);
  },
);

// WebSockets (Vite's live reload) go straight through.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(app.port, app.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(port, "0.0.0.0", () => console.log(`HTTPS on port ${port} -> app on ${app.port}`));
