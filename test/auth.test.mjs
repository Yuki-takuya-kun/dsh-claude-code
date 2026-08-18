// test/auth.test.mjs — anthropicEnvFromParent 的纯单测：只取回 ANTHROPIC_* 变量。
import test from "node:test";
import assert from "node:assert/strict";
import { anthropicEnvFromParent } from "../lib/auth.mjs";

test("anthropicEnvFromParent keeps only ANTHROPIC_* variables", () => {
  const saved = { ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL, PATH: process.env.PATH };
  try {
    process.env.ANTHROPIC_AUTH_TOKEN = "tok-1";
    process.env.ANTHROPIC_BASE_URL = "https://proxy";
    process.env.PATH = "/usr/bin";

    const env = anthropicEnvFromParent();
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "tok-1");
    assert.equal(env.ANTHROPIC_BASE_URL, "https://proxy");
    assert.equal("PATH" in env, false);
    assert.equal("NODE_ENV" in env, false);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("anthropicEnvFromParent skips undefined and non-Anthropic variables", () => {
  const saved = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const env = anthropicEnvFromParent();
    assert.equal("ANTHROPIC_API_KEY" in env, false);
  } finally {
    if (saved.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.ANTHROPIC_API_KEY;
  }
});
