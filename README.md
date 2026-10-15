# Claude Coach (intervals.icu fork)

This is a fork of [felixrieseberg/claude-coach](https://github.com/felixrieseberg/claude-coach), with the data source swapped from Strava to [intervals.icu](https://intervals.icu). Everything else - the coaching skill, the periodization logic, the interactive training-plan viewer, the export formats - is unchanged.

Claude Coach lets you use Claude to build a custom-tailored training plan for a triathlon, marathon, or other endurance event. It looks at your actual training history - weekly volume, long-session patterns, HR and power data, consistency - and designs a periodized plan around it instead of a generic template. The output is an interactive HTML training plan you can edit, mark workouts complete on, and export to your calendar or training apps.

## Why intervals.icu instead of Strava

- **One credential, not an OAuth dance.** Strava requires creating an API app, running a local callback server, opening a browser, authorizing, and pasting back a redirect URL. intervals.icu just needs an Athlete ID and an API Key, both visible on one settings page. No browser round-trip, no expiring tokens to refresh.
- **It's already a data hub.** Most athletes don't get their training data from one source - a watch for runs, a separate head unit for rides, a manual upload for a gym session logged elsewhere. intervals.icu is commonly used specifically to merge all of that into one account (Garmin, Wahoo, TrainerRoad, manual `.fit` uploads, and more), so syncing it here picks up everything in one pass instead of only whatever one platform happened to receive directly.
- **Richer training-load data.** intervals.icu computes its own training load figure per activity (`icu_training_load`) along with rolling CTL/ATL, which this fork uses as the load metric instead of Strava's proprietary suffer score.

## Examples

The training-plan JSON schema and HTML viewer are unchanged from upstream, so the original project's example plans are a good preview of the output: [felixrieseberg.github.io/claude-coach](https://felixrieseberg.github.io/claude-coach/#demos).

## Installation & Creating a Training Plan

You need access to Claude.ai or Claude Code with network access for Skills. Depending on user/admin settings, Skills may have full, partial, or no network access.

Syncing your intervals.icu history and creating a tailored training plan takes about 10 minutes.

### Installing the Skill

Build the skill package from this repo (see "Building from source" below), or grab it from this fork's own GitHub Releases if you've published one.

**Claude.ai:**

1. Open [Claude.ai Settings](https://claude.ai/settings/capabilities)
2. Enable "Code execution and file creation"
3. In the allowed domains list, add `intervals.icu`
4. Scroll down to "Skills" and click "Add skill", then upload `coach-skill.zip`

**Claude Code:**

Claude Code loads skills from `~/.claude/skills/<skill-name>/` (available in all your projects) or `.claude/skills/<skill-name>/` (a single project). Extract `coach-skill.zip` into a `coach` folder in either location, so that `SKILL.md` ends up at `~/.claude/skills/coach/SKILL.md` (or `.claude/skills/coach/SKILL.md`):

```sh
mkdir -p ~/.claude/skills/coach
unzip -o ~/Downloads/coach-skill.zip -d ~/.claude/skills/coach
```

Then start a new Claude Code session (or restart a running one) so it picks up the skill. See the [Claude Code skills documentation](https://code.claude.com/docs/en/skills) for details.

### Creating a Plan

Use the most capable model available to you. Prompt Claude with something like:

> Help me create a training plan for the Ironman 70.3 Oceanside on March 29th 2026 using the "coach" skill.

Claude will ask how you'd like to provide your fitness data: manually, or by connecting intervals.icu. Connecting intervals.icu is recommended - data beats guesswork, and Claude can build a plan that actually fits your current fitness.

#### Option 1: Connect to intervals.icu (Recommended)

Claude needs an **Athlete ID** and an **API Key** to read your activities. You're only giving Claude read access to your own data - nobody else sees it, and intervals.icu lets you revoke the key at any time.

1. Go to [intervals.icu/settings](https://intervals.icu/settings) and log in
2. Scroll to **Developer Settings**
3. Your **Athlete ID** is shown there (it looks like `i123456`)
4. Click **Generate New Key** (or copy your existing one) to get your **API Key**
5. Give both to Claude when prompted

#### Option 2: Manual Entry

Don't use intervals.icu, or prefer not to connect it? Tell Claude about your fitness directly. Be ready to share:

**Current Training (recent 4-8 weeks):**

- Weekly training hours by sport (swim/bike/run)
- Typical long-session distances (longest ride, longest run, etc.)
- Training consistency (how many weeks have you been training regularly?)

**Performance Benchmarks (any you know):**

- Bike FTP (Functional Threshold Power) in watts
- Run threshold pace or recent race times (5K, 10K, half marathon, etc.)
- Swim CSS (Critical Swim Speed) or a recent time trial (e.g., 1000m time)
- Max heart rate and/or lactate threshold heart rate

### Telling Claude About Your Event & Constraints

Claude will also ask about yourself, your event, and any constraints to keep in mind - years in the sport, past races, recent breaks, injuries, schedule limitations, equipment access. The more detail you give it, the better the plan.

## Building from Source

```sh
npm install
npm run build        # builds the CLI, the viewer, and packages skill/ into dist/coach-skill.zip
```

`npm run dev` runs the CLI against `src/cli.ts` directly (via `tsx`) without a build step - handy while iterating on the intervals.icu integration. `npm test` runs the test suite.

## CLI Reference

```sh
# First-time setup + sync (headless/Claude environments)
npx claude-coach sync --athlete-id=i123456 --api-key=yourapikeyhere

# Validate credentials without syncing
npx claude-coach auth --athlete-id=i123456 --api-key=yourapikeyhere

# Later syncs reuse the saved config at ~/.claude-coach/config.json
npx claude-coach sync

# Render a training plan JSON to an interactive HTML viewer
npx claude-coach render plan.json --output my-plan.html

# Query the local SQLite database directly
npx claude-coach query "SELECT * FROM weekly_volume LIMIT 5" --json
```

Data lives in `~/.claude-coach/coach.db` (SQLite) and `~/.claude-coach/config.json` (your Athlete ID and API Key).

## Known Limitations of This Fork

- **Time-series streams (HR/power/pace curves) aren't synced yet.** The `streams` table exists in the schema but the sync command only populates activity summaries. The upstream Strava version had the same gap.
- **Athlete FTP and max heart rate are derived, not read directly.** intervals.icu doesn't expose a single FTP value on the athlete profile the way Strava does - FTP is tracked per cycling activity instead, so this fork uses the most recent one. Max HR is derived as the highest `max_heartrate` seen across synced activities.
- **No OAuth means no token scoping.** A Strava app can request a narrow `activity:read_all` scope. An intervals.icu API key grants broader account access (same key used for the website's own integrations). Treat it like a password: it's stored in `~/.claude-coach/config.json`, unencrypted, same as the original project stored Strava tokens.

## What Changed vs. Upstream

| Area                       | Upstream (Strava)                               | This fork (intervals.icu)                                           |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Auth                       | OAuth 2.0, local callback server, token refresh | Single API key (Basic auth), no expiry                              |
| `sync` / `auth` flags      | `--client-id` / `--client-secret` / `--code`    | `--athlete-id` / `--api-key`                                        |
| Activity ID                | Numeric                                         | String (e.g. `i197315651`)                                          |
| `activities.sport_type`    | Strava's `sport_type`                           | intervals.icu's `type`                                              |
| `activities.training_load` | `suffer_score`                                  | `icu_training_load`                                                 |
| `activities.race`          | `workout_type` integer (0-3)                    | `race` boolean                                                      |
| New columns                | -                                               | `device_name`, `source`, `external_id`, `ftp`; `athlete.resting_hr` |
| Removed dependency         | `open` (browser launcher for OAuth)             | -                                                                   |

## About

This fork is an independent project, not affiliated with or endorsed by Anthropic or by the upstream project's author. "Claude" is a trademark of Anthropic. License: MIT (see `LICENSE.md`), carried over from the upstream project by Felix Rieseberg.
