const assert = require("node:assert/strict");
const test = require("node:test");

const { createHost } = require("../lib/runtime");

test("createHost maps log helpers to host.log notifications", () => {
  const sent = [];
  const host = createHost((method, params) => sent.push({ method, params }), { logTarget: "test.plugin" });

  host.log("warn", "careful");
  host.info("ready");
  host.error("failed");

  assert.deepEqual(sent, [
    { method: "host.log", params: { level: "warn", target: "test.plugin", message: "careful" } },
    { method: "host.log", params: { level: "info", target: "test.plugin", message: "ready" } },
    { method: "host.log", params: { level: "error", target: "test.plugin", message: "failed" } },
  ]);
});

test("createHost maps UI/status/event helpers to protocol notifications", () => {
  const sent = [];
  const host = createHost((method, params) => sent.push({ method, params }));

  host.uiNotify({ level: "info", message: "Saved" });
  host.statusSet({ message: "Working" });
  host.emitEvent({ name: "custom", payload: { value: 1 } });
  host.emitVcsEvent("session-1", 42, { type: "progress", message: "Fetch" });

  assert.deepEqual(sent, [
    { method: "host.ui_notify", params: { level: "info", message: "Saved" } },
    { method: "host.status_set", params: { message: "Working" } },
    { method: "host.event_emit", params: { name: "custom", payload: { value: 1 } } },
    {
      method: "vcs.event",
      params: { session_id: "session-1", request_id: 42, event: { type: "progress", message: "Fetch" } },
    },
  ]);
});
