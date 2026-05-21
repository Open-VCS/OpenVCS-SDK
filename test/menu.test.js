const assert = require("node:assert/strict");
const test = require("node:test");

const {
  addMenuItem,
  createMenu,
  getMenu,
  hasRegisteredAction,
  hideMenu,
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
