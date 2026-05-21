const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addMenuItem,
  createMenu,
  getMenu,
  hasRegisteredAction,
  hideMenu,
  invoke,
  notify,
  registerAction,
  removeMenu,
  resetMenuRegistry,
  runRegisteredAction,
  showMenu,
} = require("../lib/runtime/menu");
const { createRegisteredPluginRuntime } = require("../lib/runtime");
const { EventEmitter } = require("node:events");
const { parseFramedMessages, serializeFramedMessage } = require("../lib/runtime/transport");

function menuResult() {
  const stdin = new EventEmitter();
  const chunks = [];
  const stdout = {
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
  };
  createRegisteredPluginRuntime({}).start({ stdin, stdout });
  stdin.emit("data", serializeFramedMessage({ jsonrpc: "2.0", id: 1, method: "plugin.get_menus", params: {} }));
  return new Promise((resolve) => setImmediate(() => resolve(parseFramedMessages(Buffer.concat(chunks)).messages[0].result)));
}

test("menu ordering supports before and after placement", async () => {
  resetMenuRegistry();
  createMenu("middle", "Middle", { surface: "menubar" });
  createMenu("after", "After", { surface: "settings", after: "middle" });
  createMenu("before", "Before", { surface: "menubar", before: "middle" });

  const menus = await menuResult();

  assert.deepEqual(menus.map((menu) => menu.id), ["before", "middle", "after"]);
  assert.deepEqual(menus.map((menu) => menu.surface), ["menubar", "menubar", "settings"]);
});

test("menu ordering falls back when requested anchors are missing", async () => {
  resetMenuRegistry();
  createMenu("first", "First", { surface: "menubar", after: "missing" });
  createMenu("second", "Second", { surface: "menubar", before: "missing" });
  createMenu("first", "First Updated", { surface: "settings" });

  const menus = await menuResult();

  assert.deepEqual(menus.map((menu) => menu.id), ["second", "first"]);
  assert.equal(menus[1].label, "First Updated");
  assert.equal(menus[1].surface, "settings");
});

test("menu item insertion supports before anchors and ignores invalid items", async () => {
  resetMenuRegistry();
  const menu = createMenu("insert", "Insert", { surface: "menubar" });
  menu.addItem({ label: "Last", action: "last" });
  menu.addItem({ label: "First", action: "first", before: "last" });
  menu.addItem({ label: "", action: "ignored" });
  menu.addItem({ label: "Ignored", action: "" });

  const menus = await menuResult();

  assert.deepEqual(menus[0].elements, [
    { type: "button", id: "first", label: "First" },
    { type: "button", id: "last", label: "Last" },
  ]);
});

test("menu handle can remove, hide, and show individual items", async () => {
  resetMenuRegistry();
  const menu = createMenu("tools", "Tools", { surface: "menubar" });
  menu.addItem({ label: "A", action: "a" });
  menu.addItem({ label: "B", action: "b" });
  menu.hideItem("a");

  let menus = await menuResult();
  assert.deepEqual(menus[0].elements, [{ type: "button", id: "b", label: "B" }]);

  menu.showItem("a");
  menu.removeItem("b");
  menus = await menuResult();

  assert.deepEqual(menus[0].elements, [{ type: "button", id: "a", label: "A" }]);
});

test("registered actions report presence and ignore blank ids", async () => {
  resetMenuRegistry();
  registerAction(" save ", () => "saved");

  assert.equal(hasRegisteredAction("save"), true);
  assert.equal(hasRegisteredAction(""), false);
  assert.equal(await runRegisteredAction("save"), "saved");
  assert.equal(await runRegisteredAction("missing"), null);
  assert.equal(await runRegisteredAction(""), null);
});

test("removeMenu deletes menu and order entry", async () => {
  resetMenuRegistry();
  createMenu("gone", "Gone", { surface: "menubar" });
  createMenu("stay", "Stay", { surface: "menubar" });
  removeMenu("gone");
  hideMenu("missing");
  showMenu("missing");

  assert.equal(getMenu("gone"), null);
  assert.deepEqual((await menuResult()).map((menu) => menu.id), ["stay"]);
});

test("invoke and notify use OpenVCS host helper when available", async () => {
  const previous = globalThis.OpenVCS;
  const calls = [];
  globalThis.OpenVCS = {
    async invoke(cmd, args) {
      calls.push({ cmd, args });
      return "ok";
    },
    notify(msg) {
      calls.push({ msg });
    },
  };
  try {
    assert.equal(await invoke("repo.open", { path: "/tmp" }), "ok");
    notify("done");
    assert.deepEqual(calls, [{ cmd: "repo.open", args: { path: "/tmp" } }, { msg: "done" }]);
  } finally {
    globalThis.OpenVCS = previous;
  }
});

test("invoke and notify fail when OpenVCS host helper is missing", async () => {
  const previous = globalThis.OpenVCS;
  delete globalThis.OpenVCS;
  try {
    await assert.rejects(() => invoke("missing"), /host is not available/);
    assert.throws(() => notify("missing"), /host is not available/);
  } finally {
    globalThis.OpenVCS = previous;
  }
});
