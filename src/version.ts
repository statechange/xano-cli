import { readFileSync } from "node:fs";

interface PackageMetadata {
  version?: unknown;
}

function readPackageVersion(): string {
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const metadata = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as PackageMetadata;

  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error(`Missing package version in ${packageJsonUrl.pathname}`);
  }

  return metadata.version;
}

/** The CLI version, sourced from the package metadata shipped beside dist/. */
export const packageVersion = readPackageVersion();
