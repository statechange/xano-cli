import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  allocateXanoScriptFilename,
  retainXanoScriptFile,
} from "../src/commands/xanoscript.js";

test("duplicate names retain both scripts by adding the later object's ID", () => {
  const claimed = new Set<string>();

  assert.deepEqual(allocateXanoScriptFilename("duplicate", 101, claimed), {
    filename: "duplicate.xs",
    disambiguated: false,
  });
  assert.deepEqual(allocateXanoScriptFilename("duplicate", 202, claimed), {
    filename: "duplicate_202.xs",
    disambiguated: true,
  });
});

test("collision detection happens after names are sanitized", () => {
  const claimed = new Set<string>();

  assert.equal(allocateXanoScriptFilename("orders/api", 11, claimed).filename, "orders_api.xs");
  assert.equal(allocateXanoScriptFilename("orders?api", 12, claimed).filename, "orders_api_12.xs");
  assert.equal(claimed.size, 2);
});

test("collisions without a usable unique ID receive deterministic numeric suffixes", () => {
  const claimed = new Set<string>();

  assert.equal(allocateXanoScriptFilename("shared", undefined, claimed).filename, "shared.xs");
  assert.equal(allocateXanoScriptFilename("shared", undefined, claimed).filename, "shared_2.xs");
  assert.equal(allocateXanoScriptFilename("shared", "", claimed).filename, "shared_3.xs");
});

test("repeated IDs fall back instead of reclaiming an occupied filename", () => {
  const claimed = new Set<string>();

  assert.equal(allocateXanoScriptFilename("shared", 202, claimed).filename, "shared.xs");
  assert.equal(allocateXanoScriptFilename("shared", 202, claimed).filename, "shared_202.xs");
  assert.equal(allocateXanoScriptFilename("shared", 202, claimed).filename, "shared_2.xs");
  assert.equal(claimed.size, 3);
});

test("unique names preserve the existing filename shape", () => {
  const claimed = new Set<string>();

  assert.equal(allocateXanoScriptFilename("first object", 1, claimed).filename, "first object.xs");
  assert.equal(allocateXanoScriptFilename("second-object", 2, claimed).filename, "second-object.xs");
});

test("every successful generation remains as a distinct file with its own script", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-collision-"));
  const claimed = new Set<string>();

  retainXanoScriptFile(outputDir, "same/name", 101, "// first", claimed);
  retainXanoScriptFile(outputDir, "same?name", 202, "// second", claimed);

  assert.deepEqual(readdirSync(outputDir).sort(), ["same_name.xs", "same_name_202.xs"]);
  assert.equal(readFileSync(join(outputDir, "same_name.xs"), "utf8"), "// first");
  assert.equal(readFileSync(join(outputDir, "same_name_202.xs"), "utf8"), "// second");
  assert.equal(claimed.size, 2);
});
