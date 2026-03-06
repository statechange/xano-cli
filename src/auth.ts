/**
 * StateChange CLI Authentication
 * Manages long-lived API key from file, env var, or command line
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const AUTH_FILE_PATH = join(homedir(), ".statechange", "auth.json");

export interface AuthConfig {
  apiKey: string;
  authToken?: string;
  authTokenExpires?: number;
  xanoInstance?: string;
  xanoWorkspace?: number;
}

export function getAuthFilePath(): string {
  return AUTH_FILE_PATH;
}

export function loadAuthFromFile(): AuthConfig | null {
  try {
    const content = readFileSync(AUTH_FILE_PATH, "utf-8");
    const config = JSON.parse(content) as AuthConfig;
    if (!config.apiKey) return null;
    return config;
  } catch (e) {
    return null;
  }
}

export function saveAuthToFile(config: AuthConfig): void {
  const dir = join(homedir(), ".statechange");
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    // Directory might already exist
  }
  writeFileSync(AUTH_FILE_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function getStateChangeApiKey(options?: { apiKey?: string }): string | null {
  // 1. Command line flag
  if (options?.apiKey) return options.apiKey;
  // 2. Environment variable
  if (process.env.STATECHANGE_API_KEY) return process.env.STATECHANGE_API_KEY;
  // 3. Auth file
  const auth = loadAuthFromFile();
  if (auth?.apiKey) return auth.apiKey;
  return null;
}

const STATECHANGE_BACKEND_URL = "https://api.statechange.ai/api:jKMCYXQa/";

/**
 * Exchange API key for auth token
 */
export async function getAuthToken(apiKey: string): Promise<string> {
  // Check if we have a cached valid token
  const auth = loadAuthFromFile();
  if (
    auth?.authToken &&
    auth?.authTokenExpires &&
    Date.now() < auth.authTokenExpires
  ) {
    return auth.authToken;
  }

  // Exchange API key for token
  const response = await fetch(`${STATECHANGE_BACKEND_URL}auth/key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key: apiKey }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new Error("Invalid or expired API key");
    }
    throw new Error(
      `Failed to authenticate: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const data = (await response.json()) as { token: string };
  const token = data.token;

  // Cache the token (expires in 24 hours, cache for 23 hours to be safe)
  const expiresAt = Date.now() + 23 * 60 * 60 * 1000; // 23 hours in milliseconds
  if (auth) {
    auth.authToken = token;
    auth.authTokenExpires = expiresAt;
    saveAuthToFile(auth);
  } else {
    // Create new config with just the token (API key should already be saved)
    const newAuth = loadAuthFromFile();
    if (newAuth) {
      newAuth.authToken = token;
      newAuth.authTokenExpires = expiresAt;
      saveAuthToFile(newAuth);
    }
  }

  return token;
}
