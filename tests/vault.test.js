import test from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, maskSecret } from "../vault.js";

test("vault round trips secrets without storing plaintext", () => {
  const encrypted = encrypt("galaxy-secret");
  assert.equal(decrypt(encrypted), "galaxy-secret");
  assert.equal(JSON.stringify(encrypted).includes("galaxy-secret"), false);
  assert.equal(maskSecret("sk-123456789"), "sk-1••••6789");
});
