// A stand-in ACP agent for the end-to-end tests, started through BASIS_AGENT_SCRIPT. It changes a token through the
// client's own file methods, so history, checks and reviews run for real. What it does depends on a marker in the
// prompt: E2E-REVIEW also opens a review of the Buttons specimen, E2E-VIEW writes a new view in two steps, the
// first importing a file the second writes, E2E-SLOW takes four seconds first (for turns in two projects at once),
// E2E-ASK first asks for permission to run a command, E2E-BROKEN writes a specimen with a render error and an
// accessibility finding, which the fix-up turn repairs, and E2E-WHO has the reply name its session and say whether
// it was resumed (for threads across a restart). Every turn moves motion.duration.fast by 10ms. Session ids differ
// between runs, so a resumed session is told from a new one.
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

/** Each session's folder, and whether it was resumed rather than made by this process. */
const sessions = new Map();
const run = Date.now().toString(36);

const LATER_VIEW = `import { defineSpecimen } from "../components/specimen.ts";
import { GREETING } from "./later-data.ts";

export default defineSpecimen({
  title: "Later view",
  blocks: [{ kind: "flow", screens: [{ id: "hello", label: "Hello", render: () => <p>{GREETING}</p> }] }],
});
`;

/** A specimen with a block that throws, and one with a button without a name, which axe reports. */
const specimen = (title, render) => `import { defineSpecimen } from "./specimen.ts";

export default defineSpecimen({ title: "${title}", blocks: [{ kind: "block", render: () => ${render} }] });
`;
const BROKEN = {
  "Broken.specimen.tsx": specimen("Broken", `{ throw new Error("E2E broken block"); }`),
  "Unnamed.specimen.tsx": specimen("Unnamed", `<button type="button" />`),
};
const FIXED = {
  "Broken.specimen.tsx": specimen("Broken", `<p>Fixed</p>`),
  "Unnamed.specimen.tsx": specimen("Unnamed", `<button type="button">Named</button>`),
};

async function turn(params, client) {
  const session = sessions.get(params.sessionId);
  if (!session) throw new Error(`Unknown session ${params.sessionId}`);
  const { cwd } = session;
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
  // E2E-BROKEN leaves a render error and an accessibility finding; the fix-up turn Basis sends for them fixes both.
  if (text.includes("E2E-BROKEN") || text.includes("Your last change left problems")) {
    const files = text.includes("E2E-BROKEN") ? BROKEN : FIXED;
    for (const [name, content] of Object.entries(files)) {
      await client.request(acp.methods.client.fs.writeTextFile, {
        sessionId: params.sessionId,
        path: path.join(cwd, "components", name),
        content,
      });
    }
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
      content: {
        type: "text",
        text: `Fast motion is now ${fast + 10}ms.${
          text.includes("E2E-WHO") ? ` Session ${params.sessionId}${session.resumed ? " resumed" : " new"}.` : ""
        }`,
      },
    },
  });
  return { stopReason: "end_turn" };
}

acp
  .agent({ name: "basis-e2e-agent" })
  .onRequest("initialize", () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, sessionCapabilities: { systemPrompt: {}, resume: {} } },
  }))
  .onRequest("session/new", (ctx) => {
    const sessionId = `e2e-${run}-${sessions.size + 1}`;
    sessions.set(sessionId, { cwd: ctx.params.cwd, resumed: false });
    return { sessionId };
  })
  .onRequest("session/resume", (ctx) => {
    const known = sessions.get(ctx.params.sessionId);
    sessions.set(ctx.params.sessionId, { cwd: ctx.params.cwd, resumed: known?.resumed ?? !known });
    return {};
  })
  .onRequest("session/prompt", (ctx) => turn(ctx.params, ctx.client))
  .onNotification("session/cancel", () => {})
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
