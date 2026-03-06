/**
 * Shared output formatting utilities
 */

export type OutputFormat = "table" | "json" | "yaml";

export const FORMAT_HELP = "Output format: table (human-readable), json, or yaml (recommended for AI/LLM consumption)";

export function parseFormat(value: string): OutputFormat {
  if (value === "json" || value === "yaml" || value === "table") return value;
  console.error(`Error: Invalid format "${value}". Use table, json, or yaml.`);
  process.exit(1);
}

export function toYaml(obj: any, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return `${pad}null`;
  if (typeof obj === "string") {
    if (obj.includes("\n") || obj.includes(": ") || obj.includes("#") || obj.includes("'") || /^\d/.test(obj) || obj === "" || obj === "true" || obj === "false" || obj === "null") {
      return `${pad}"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return `${pad}${obj}`;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return `${pad}${obj}`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return `${pad}[]`;
    return obj.map((item) => {
      if (typeof item === "object" && item !== null) {
        const inner = toYaml(item, indent + 1).trimStart();
        return `${pad}- ${inner}`;
      }
      return `${pad}- ${toYaml(item, 0).trimStart()}`;
    }).join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return `${pad}{}`;
    return entries.map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        return `${pad}${key}:\n${toYaml(value, indent + 1)}`;
      }
      return `${pad}${key}: ${toYaml(value, 0).trimStart()}`;
    }).join("\n");
  }
  return `${pad}${String(obj)}`;
}

/** Output data in the requested format. For json/yaml, prints to stdout. Returns true if handled. */
export function outputFormatted(format: OutputFormat, data: any): boolean {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2));
    return true;
  }
  if (format === "yaml") {
    console.log(toYaml(data));
    return true;
  }
  return false;
}
