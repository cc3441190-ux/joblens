/**
 * 本地预览官网：在项目根目录执行
 *   node website/serve-preview.cjs
 * 浏览器打开终端里输出的链接（默认 http://127.0.0.1:8765）。
 */
var http = require("http");
var fs = require("fs");
var path = require("path");

var ROOT = path.resolve(__dirname);
var PORT = parseInt(process.env.PORT || "8765", 10);

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safeJoin(root, reqPath) {
  var decoded = decodeURIComponent(reqPath.split("?")[0]);
  var rel = decoded.replace(/^[/]+/, "");
  if (!rel) rel = "index.html";
  var candidate = path.normalize(path.join(root, rel));
  if (!candidate.startsWith(root)) return null;
  return candidate;
}

function createHandler() {
  return function (req, res) {
    var urlPath = req.url === "/" ? "/index.html" : req.url;
    var filePath = safeJoin(ROOT, urlPath);
    if (!filePath) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      var ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  };
}

function listenFrom(port, attemptsLeft) {
  var server = http.createServer(createHandler());
  server.on("error", function (err) {
    if (err.code === "EADDRINUSE" && attemptsLeft > 1) {
      console.warn("[预览] 端口 " + port + " 已被占用，尝试 " + (port + 1) + " …");
      listenFrom(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(err.message || err);
    if (err.code === "EADDRINUSE") {
      console.error("提示：关掉占用端口的进程，或指定端口：$env:PORT='9000'; node website/serve-preview.cjs");
    }
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", function () {
    console.log("joblens 官网预览： http://127.0.0.1:" + port + "/");
    console.log("按 Ctrl+C 结束");
  });
}

listenFrom(PORT, 24);
