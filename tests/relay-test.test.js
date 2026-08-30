import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearApiKey, publicProfiles, saveProfile } from "../profiles.js";
import { testApiProfile } from "../relay-connection.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-relay-test-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({
    id: "relay-test",
    name: "Synthetic relay",
    kind: "api",
    baseUrl: "https://relay.test/v1",
    apiKey: "synthetic-api-key",
    model: "synthetic-model",
  }, paths);
  return paths;
}

test("relay connection test calls only the standard models endpoint and stores no response body", async () => {
  const paths = await fixture();
  const calls = [];
  let bodyCancelled = false;
  const result = await testApiProfile("relay-test", paths, {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      const response = new Response(JSON.stringify({ data: [{ id: "synthetic-model" }], secret: "must-not-persist" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const cancel = response.body.cancel.bind(response.body);
      response.body.cancel = async (...args) => {
        bodyCancelled = true;
        return cancel(...args);
      };
      response.arrayBuffer = async () => assert.fail("connection test must not buffer the provider response");
      return response;
    },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.httpStatus, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://relay.test/v1/models");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.authorization, "Bearer synthetic-api-key");
  assert.equal(bodyCancelled, true);
  const profile = (await publicProfiles(paths)).profiles[0];
  assert.equal(profile.lastTest.status, "ok");
  assert.doesNotMatch(JSON.stringify(profile), /must-not-persist|synthetic-api-key/);
});

test("relay connection test classifies HTTP failures without storing provider content", async () => {
  const cases = [
    [401, "auth"],
    [404, "not-found"],
    [503, "server"],
    [422, "unsupported"],
  ];
  for (const [httpStatus, expectedStatus] of cases) {
    const paths = await fixture();
    const result = await testApiProfile("relay-test", paths, {
      fetcher: async () => new Response("synthetic provider error", { status: httpStatus }),
    });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.httpStatus, httpStatus);
  }
});

test("relay connection test sanitizes network failures and rejects missing keys", async () => {
  const paths = await fixture();
  const result = await testApiProfile("relay-test", paths, {
    fetcher: async () => {
      const error = new Error("synthetic-relay.example ENOTFOUND");
      error.code = "ENOTFOUND";
      throw error;
    },
  });
  assert.equal(result.status, "network");
  assert.equal(result.message, "域名解析失败（DNS）");
  assert.doesNotMatch(result.message, /synthetic-relay|api-key/);

  await saveProfile({
    id: "relay-no-key",
    name: "No key",
    kind: "api",
    baseUrl: "https://relay.test/v1",
    apiKey: "temporary-key",
    model: "synthetic-model",
  }, paths);
  await clearApiKey("relay-no-key", paths);
  await assert.rejects(() => testApiProfile("relay-no-key", paths, { fetcher: async () => assert.fail("must not fetch") }), /还没有保存 API Key/);
});

test("relay connection test rejects unsafe legacy Base URLs before fetching", async () => {
  for (const baseUrl of ["file:///C:/sensitive", "https://user:password@relay.test/v1"]) {
    const paths = await fixture();
    const stored = JSON.parse(await fs.readFile(paths.profiles, "utf8"));
    stored.profiles[0].baseUrl = baseUrl;
    await fs.writeFile(paths.profiles, JSON.stringify(stored), "utf8");
    const result = await testApiProfile("relay-test", paths, {
      fetcher: async () => assert.fail("unsafe Base URL must not be fetched"),
    });
    assert.equal(result.status, "invalid");
    assert.equal(result.message, "Base URL 格式不正确");
  }
});
