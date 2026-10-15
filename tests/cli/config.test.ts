import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We'll test the config functions by mocking the config directory
describe("Config", () => {
  const testDir = join(tmpdir(), "claude-coach-test-" + Date.now());
  const configFile = join(testDir, "config.json");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("config file operations", () => {
    it("should write and read config correctly", () => {
      // intervals.icu auth is a single non-expiring API key - no separate
      // tokens.json and no refresh-token dance, unlike the original Strava version.
      const config = {
        intervals: {
          athlete_id: "i123456",
          api_key: "secret123",
        },
        sync_days: 730,
      };

      writeFileSync(configFile, JSON.stringify(config, null, 2));

      expect(existsSync(configFile)).toBe(true);

      const loaded = JSON.parse(readFileSync(configFile, "utf-8"));
      expect(loaded.intervals.athlete_id).toBe("i123456");
      expect(loaded.intervals.api_key).toBe("secret123");
      expect(loaded.sync_days).toBe(730);
    });
  });
});
