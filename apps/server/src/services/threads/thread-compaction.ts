import type { Thread, ThreadQueuedMessage } from "@bb/domain";
import { createStandaloneBuiltinCompactCommandInput } from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import type { ClaimedQueuedThreadMessageRow } from "@bb/db";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import {
  recordQueuedMessageWait,
  type QueuedDispatchMessage,
} from "./queue-waits.js";
import {
  ensureThreadIsWritable,
  sendThreadMessage,
  type SendThreadMessageTransactionPreflight,
} from "./thread-send.js";

export function assertThreadCanCompact(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: Thread,
): void {
  ensureThreadIsWritable(thread);
  if (!deps.providerRegistry.supportsManualCompaction(thread.providerId)) {
    throw new ApiError(
      409,
      "invalid_request",
      `Provider "${thread.providerId}" does not support manual context compaction`,
    );
  }
  if (thread.status !== "idle" && thread.status !== "error") {
    throw new ApiError(
      409,
      "invalid_request",
      "Context can only be compacted while the thread is idle or errored",
    );
  }
}

export async function compactBeforeSend(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    thread: Thread;
    message: QueuedDispatchMessage;
    claimed: readonly ClaimedQueuedThreadMessageRow[] | null;
    trigger: "auto-dispatch" | "user";
    beforeAppendInTransaction: SendThreadMessageTransactionPreflight;
  },
): Promise<ThreadQueuedMessage> {
  assertThreadCanCompact(deps, args.thread);
  const environment = await requireThreadCommandEnvironment(deps, {
    thread: args.thread,
  });
  const queued: { entry: ThreadQueuedMessage | null } = { entry: null };
  const payload: SendMessageRequest = {
    input: createStandaloneBuiltinCompactCommandInput(),
    mode: "start",
    ...(args.message.originPluginId === null
      ? {}
      : { originPluginId: args.message.originPluginId }),
  };
  await sendThreadMessage(deps, {
    thread: args.thread,
    environment,
    payload,
    originPluginId: args.message.originPluginId,
    trigger: args.trigger,
    beforeAppendInTransaction: ({ tx }) => {
      args.beforeAppendInTransaction({ tx });
      queued.entry = recordQueuedMessageWait(
        { db: tx, hub: deps.hub },
        {
          thread: args.thread,
          message: { ...args.message, payload: { kind: "inline" } },
          claimed: args.claimed,
          placement: "back",
          waitingOn: { kind: "thread-busy" },
          sendAt: null,
          compactionStarted: true,
        },
      );
      if (queued.entry === null)
        throw new ApiError(
          409,
          "queued_message_claim_lost",
          "Queued message claim expired before compaction could start",
        );
    },
  });
  if (queued.entry === null)
    throw new ApiError(
      500,
      "internal_error",
      "Compaction did not record its follow-up message",
    );
  return queued.entry;
}
