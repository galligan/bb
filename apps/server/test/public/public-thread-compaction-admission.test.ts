import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MessageDispatchHookContext } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLatestThreadSequence,
  getQueuedThreadMessage,
  releaseQueuedMessageClaim,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import { createStandaloneBuiltinCompactCommandInput } from "@bb/domain";
import {
  invokePluginInline,
  setPluginHookProvider,
} from "../../src/services/plugins/plugin-hook-registry.js";
import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { readJson } from "../helpers/json.js";
import {
  withTestHarness,
  startTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";

afterEach(() => setPluginHookProvider(undefined));

const surfaces = [
  { name: "native Compact endpoint", path: "compact", payload: null },
  {
    name: "composer compact command",
    path: "send",
    payload: {
      input: createStandaloneBuiltinCompactCommandInput(),
      mode: "start",
    },
  },
  {
    name: "compact before send",
    path: "send",
    payload: {
      compactFirst: true,
      mode: "queue-if-active",
      input: [{ type: "text", text: "Continue after compaction" }],
    },
  },
];

function seedFixture(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "pi",
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    threadId: thread.id,
    providerThreadId: "admission-provider-thread",
  });
  const responder = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: ({ command }): HostRpcHandlerResult => {
      if (command.type === "host.read_workspace_agent_context")
        return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
      if (command.type === "turn.submit")
        return { ok: true, result: { trace: { spans: [] } } };
      return { ok: true, result: {} };
    },
  });
  return { thread, responder };
}

describe.each(surfaces)("compaction admission: $name", ({ path, payload }) => {
  it("refuses before any provider request when dispatch is rejected", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedFixture(harness);
      const reject = vi.fn(() => ({
        action: "reject" as const,
        message: "Stopped assignment",
      }));
      setPluginHookProvider({
        listHooks: () => [{ pluginId: "admission-policy", handler: reject }],
        invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
        decisionTimeoutMs: 10_000,
      });
      const sequenceBefore = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/${path}`,
        {
          method: "POST",
          ...(payload === null
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              }),
        },
      );
      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(409);
      expect(reject).toHaveBeenCalledOnce();
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) =>
            event.type === "client/turn/requested" &&
            event.sequence > sequenceBefore,
        ),
      ).toHaveLength(0);
      expect(getLatestThreadSequence(harness.db, { threadId: thread.id })).toBe(
        sequenceBefore,
      );
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });
  it("preserves the requested compaction across a policy wait and drains it once", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedFixture(harness);
      let holding = true;
      setPluginHookProvider({
        listHooks: () => [
          {
            pluginId: "admission-policy",
            handler: () =>
              holding
                ? { action: "wait" as const, reason: "Stopped assignment" }
                : { action: "proceed" as const },
          },
        ],
        invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
        decisionTimeoutMs: 10_000,
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/${path}`,
        {
          method: "POST",
          ...(payload === null
            ? {}
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
              }),
        },
      );
      expect(response.status).toBe(200);
      const before = listQueuedThreadMessages(harness.db, thread.id);
      expect(before).toHaveLength(1);
      expect(before[0]?.payloadKind).toBe(
        payload !== null && "compactFirst" in payload
          ? "compact-first"
          : "inline",
      );
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);
      holding = false;
      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });
      const submits = () =>
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        );
      expect(submits()).toHaveLength(1);
      expect(submits()[0]?.command).toMatchObject({
        input: createStandaloneBuiltinCompactCommandInput(),
      });
      if (payload !== null && "compactFirst" in payload) {
        const after = listQueuedThreadMessages(harness.db, thread.id);
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({
          id: before[0]?.id,
          payloadKind: "inline",
          claimToken: null,
        });
        expect(JSON.parse(after[0]!.content)).toMatchObject([
          { type: "text", text: "Continue after compaction" },
        ]);
      } else {
        expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      }
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(false);
      expect(submits()).toHaveLength(1);
    });
  });
});

it("preserves the authenticated plugin caller through native Compact admission and queue drain", async () => {
  const server = await startTestServer();
  try {
    const { thread, responder } = seedFixture(server);
    server.pluginService.bindSdk({ baseUrl: server.baseUrl });
    const pluginRoot = join(server.config.dataDir, "compact-caller-plugin");
    await mkdir(pluginRoot);
    await writeFile(
      join(pluginRoot, "package.json"),
      JSON.stringify({
        name: "bb-plugin-compact-caller",
        version: "0.1.0",
        bb: {
          name: "Compact caller",
          description: "Admission fixture",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(pluginRoot, "server.ts"),
      "export default function plugin() {}\n",
    );
    expect((await server.pluginService.installPath(pluginRoot)).status).toBe(
      "running",
    );
    const initialApi = server.pluginService.getApi("compact-caller");
    if (!initialApi) throw new Error("Compact caller fixture is not running");
    const staleSdk = initialApi.sdk;
    await server.pluginService.reload("compact-caller");
    const api = server.pluginService.getApi("compact-caller");
    if (!api) throw new Error("Reloaded compact caller fixture is not running");
    let holding = true;
    const seen: MessageDispatchHookContext[] = [];
    setPluginHookProvider({
      listHooks: () => [
        {
          pluginId: "admission-policy",
          handler: (context) => {
            seen.push(context);
            return holding
              ? { action: "wait" as const, reason: "Stop policy" }
              : { action: "proceed" as const };
          },
        },
      ],
      invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
      decisionTimeoutMs: 10_000,
    });
    await expect(
      staleSdk.threads.compact({ threadId: thread.id }),
    ).rejects.toMatchObject({ status: 403 });
    expect(seen).toHaveLength(0);
    expect(listQueuedThreadMessages(server.db, thread.id)).toHaveLength(0);
    expect(
      responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      ),
    ).toHaveLength(0);
    await expect(
      api.sdk.threads.compact({ threadId: thread.id }),
    ).resolves.toEqual({ ok: true });
    expect(seen[0]).toMatchObject({
      origin: "plugin",
      originPluginId: "compact-caller",
      thread: { id: thread.id },
    });
    expect(listQueuedThreadMessages(server.db, thread.id)[0]).toMatchObject({
      origin: "plugin",
      originPluginId: "compact-caller",
    });
    holding = false;
    await runQueuedMessageDispatch(server.deps, { kind: "plugin-recheck" });
    expect(seen.at(-1)).toMatchObject({
      origin: "plugin",
      originPluginId: "compact-caller",
    });
    expect(
      responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      ),
    ).toHaveLength(1);
    const requested = listEvents(server.db, { threadId: thread.id })
      .filter((event) => event.type === "client/turn/requested")
      .at(-1);
    expect(JSON.parse(requested!.data)).toMatchObject({
      originPluginId: "compact-caller",
    });
  } finally {
    setPluginHookProvider(undefined);
    await server.close();
  }
});

it("does not start compaction after its queued claim is lost during admission", async () => {
  await withTestHarness(async (harness) => {
    const { thread, responder } = seedFixture(harness);
    let holding = true;
    let released = false;
    setPluginHookProvider({
      listHooks: () => [
        {
          pluginId: "admission-policy",
          handler: (context) => {
            if (holding)
              return { action: "wait" as const, reason: "Stop policy" };
            const queued = context.queuedMessages[0];
            if (!queued) throw new Error("Expected claimed queued request");
            const row = getQueuedThreadMessage(harness.db, queued.id);
            if (!row?.claimToken) throw new Error("Expected live queue claim");
            released = releaseQueuedMessageClaim(harness.db, harness.hub, {
              id: row.id,
              claimToken: row.claimToken,
            });
            return { action: "proceed" as const };
          },
        },
      ],
      invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
      decisionTimeoutMs: 10_000,
    });
    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/send`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(surfaces[2]!.payload),
      },
    );
    expect(response.status).toBe(200);
    const before = getLatestThreadSequence(harness.db, { threadId: thread.id });
    holding = false;
    await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });
    expect(released).toBe(true);
    expect(
      responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      ),
    ).toHaveLength(0);
    expect(getLatestThreadSequence(harness.db, { threadId: thread.id })).toBe(
      before,
    );
    expect(
      listQueuedThreadMessages(harness.db, thread.id)[0]?.payloadKind,
    ).toBe("compact-first");
  });
});
