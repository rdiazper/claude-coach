import {
  configExists,
  ensureConfigDir,
  loadConfig,
  promptForConfig,
  saveConfig,
  getDbPath,
  createConfig,
  type Credentials,
} from "./lib/config.js";
import { log } from "./lib/logging.js";
import { migrate } from "./db/migrate.js";
import { execute, initDatabase, query, queryJson } from "./db/client.js";
import { getAllActivities, getAthlete } from "./intervals/api.js";
import type { IntervalsActivity, IntervalsAthlete } from "./intervals/types.js";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Proxy Configuration
// ============================================================================

// Configure proxy for fetch() if HTTP_PROXY or HTTPS_PROXY is set
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface SyncArgs {
  command: "sync";
  athleteId?: string;
  apiKey?: string;
  days?: number;
}

interface RenderArgs {
  command: "render";
  inputFile: string;
  outputFile?: string;
}

interface QueryArgs {
  command: "query";
  sql: string;
  json: boolean;
}

interface AuthArgs {
  command: "auth";
  athleteId?: string;
  apiKey?: string;
}

interface HelpArgs {
  command: "help";
}

type CliArgs = SyncArgs | RenderArgs | QueryArgs | AuthArgs | HelpArgs;

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "sync") {
    const syncArgs: SyncArgs = { command: "sync" };

    for (const arg of args) {
      if (arg.startsWith("--athlete-id=")) {
        syncArgs.athleteId = arg.split("=")[1];
      } else if (arg.startsWith("--api-key=")) {
        syncArgs.apiKey = arg.split("=")[1];
      } else if (arg.startsWith("--days=")) {
        syncArgs.days = parseInt(arg.split("=")[1]);
      }
    }

    return syncArgs;
  }

  if (args[0] === "render") {
    if (!args[1]) {
      log.error("render command requires an input file");
      process.exit(1);
    }

    const renderArgs: RenderArgs = {
      command: "render",
      inputFile: args[1],
    };

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--output" || args[i] === "-o") {
        renderArgs.outputFile = args[i + 1];
        i++;
      } else if (args[i].startsWith("--output=")) {
        renderArgs.outputFile = args[i].split("=")[1];
      }
    }

    return renderArgs;
  }

  if (args[0] === "query") {
    if (!args[1]) {
      log.error("query command requires a SQL statement");
      process.exit(1);
    }

    const queryArgs: QueryArgs = {
      command: "query",
      sql: args[1],
      json: args.includes("--json"),
    };

    return queryArgs;
  }

  if (args[0] === "auth") {
    const authArgs: AuthArgs = { command: "auth" };

    for (const arg of args) {
      if (arg.startsWith("--athlete-id=")) {
        authArgs.athleteId = arg.split("=")[1];
      } else if (arg.startsWith("--api-key=")) {
        authArgs.apiKey = arg.split("=")[1];
      }
    }

    return authArgs;
  }

  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    return { command: "help" };
  }

  log.error(`Unknown command: ${args[0]}`);
  process.exit(1);
}

function printHelp(): void {
  console.log(`
Claude Coach - Training Plan Tools

Usage: npx claude-coach <command> [options]

Commands:
  sync              Sync activities from intervals.icu
  auth              Validate and save intervals.icu credentials (no sync)
  render <file>     Render a training plan JSON to HTML
  query <sql>       Run a SQL query against the database
  help              Show this help message

Credentials (find both at https://intervals.icu/settings -> Developer Settings):
  --athlete-id=ID   intervals.icu Athlete ID (e.g. i123456)
  --api-key=KEY     intervals.icu API Key

  Both commands accept credentials via flags (headless/Claude environments)
  or, if omitted and no config exists yet, will prompt for them interactively.
  Credentials are saved to ~/.claude-coach/config.json after the first run.

Sync Options:
  --days=N          Days of history to sync (default: 730)

Render Options:
  --output, -o FILE Output HTML file (default: <input>.html)

Query Options:
  --json            Output as JSON (default: plain text)

Examples:
  # First-time setup + sync (headless/Claude environments)
  npx claude-coach sync --athlete-id=i123456 --api-key=yourapikeyhere

  # Validate credentials without syncing
  npx claude-coach auth --athlete-id=i123456 --api-key=yourapikeyhere

  # Later syncs reuse the saved config
  npx claude-coach sync

  # Render a training plan to HTML
  npx claude-coach render plan.json --output my-plan.html

  # Query the database
  npx claude-coach query "SELECT * FROM weekly_volume LIMIT 5"
`);
}

// ============================================================================
// Credential Resolution
// ============================================================================

async function resolveCredentials(
  athleteId: string | undefined,
  apiKey: string | undefined,
  syncDays: number
): Promise<Credentials> {
  if (athleteId && apiKey) {
    // Always persist explicitly-provided credentials, even over an existing
    // config - otherwise fixing a bad Athlete ID/API Key still requires
    // manually deleting ~/.claude-coach/config.json before the correction
    // sticks for future bare `sync` calls.
    saveConfig(createConfig(athleteId, apiKey, syncDays));
    return { athlete_id: athleteId, api_key: apiKey };
  }

  if (configExists()) {
    return loadConfig().intervals;
  }

  log.info("No configuration found. Let's set things up.");
  const config = await promptForConfig();
  saveConfig(config);
  log.success("Configuration saved");
  return config.intervals;
}

// ============================================================================
// Auth Command
// ============================================================================

async function runAuth(args: AuthArgs): Promise<void> {
  ensureConfigDir();
  const creds = await resolveCredentials(args.athleteId, args.apiKey, 730);

  log.start("Validating credentials against intervals.icu...");
  const athlete = await getAthlete(creds);

  saveConfig(createConfig(creds.athlete_id, creds.api_key, loadConfig().sync_days ?? 730));
  log.success(`Authenticated as ${athlete.name || athlete.firstname || creds.athlete_id}`);
  log.ready("Now run: npx claude-coach sync");
}

// ============================================================================
// Sync Command
// ============================================================================

function escapeString(str: string | null | undefined): string {
  if (str == null) return "NULL";
  return `'${str.replace(/'/g, "''")}'`;
}

function toBit(value: boolean | undefined): number {
  return value ? 1 : 0;
}

function insertActivity(activity: IntervalsActivity): void {
  const sql = `
    INSERT OR REPLACE INTO activities (
      id, name, sport_type, start_date, elapsed_time, moving_time,
      distance, total_elevation_gain, average_speed, max_speed,
      average_heartrate, max_heartrate, average_watts,
      weighted_average_watts, training_load, average_cadence,
      calories, description, race, ftp, device_name, source,
      external_id, raw_json, synced_at
    ) VALUES (
      ${escapeString(activity.id)},
      ${escapeString(activity.name)},
      ${escapeString(activity.type)},
      ${escapeString(activity.start_date_local)},
      ${activity.elapsed_time ?? "NULL"},
      ${activity.moving_time ?? "NULL"},
      ${activity.distance ?? "NULL"},
      ${activity.total_elevation_gain ?? "NULL"},
      ${activity.average_speed ?? "NULL"},
      ${activity.max_speed ?? "NULL"},
      ${activity.average_heartrate ?? "NULL"},
      ${activity.max_heartrate ?? "NULL"},
      ${activity.icu_average_watts ?? "NULL"},
      ${activity.icu_weighted_avg_watts ?? "NULL"},
      ${activity.icu_training_load ?? "NULL"},
      ${activity.average_cadence ?? "NULL"},
      ${activity.calories ?? "NULL"},
      ${escapeString(activity.description)},
      ${toBit(activity.race)},
      ${activity.icu_ftp ?? "NULL"},
      ${escapeString(activity.device_name)},
      ${escapeString(activity.source)},
      ${escapeString(activity.external_id)},
      ${escapeString(JSON.stringify(activity))},
      datetime('now')
    );
  `;

  execute(sql);
}

// Cycling sport types as reported by intervals.icu's `type` field - used to find
// the most recent FTP figure for the athlete profile.
const CYCLING_TYPES = new Set([
  "Ride",
  "VirtualRide",
  "GravelRide",
  "MountainBikeRide",
  "EBikeRide",
]);

function deriveFtp(activities: IntervalsActivity[]): number | null {
  const rides = activities
    .filter((a) => CYCLING_TYPES.has(a.type) && a.icu_ftp != null)
    .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));
  return rides.length > 0 ? (rides[0].icu_ftp as number) : null;
}

function deriveMaxHeartrate(activities: IntervalsActivity[]): number | null {
  const values = activities.map((a) => a.max_heartrate).filter((v): v is number => v != null);
  return values.length > 0 ? Math.max(...values) : null;
}

function insertAthlete(
  athlete: IntervalsAthlete,
  ftp: number | null,
  maxHeartrate: number | null
): void {
  const sql = `
    INSERT OR REPLACE INTO athlete (id, firstname, lastname, weight, ftp, max_heartrate, resting_hr, raw_json, updated_at)
    VALUES (
      ${escapeString(athlete.id)},
      ${escapeString(athlete.firstname || athlete.name)},
      ${escapeString(athlete.lastname)},
      ${athlete.icu_weight ?? "NULL"},
      ${ftp ?? "NULL"},
      ${maxHeartrate ?? "NULL"},
      ${athlete.icu_resting_hr ?? "NULL"},
      ${escapeString(JSON.stringify(athlete))},
      datetime('now')
    );
  `;
  execute(sql);
}

async function runSync(args: SyncArgs): Promise<void> {
  log.box("Claude Coach - intervals.icu Sync");

  // ensureConfigDir() must run before initDatabase(): the SQLite backend opens
  // a file inside ~/.claude-coach/ directly and throws if that directory
  // doesn't exist yet - the exact state of a brand-new install.
  ensureConfigDir();
  await initDatabase();
  migrate();

  const syncDays = args.days || (configExists() ? loadConfig().sync_days : 730) || 730;
  const creds = await resolveCredentials(args.athleteId, args.apiKey, syncDays);

  log.start("Validating credentials and fetching athlete profile...");
  const athlete = await getAthlete(creds);
  log.success(`Authenticated as ${athlete.name || athlete.firstname || creds.athlete_id}`);

  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - syncDays);
  const activities = await getAllActivities(creds, afterDate);

  insertAthlete(athlete, deriveFtp(activities), deriveMaxHeartrate(activities));

  log.start("Storing activities in database...");
  let count = 0;
  for (const activity of activities) {
    insertActivity(activity);
    count++;
    if (count % 50 === 0) {
      log.progress(`   Stored ${count}/${activities.length}...`);
    }
  }
  log.progressEnd();
  log.success(`Stored ${activities.length} activities`);

  execute(`
    INSERT INTO sync_log (started_at, completed_at, activities_synced, status)
    VALUES (datetime('now'), datetime('now'), ${activities.length}, 'success');
  `);

  log.info(`Database: ${getDbPath()}`);
  log.ready(`Query with: npx claude-coach query "SELECT * FROM weekly_volume"`);
}

// ============================================================================
// Render Command
// ============================================================================

function getTemplatePath(): string {
  const locations = [
    join(__dirname, "..", "templates", "plan-viewer.html"),
    join(__dirname, "..", "..", "templates", "plan-viewer.html"),
    join(process.cwd(), "templates", "plan-viewer.html"),
  ];

  for (const loc of locations) {
    try {
      readFileSync(loc);
      return loc;
    } catch {
      // Continue to next location
    }
  }

  throw new Error("Could not find plan-viewer.html template");
}

function runRender(args: RenderArgs): void {
  log.start("Rendering training plan...");

  let planJson: string;
  try {
    planJson = readFileSync(args.inputFile, "utf-8");
  } catch (err) {
    log.error(`Could not read input file: ${args.inputFile}`);
    process.exit(1);
  }

  try {
    JSON.parse(planJson);
  } catch (err) {
    log.error("Input file is not valid JSON");
    process.exit(1);
  }

  const templatePath = getTemplatePath();
  let template = readFileSync(templatePath, "utf-8");

  const planDataRegex = /<script type="application\/json" id="plan-data">[\s\S]*?<\/script>/;
  const newPlanData = `<script type="application/json" id="plan-data">\n${planJson}\n</script>`;
  template = template.replace(planDataRegex, newPlanData);

  if (args.outputFile) {
    writeFileSync(args.outputFile, template);
    log.success(`Training plan rendered to: ${args.outputFile}`);
  } else {
    console.log(template);
  }
}

// ============================================================================
// Query Command
// ============================================================================

async function runQuery(args: QueryArgs): Promise<void> {
  await initDatabase();

  if (args.json) {
    const results = queryJson(args.sql);
    console.log(JSON.stringify(results, null, 2));
  } else {
    const result = query(args.sql);
    console.log(result);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs();

  switch (args.command) {
    case "help":
      printHelp();
      break;
    case "auth":
      await runAuth(args);
      break;
    case "sync":
      await runSync(args);
      break;
    case "render":
      runRender(args);
      break;
    case "query":
      await runQuery(args);
      break;
  }
}

main().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
