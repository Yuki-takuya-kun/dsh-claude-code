// test/permission.test.mjs — permission.mjs 的纯单测（无宿主运行时依赖）。
import test from "node:test";
import assert from "node:assert/strict";
import { readPermission, isWithinWorkspace, permissionStrategy } from "../lib/permission.mjs";

function session(events) {
  return { events };
}

test("readPermission: empty events yield undefined mode/policy", () => {
  const { mode, policy } = readPermission(session([]));
  assert.equal(mode, undefined);
  assert.equal(policy, undefined);
});

test("readPermission: folds last sandbox/mode and approval/policy events", () => {
  const events = [
    { type: "turn/start", data: { turn: 1 } },
    { type: "sandbox/mode", data: { mode: "read-only" } },
    { type: "approval/policy", data: { policy: "ask" } },
    { type: "sandbox/mode", data: { mode: "workspace-write" } },
  ];
  const { mode, policy } = readPermission(session(events));
  assert.equal(mode, "workspace-write");
  assert.equal(policy, "ask");
});

test("isWithinWorkspace: resolves inside, root, and outside paths", () => {
  const cwd = "/tmp/ws";
  assert.equal(isWithinWorkspace(cwd, "/tmp/ws/a/b.txt"), true);
  assert.equal(isWithinWorkspace(cwd, "/tmp/ws"), true);
  assert.equal(isWithinWorkspace(cwd, "/tmp/ws/../outside.txt"), false);
  assert.equal(isWithinWorkspace(cwd, "/etc/passwd"), false);
  assert.equal(isWithinWorkspace(cwd, ""), false);
  assert.equal(isWithinWorkspace("", "/tmp/ws/a"), false);
});

test("permissionStrategy: danger-full-access bypasses permissions", () => {
  assert.equal(permissionStrategy({ mode: "danger-full-access", policy: "never" }), "bypass");
  assert.equal(permissionStrategy({ mode: "danger-full-access", policy: "ask" }), "bypass");
});

test("permissionStrategy: never policy is no-prompt", () => {
  assert.equal(permissionStrategy({ mode: "workspace-write", policy: "never" }), "no-prompt");
});

test("permissionStrategy: ask (and default) prompts", () => {
  assert.equal(permissionStrategy({ mode: "workspace-write", policy: "ask" }), "ask");
  assert.equal(permissionStrategy({ mode: "read-only", policy: "ask" }), "ask");
  assert.equal(permissionStrategy({ mode: undefined, policy: undefined }), "ask");
});
