import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "./host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "./seed.js";
import type { TestAppHarness } from "./test-app.js";

export function seedCompactionFixture(harness: TestAppHarness) {
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
      if (command.type === "thread.stop")
        return { ok: true, result: { providerCheckpointId: null } };
      if (command.type === "turn.submit")
        return { ok: true, result: { trace: { spans: [] } } };
      return { ok: true, result: {} };
    },
  });
  return { thread, responder, host, session };
}
