const assert = require("node:assert/strict");
const test = require("node:test");

const { ModalBuilder } = require("../lib/runtime");

test("ModalBuilder serializes all supported content item types", async () => {
  const modal = new ModalBuilder("  Settings  ")
    .text("Hello", { title: "Greeting", align: "center" })
    .separator()
    .button(" save ", "Save", { title: "Persist", variant: "primary", align: "end", payload: { ok: true } })
    .input(" name ", " Name ", { kind: "text", value: "OpenVCS", placeholder: "Name", required: true, align: "start" })
    .select("theme", "Theme", { value: "dark", align: "center", options: [{ value: "dark", label: "Dark" }] })
    .list("files", { label: "Files", emptyText: "None", align: "start", items: [{ id: "a", label: "A" }] })
    .build();

  assert.equal(modal.title, "Settings");
  assert.deepEqual(modal.content.map((item) => item.type), [
    "text",
    "separator",
    "button",
    "input",
    "select",
    "list",
  ]);
  assert.deepEqual(modal.content[2].payload, { ok: true });
  assert.equal(modal.content[3].required, true);
});

test("ModalBuilder omits optional fields when not provided", () => {
  const modal = new ModalBuilder("  ")
    .text("Plain")
    .button(" save ", "Save")
    .input(" name ", " Name ")
    .select("theme", "Theme", { options: [] })
    .list("files", { items: [] })
    .horizontalBox([{ type: "text", content: "child" }])
    .verticalBox([{ type: "text", content: "child" }])
    .grid([{ type: "text", content: "child" }], { columns: " 1fr " })
    .build();

  assert.equal(modal.title, "");
  assert.equal(modal.content[0].title, undefined);
  assert.equal(modal.content[1].variant, undefined);
  assert.equal(modal.content[2].kind, undefined);
  assert.equal(modal.content[3].value, undefined);
  assert.equal(modal.content[4].label, undefined);
  assert.equal(modal.content[5].gap, undefined);
  assert.equal(modal.content[6].gap, undefined);
  assert.equal(modal.content[7].gap, undefined);
  assert.equal(modal.content[7].columns, "1fr");
});

test("ModalBuilder clones nested container content before returning definitions", () => {
  const nested = [{ type: "text", content: "inside" }];
  const builder = new ModalBuilder("Nested")
    .horizontalBox(nested, { gap: "4px", align: "center", wrap: true })
    .verticalBox(nested, { gap: "8px" })
    .grid(nested, { columns: "1fr 1fr", gap: "2px" });

  const first = builder.build();
  first.content[0].content[0].content = "mutated";
  nested[0].content = "source mutated";
  const second = builder.build();

  assert.equal(second.content[0].content[0].content, "inside");
  assert.equal(second.content[1].content[0].content, "inside");
  assert.equal(second.content[2].columns, "1fr 1fr");
});

test("ModalBuilder.open returns the same payload shape as build", async () => {
  const builder = new ModalBuilder("Open").text("Body");

  assert.deepEqual(await builder.open(), builder.build());
});
