import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import * as readline from "readline";

const CONFIG_DIR = join(homedir(), ".claude-coach");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DB_FILE = join(CONFIG_DIR, "coach.db");

// intervals.icu auth is a single, non-expiring API key (no OAuth, no refresh
// tokens) - so unlike the original Strava version, there's no separate
// tokens.json: everything needed to sync lives in one small config file.
export interface Credentials {
  athlete_id: string; // e.g. "i647318"
  api_key: string;
}

export interface Config {
  intervals: Credentials;
  sync_days: number;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getDbPath(): string {
  return DB_FILE;
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function loadConfig(): Config {
  if (!configExists()) {
    throw new Error(
      `Config not found at ${CONFIG_FILE}. Run sync with your intervals.icu credentials first.`
    );
  }
  const data = readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(data);
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function createConfig(athlete_id: string, api_key: string, sync_days = 730): Config {
  return {
    intervals: { athlete_id, api_key },
    sync_days,
  };
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptForConfig(): Promise<Config> {
  console.log("\n🏃 Claude Coach Setup\n");
  console.log("To use this tool, you need an intervals.icu Athlete ID and API Key.");
  console.log('Find both at: https://intervals.icu/settings (under "Developer Settings")\n');

  const athlete_id = await prompt("Enter your intervals.icu Athlete ID (e.g. i123456): ");
  const api_key = await prompt("Enter your intervals.icu API Key: ");
  const sync_days_str = await prompt("Days of history to sync (default 730): ");
  const sync_days = parseInt(sync_days_str) || 730;

  return createConfig(athlete_id, api_key, sync_days);
}
