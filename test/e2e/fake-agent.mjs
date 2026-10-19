// A stand-in ACP agent for the end-to-end tests, started through BASIS_AGENT_SCRIPT. It changes a token through the
// client's own file methods, so history, checks and reviews run for real. What it does depends on a marker in the
// prompt: E2E-REVIEW also opens a review of the Buttons specimen, E2E-VIEW writes a new view in two steps, the
// first importing a file the second writes, E2E-SLOW takes four seconds first (for turns in two projects at once),
// and E2E-ASK first asks for permission to run a command. Every turn moves motion.duration.fast by 10ms.
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const sessions = new Map();

const LATER_VIEW = `import { defineSpecimen } from "../components/specimen.ts";
import { GREETING } from "./later-data.ts";

export default defineSpecimen({
  title: "Later view",
  blocks: [{ kind: "flow", screens: [{ id: "hello", label: "Hello", render: () => <p>{GREETING}</p> }] }],
});
`;

async function turn(params, client) {
  const cwd = sessions.get(params.sessionId);
  if (!cwd) throw new Error(`Unknown session ${params.sessionId}`);
  const text = params.prompt.map((block) => (block.type === "text" ? block.text : "")).join("\n");
  if (text.includes("E2E-SLOW")) await new Promise((resolve) => setTimeout(resolve, 4000));
  if (text.includes("E2E-ASK")) {
    await client.request(acp.methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: "ask-1", title: "Run the E2E command", kind: "execute" },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    });
  }
  const file = path.join(cwd, "design-system.json");
  const { content } = await client.request(acp.methods.client.fs.readTextFile, {
    sessionId: params.sessionId,
    path: file,
  });
  const design = JSON.parse(content);
  const fast = Number.parseInt(design.motion.duration.fast, 10) || 120;
  design.motion.duration.fast = `${fast + 10}ms`;
  await client.request(acp.methods.client.fs.writeTextFile, {
    sessionId: params.sessionId,
    path: file,
    content: `${JSON.stringify(design, null, 2)}\n`,
  });
  if (text.includes("E2E-VIEW")) {
    const write = (name, content) =>
      client.request(acp.methods.client.fs.writeTextFile, {
        sessionId: params.sessionId,
        path: path.join(cwd, "views", name),
        content,
      });
    await write("Later.specimen.tsx", LATER_VIEW);
    // Long enough for the preview server to see the half-done view on its own.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await write("later-data.ts", `export const GREETING = "Written last";\n`);
  }
  if (text.includes("E2E-REVIEW")) {
    await client.request(acp.methods.client.fs.writeTextFile, {
      sessionId: params.sessionId,
      path: path.join(cwd, "review.json"),
      content: `${JSON.stringify({ title: "E2E review", show: [{ specimen: "Buttons" }] }, null, 2)}\n`,
    });
  }
  await client.notify(acp.methods.client.session.update, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `Fast motion is now ${fast + 10}ms.` },
    },
  });
  return { stopReason: "end_turn" };
}

acp
  .agent({ name: "basis-e2e-agent" })
  .onRequest("initialize", () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, sessionCapabilities: { systemPrompt: {} } },
  }))
  .onRequest("session/new", (ctx) => {
    const sessionId = `e2e-${sessions.size + 1}`;
    sessions.set(sessionId, ctx.params.cwd);
    return { sessionId };
  })
  .onRequest("session/prompt", (ctx) => turn(ctx.params, ctx.client))
  .onNotification("session/cancel", () => {})
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
