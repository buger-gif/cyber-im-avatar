import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MediaStore, safeFileName, safeSegment } from "../lib/media.js";

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "im-media-"));
  return { dir, media: new MediaStore(dir) };
}

test("safe file names keep basenames and never escape the media dir", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("/tmp/a.txt"), "a.txt");
  assert.equal(safeFileName(".."), "file");
  assert.equal(safeFileName("报价单 2026.pdf"), "报价单 2026.pdf");
  assert.equal(safeFileName(".hidden"), "_.hidden");
  assert.doesNotMatch(safeSegment("oc/a:b"), /[/:]/);
  assert.notEqual(safeSegment("同一个 id"), safeSegment("同一个-id"));
});

test("keep writes 700/600 under platform/chat/message", () => {
  const { dir, media } = store();
  const msgDir = media.ensureMessageDir("feishu", "oc_chat", "om_msg");
  assert.equal(fs.statSync(msgDir).mode & 0o777, 0o700);
  const src = path.join(dir, "src.bin");
  fs.writeFileSync(src, "abc");
  const dest = media.keep(msgDir, src, "../../a.png");
  assert.equal(path.dirname(dest), msgDir);
  assert.equal(path.basename(dest), "a.png");
  assert.equal(fs.statSync(dest).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(dest, "utf8"), "abc");
});

test("cleanup removes files older than 7 days and prunes empty dirs", () => {
  const { media } = store();
  const msgDir = media.ensureMessageDir("feishu", "oc_chat", "om_old");
  const old = path.join(msgDir, "old.png");
  fs.writeFileSync(old, "x");
  const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(old, stale, stale);
  const r = media.cleanup();
  assert.deepEqual(r.removed, [old]);
  assert.equal(fs.existsSync(msgDir), false);
});

test("cleanup keeps each chat under its own 200MB budget and returns removed paths", () => {
  const { media } = store();
  const a = media.ensureMessageDir("feishu", "oc_a", "m1");
  const b = media.ensureMessageDir("feishu", "oc_b", "m2");
  const oldA = path.join(a, "old.bin");
  const newA = path.join(a, "new.bin");
  const other = path.join(b, "keep.bin");
  fs.writeFileSync(oldA, Buffer.alloc(8));
  fs.writeFileSync(newA, Buffer.alloc(8));
  fs.writeFileSync(other, Buffer.alloc(8));
  const stale = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(oldA, new Date(Date.now() - 2 * 60 * 60 * 1000), new Date(Date.now() - 2 * 60 * 60 * 1000));
  fs.utimesSync(newA, stale, stale);
  const r = media.cleanup({ maxChatBytes: 10 });
  assert.ok(r.removed.includes(oldA));
  assert.ok(!r.removed.includes(other));
  assert.ok(fs.existsSync(other));
});
