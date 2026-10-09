// Server statico minimale per l'anteprima locale
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg" };

// Unico percorso scrivibile: la depth map prodotta da depth-version/tools/depth-tool.html
const depthFile = path.join(root, "depth-version", "images", "depth.png");

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);

  if (req.method === "POST" && rel === "/__save-depth") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      fs.writeFile(depthFile, Buffer.concat(chunks), (err) => {
        res.writeHead(err ? 500 : 200);
        res.end(err ? String(err) : "saved");
      });
    });
    return;
  }

  let file = path.join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (rel.endsWith("/")) file = path.join(file, "index.html");
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(5173, "127.0.0.1", () => console.log("http://localhost:5173"));
