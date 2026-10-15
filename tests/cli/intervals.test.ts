import { describe, it, expect } from "vitest";
import type { IntervalsActivity, IntervalsAthlete } from "../src/intervals/types.js";

describe("Intervals.icu Types", () => {
  describe("IntervalsActivity", () => {
    it("should have required fields", () => {
      const activity: IntervalsActivity = {
        id: "i12345678",
        name: "Morning Run",
        type: "Run",
        start_date: "2024-01-15T07:30:00Z",
        start_date_local: "2024-01-15T08:30:00",
        elapsed_time: 3600,
        moving_time: 3500,
        distance: 10000,
      };

      expect(activity.id).toBe("i12345678");
      expect(activity.name).toBe("Morning Run");
      expect(activity.type).toBe("Run");
      expect(activity.distance).toBe(10000);
    });

    it("should allow optional fields", () => {
      const activity: IntervalsActivity = {
        id: "i12345678",
        name: "Ride with Power",
        type: "Ride",
        start_date: "2024-01-15T07:30:00Z",
        start_date_local: "2024-01-15T08:30:00",
        elapsed_time: 7200,
        moving_time: 7000,
        distance: 50000,
        total_elevation_gain: 500,
        icu_average_watts: 200,
        icu_weighted_avg_watts: 215,
        average_heartrate: 145,
        max_heartrate: 175,
        icu_training_load: 120,
        race: false,
        device_name: "Garmin fenix 6 Pro",
        source: "GARMIN_CONNECT",
      };

      expect(activity.icu_average_watts).toBe(200);
      expect(activity.average_heartrate).toBe(145);
      expect(activity.icu_training_load).toBe(120);
      expect(activity.device_name).toBe("Garmin fenix 6 Pro");
    });
  });

  describe("IntervalsAthlete", () => {
    it("should have required fields", () => {
      const athlete: IntervalsAthlete = {
        id: "i99999",
      };

      expect(athlete.id).toBe("i99999");
    });

    it("should allow optional fields", () => {
      const athlete: IntervalsAthlete = {
        id: "i99999",
        firstname: "Jane",
        lastname: "Smith",
        icu_weight: 65.5,
        icu_resting_hr: 48,
      };

      expect(athlete.icu_weight).toBe(65.5);
      expect(athlete.icu_resting_hr).toBe(48);
    });
  });
});

describe("Intervals.icu API Helpers", () => {
  describe("URL construction", () => {
    it("should build correct activities URL", () => {
      const API_BASE = "https://intervals.icu/api/v1";
      const athleteId = "i647318";
      const oldest = "2024-01-01";
      const newest = "2024-06-01";

      const url = new URL(`${API_BASE}/athlete/${athleteId}/activities`);
      url.searchParams.set("oldest", oldest);
      url.searchParams.set("newest", newest);

      expect(url.toString()).toBe(
        "https://intervals.icu/api/v1/athlete/i647318/activities?oldest=2024-01-01&newest=2024-06-01"
      );
    });
  });

  describe("Basic auth header", () => {
    it("should encode API_KEY:apiKey as base64", () => {
      const apiKey = "testkey123";
      const header = "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");

      expect(header).toBe("Basic " + Buffer.from("API_KEY:testkey123").toString("base64"));
      expect(header.startsWith("Basic ")).toBe(true);
    });
  });

  describe("Date range chunking", () => {
    it("should produce windows that fully cover the requested range", () => {
      const CHUNK_DAYS = 120;
      const start = new Date("2023-01-01");
      const end = new Date("2025-01-01");

      const windows: Array<[Date, Date]> = [];
      let cursor = new Date(start);
      while (cursor < end) {
        const next = new Date(cursor);
        next.setDate(next.getDate() + CHUNK_DAYS);
        const effectiveEnd = next > end ? end : next;
        windows.push([new Date(cursor), effectiveEnd]);
        cursor = effectiveEnd;
      }

      expect(windows[0][0].toISOString().slice(0, 10)).toBe("2023-01-01");
      expect(windows[windows.length - 1][1].toISOString().slice(0, 10)).toBe("2025-01-01");
      // No gaps: each window's end is the next window's start
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i][0].getTime()).toBe(windows[i - 1][1].getTime());
      }
    });
  });
});

describe("SQL Escaping", () => {
  function escapeString(str: string | null | undefined): string {
    if (str == null) return "NULL";
    return `'${str.replace(/'/g, "''")}'`;
  }

  it("should escape single quotes", () => {
    expect(escapeString("O'Reilly")).toBe("'O''Reilly'");
    expect(escapeString("It's a test")).toBe("'It''s a test'");
  });

  it("should handle null and undefined", () => {
    expect(escapeString(null)).toBe("NULL");
    expect(escapeString(undefined)).toBe("NULL");
  });

  it("should wrap normal strings in quotes", () => {
    expect(escapeString("hello")).toBe("'hello'");
    expect(escapeString("Morning Run")).toBe("'Morning Run'");
  });

  it("should handle empty strings", () => {
    expect(escapeString("")).toBe("''");
  });
});

describe("FTP derivation", () => {
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

  const base: Omit<IntervalsActivity, "id" | "type" | "start_date_local" | "icu_ftp"> = {
    name: "x",
    start_date: "2024-01-01T00:00:00Z",
    elapsed_time: 3600,
    moving_time: 3600,
    distance: 30000,
  };

  it("picks the most recent cycling activity's FTP", () => {
    const activities: IntervalsActivity[] = [
      { ...base, id: "1", type: "Ride", start_date_local: "2024-01-01T08:00:00", icu_ftp: 200 },
      { ...base, id: "2", type: "Run", start_date_local: "2024-03-01T08:00:00", icu_ftp: null },
      {
        ...base,
        id: "3",
        type: "VirtualRide",
        start_date_local: "2024-02-01T08:00:00",
        icu_ftp: 210,
      },
    ];

    expect(deriveFtp(activities)).toBe(210);
  });

  it("returns null when no cycling activity has an FTP", () => {
    const activities: IntervalsActivity[] = [
      { ...base, id: "1", type: "Run", start_date_local: "2024-01-01T08:00:00", icu_ftp: null },
    ];

    expect(deriveFtp(activities)).toBeNull();
  });
});
