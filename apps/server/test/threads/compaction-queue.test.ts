import { afterEach, expect, it } from "vitest";
import {
  getLatestThreadSequence,
  isThreadQueueAutoSendPaused,
  listQueuedThreadMessages,
  setQueuedThreadMessageGroupBoundary,
} from "@bb/db";
import { createStandaloneBuiltinCompactCommandInput } from "@bb/domain";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { createDeferredPromise } from "@bb/test-helpers";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { seedTurnStarted } from "../helpers/seed.js";
import { seedCompactionFixture } from "../helpers/thread-compaction.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

afterEach(() => setPluginHookProvider(undefined));

function installPolicy(
  handler: PluginHookRegistration<"message.dispatch">["handler"],
) {
  const registry: { [K in PluginHookName]: PluginHookRegistration<K>[] } = {
    "message.dispatch": [{ pluginId: "admission-policy", handler }],
  };
  setPluginHookProvider({
    listHooks: (name) => registry[name],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
}

async function queueFollowup(
  harness: TestAppHarness,
  threadId: string,
  text: string,
  compactFirst = true,
) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "queue-if-active",
        ...(compactFirst ? { compactFirst: true } : {}),
        input: [{ type: "text", text }],
      }),
    },
  );
  expect(response.status).toBe(200);
  const row = listQueuedThreadMessages(harness.db, threadId).at(-1);
  if (!row) throw new Error("Expected held follow-up");
  return row;
}

it("cancels held compact-before-send without starting provider work", async () => {
  await withTestHarness(async (harness) => {
    const { thread, responder } = seedCompactionFixture(harness);
    let holding = true;
    installPolicy(() =>
      holding
        ? { action: "wait", reason: "Held assignment" }
        : { action: "proceed" },
    );
    const row = await queueFollowup(harness, thread.id, "Canceled assignment");
    const before = getLatestThreadSequence(harness.db, { threadId: thread.id });
    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/queued-messages/${row.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(200);
    holding = false;
    await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });
    expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    expect(getLatestThreadSequence(harness.db, { threadId: thread.id })).toBe(
      before,
    );
    expect(
      responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      ),
    ).toHaveLength(0);
  });
});

it("keeps compaction intent when a held follow-up is edited", async () => {
  await withTestHarness(async (harness) => {
    const { thread, responder } = seedCompactionFixture(harness);
    let holding = true;
    installPolicy(() =>
      holding
        ? { action: "wait", reason: "Held assignment" }
        : { action: "proceed" },
    );
    const row = await queueFollowup(harness, thread.id, "Original assignment");
    const response = await harness.app.request(
      `/api/v1/threads/${thread.id}/queued-messages/${row.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: [{ type: "text", text: "Edited assignment" }],
          expectedUpdatedAt: row.updatedAt,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(listQueuedThreadMessages(harness.db, thread.id)[0]).toMatchObject({
      id: row.id,
      payloadKind: "compact-first",
    });
    holding = false;
    await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });
    const submits = responder.requests.filter(
      ({ command }) => command.type === "turn.submit",
    );
    expect(submits).toHaveLength(1);
    expect(submits[0]?.command).toMatchObject({
      input: createStandaloneBuiltinCompactCommandInput(),
    });
    const followup = listQueuedThreadMessages(harness.db, thread.id)[0]!;
    expect(followup).toMatchObject({ id: row.id, payloadKind: "inline" });
    expect(JSON.parse(followup.content)).toMatchObject([
      { type: "text", text: "Edited assignment" },
    ]);
  });
});

it("compacts once for a grouped request whose later row requests compaction", async () => {
  await withTestHarness(async (harness) => {
    const { thread, responder } = seedCompactionFixture(harness);
    let holding = true;
    installPolicy(() =>
      holding
        ? { action: "wait", reason: "Held assignment" }
        : { action: "proceed" },
    );
    const first = await queueFollowup(harness, thread.id, "First", false);
    const second = await queueFollowup(harness, thread.id, "Second");
    expect(
      setQueuedThreadMessageGroupBoundary({
        db: harness.db,
        notifier: harness.hub,
        threadId: thread.id,
        expectedGroupedPrefixQueuedMessageIds: [first.id, second.id],
        groupBoundaryQueuedMessageId: second.id,
      }).kind,
    ).toBe("updated");
    holding = false;
    await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });
    const submits = responder.requests.filter(
      ({ command }) => command.type === "turn.submit",
    );
    expect(submits).toHaveLength(1);
    expect(submits[0]?.command).toMatchObject({
      input: createStandaloneBuiltinCompactCommandInput(),
    });
    const after = listQueuedThreadMessages(harness.db, thread.id);
    expect(after).toMatchObject([
      { id: first.id, payloadKind: "inline", groupWithNext: true },
      { id: second.id, payloadKind: "inline", groupWithNext: false },
    ]);
    expect(after.map((row) => JSON.parse(row.content))).toMatchObject([
      [{ type: "text", text: "First" }],
      [{ type: "text", text: "Second" }],
    ]);
  });
});

it("retains compact-before-send when admission crosses a native manual Stop", async () => {
  await withTestHarness(async (harness) => {
    const { thread, responder } = seedCompactionFixture(harness);
    const entered = createDeferredPromise<void>();
    const release = createDeferredPromise<void>();
    let holding = true;
    installPolicy(async () => {
      if (holding) return { action: "wait", reason: "Held assignment" };
      entered.resolve();
      await release.promise;
      return { action: "proceed" };
    });
    const row = await queueFollowup(harness, thread.id, "Stopped assignment");
    holding = false;
    const draining = runQueuedMessageDispatch(harness.deps, {
      kind: "plugin-recheck",
    });
    await entered.promise;
    try {
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.started" },
        threadId: thread.id,
      });
      seedTurnStarted(harness.deps, {
        environmentId: thread.environmentId,
        providerThreadId: "admission-provider-thread",
        threadId: thread.id,
        turnId: "turn-compaction-stop-race",
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
    } finally {
      release.resolve();
    }
    await draining;
    expect(
      responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      ),
    ).toHaveLength(0);
    expect(isThreadQueueAutoSendPaused(harness.db, thread.id)).toBe(true);
    expect(listQueuedThreadMessages(harness.db, thread.id)).toMatchObject([
      { id: row.id, payloadKind: "compact-first", claimToken: null },
    ]);
    expect(
      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      }),
    ).toBe(false);
    const explicit = await harness.app.request(
      `/api/v1/threads/${thread.id}/queued-messages/${row.id}/send`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      },
    );
    expect(explicit.status).toBe(200);
    const resumed = responder.requests.filter(
      ({ command }) => command.type === "turn.submit",
    );
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.command).toMatchObject({
      input: createStandaloneBuiltinCompactCommandInput(),
    });
  });
});

it("leaves unrelated threads admitted when the guard targets one owned conversation", async () => {
  await withTestHarness(async (harness) => {
    const owned = seedCompactionFixture(harness);
    const unrelated = seedCompactionFixture(harness);
    installPolicy(({ thread }) =>
      thread.id === owned.thread.id
        ? { action: "reject", message: "Stopped owned assignment" }
        : { action: "proceed" },
    );
    const ownedResult = await harness.app.request(
      `/api/v1/threads/${owned.thread.id}/compact`,
      { method: "POST" },
    );
    const unrelatedResult = await harness.app.request(
      `/api/v1/threads/${unrelated.thread.id}/compact`,
      { method: "POST" },
    );
    expect(ownedResult.status).toBe(409);
    expect(unrelatedResult.status).toBe(200);
    expect(
      owned.responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      ),
    ).toHaveLength(0);
    expect(
      unrelated.responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      ),
    ).toHaveLength(1);
  });
});
