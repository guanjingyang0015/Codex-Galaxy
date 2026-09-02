import assert from "node:assert/strict";
import test from "node:test";
import { checkDocumentationConsistency } from "../scripts/check-docs.mjs";

test("all maintained release documentation follows the current package version", async () => {
  await assert.doesNotReject(() => checkDocumentationConsistency());
});
