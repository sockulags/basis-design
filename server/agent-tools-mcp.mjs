#!/usr/bin/env node
/*
 * Basis' MCP server for the design agent, which the agent starts over stdio in every session (see
 * server/agent-tools.ts). It speaks MCP's JSON-RPC, one message per line, and forwards tool listings and calls to
 * Basis over HTTP on 127.0.0.1 (BASIS_TOOLS_URL) with the secret Basis made at start (BASIS_TOOLS_SECRET). It has no
 * dependencies, so Node runs it as it is from any install.
 */
import readline from "node:readline";

const url = process.env.BASIS_TOOLS_URL;
const secret = process.env.BASIS_TOOLS_SECRET;
/** The MCP versions this server can speak; it only offers tools, which all of them have in the same shape. */
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function basis(route, body) {
  const response = await fetch(`${url}/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Basis answered ${response.status}.`);
  return response.json();
}

async function answer(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "basis", version: "1.0.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: (await basis("list")).tools };
    case "tools/call":
      try {
        return await basis("call", { name: params?.name, arguments: params?.arguments ?? {} });
      } catch (error) {
        // Basis is gone or restarting: the agent should hear that, not see the call fail without a reason.
        return { content: [{ type: "text", text: `Could not reach Basis: ${error.message}` }], isError: true };
      }
    default:
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  // Notifications (initialized, cancelled) need no answer.
  if (message.id === undefined || message.id === null) return;
  try {
    send({ id: message.id, result: await answer(message.method, message.params) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
  }
});
// When the agent closes stdin, nothing is left to wait for and Node exits by itself (process.exit() here trips a
// libuv assertion on Windows).
