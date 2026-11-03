import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureSkill } from "../lib/skill-install.js";

const quiet = { info() {}, warn() {}, log() {} };

function withAgentsHome(fn) {
  const old = process.env.DSH_AGENTS_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "im-agents-"));
  process.env.DSH_AGENTS_HOME = home;
  try {
    return fn(path.join(home, "skills", "cyber-im-avatar"));
  } finally {
    if (old === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = old;
  }
}

test("managed skill marker records a content hash and reinstalls when content changes", () => {
  withAgentsHome((target) => {
    assert.equal(ensureSkill(quiet), "installed");
    const markerPath = path.join(target, ".installed-by-dsh-cyber-im-avatar.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.match(marker.content_hash, /^[0-9a-f]{64}$/);
    assert.ok(marker.version);

    assert.equal(ensureSkill(quiet), "current");
    fs.writeFileSync(markerPath, JSON.stringify({ ...marker, content_hash: "stale" }, null, 1));
    assert.equal(ensureSkill(quiet), "installed");
    const again = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.equal(again.content_hash, marker.content_hash);
  });
});

test("a hand-installed skill without the marker is never overwritten", () => {
  const old = process.env.DSH_AGENTS_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "im-agents-manual-"));
  process.env.DSH_AGENTS_HOME = home;
  try {
    const target = path.join(home, "skills", "cyber-im-avatar");
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), "手装副本\n");
    assert.equal(ensureSkill(quiet), "existing");
    assert.equal(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), "手装副本\n");
    assert.equal(fs.existsSync(path.join(target, ".installed-by-dsh-cyber-im-avatar.json")), false);
  } finally {
    if (old === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = old;
  }
});
