const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { parseFramedMessages, serializeFramedMessage, writeFramedMessage } = require("../lib/runtime/transport");

test("parseFramedMessages keeps incomplete frames as remainder", () => {
  const frame = serializeFramedMessage({ jsonrpc: "2.0", id: 1, method: "plugin.init", params: {} });
  const partial = frame.subarray(0, frame.length - 3);

  const parsed = parseFramedMessages(partial);

  assert.deepEqual(parsed.messages, []);
  assert.deepEqual(parsed.remainder, partial);
});

test("parseFramedMessages skips invalid JSON payloads and continues at next frame", () => {
  const invalidPayload = Buffer.from("Content-Length: 4\r\n\r\noops", "utf8");
  const valid = serializeFramedMessage({ jsonrpc: "2.0", id: 2, method: "plugin.deinit", params: {} });

  const parsed = parseFramedMessages(Buffer.concat([invalidPayload, valid]));

  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].id, 2);
  assert.equal(parsed.remainder.length, 0);
});

test("parseFramedMessages drops malformed header blocks", () => {
  const malformed = Buffer.from("Bogus: 1\r\n\r\n", "utf8");
  const valid = serializeFramedMessage({ jsonrpc: "2.0", id: 3, method: "plugin.deinit", params: {} });
  const parsed = parseFramedMessages(Buffer.concat([malformed, valid]));

  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].id, 3);
  assert.equal(parsed.remainder.length, 0);
});

test("parseFramedMessages leaves garbage payload bytes after invalid content lengths", () => {
  const badNegative = Buffer.from("Content-Length: -1\r\n\r\n{}", "utf8");
  const parsed = parseFramedMessages(badNegative);

  assert.deepEqual(parsed.messages, []);
  assert.deepEqual(parsed.remainder, Buffer.from("{}", "utf8"));
});

test("writeFramedMessage waits for drain when stream backpressures", async () => {
  const writer = new EventEmitter();
  let wrote = false;
  writer.write = (chunk) => {
    wrote = Buffer.isBuffer(chunk);
    setImmediate(() => writer.emit("drain"));
    return false;
  };

  await writeFramedMessage(writer, { ok: true });

  assert.equal(wrote, true);
});

test("writeFramedMessage reports writer failures without throwing", async () => {
  const originalError = console.error;
  const messages = [];
  console.error = (message) => messages.push(String(message));
  try {
    await writeFramedMessage({ write() { throw new Error("closed"); } }, { ok: true });
  } finally {
    console.error = originalError;
  }

  assert.match(messages[0], /failed to write framed message: closed/);
});
