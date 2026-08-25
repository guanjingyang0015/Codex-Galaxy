import fs from "node:fs/promises";
import http from "node:http";

const port = Number(process.argv[2]);
const resultFile = process.argv[3];
if (!Number.isInteger(port) || !resultFile) throw new Error("Expected a port and result file.");

const seen = [];
const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "gpt-5.6" }, { id: "gpt-5.6-sol" }, { id: "gpt-5.6-terra" }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  seen.push({ model: body.model, reasoning: body.reasoning });
  await fs.writeFile(resultFile, JSON.stringify({ seen }));
  if (body.model === "gpt-5.6") {
    response.writeHead(403, { "content-type": "application/json" });
    response.end('{"error":{"message":"token has no access to model gpt-5.6"}}');
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, model: body.model, reasoning: body.reasoning }));
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`mock-ready:${port}\n`));
