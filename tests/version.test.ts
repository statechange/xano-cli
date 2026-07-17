import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

interface PackageMetadata {
  version: string;
}

test("the source CLI reports the authoritative package version", () => {
  const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageMetadata;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/index.ts", "--version"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), metadata.version);
});
