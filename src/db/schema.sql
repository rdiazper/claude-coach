-- Core activity data (source: intervals.icu REST API)
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,              -- intervals.icu activity ID, e.g. "i197315651" (not numeric)
  name TEXT,
  sport_type TEXT,                  -- intervals.icu's `type` field: Run, Ride, VirtualRide, WeightTraining, etc.
  start_date TEXT,                  -- local time (intervals.icu's start_date_local) - used for all date grouping below
  elapsed_time INTEGER,             -- seconds
  moving_time INTEGER,              -- seconds
  distance REAL,                    -- meters
  total_elevation_gain REAL,        -- meters
  average_speed REAL,               -- m/s
  max_speed REAL,                   -- m/s
  average_heartrate REAL,
  max_heartrate REAL,
  average_watts REAL,               -- icu_average_watts: direct or estimated average power
  weighted_average_watts REAL,      -- icu_weighted_avg_watts: normalized power
  training_load INTEGER,            -- icu_training_load: intervals.icu's TSS-equivalent effort score
  average_cadence REAL,
  calories REAL,
  description TEXT,
  race INTEGER,                     -- 0/1, intervals.icu's race flag (replaces Strava's workout_type)
  ftp INTEGER,                      -- FTP in effect at the time of this (cycling) activity
  device_name TEXT,                 -- e.g. "Garmin fenix 6 Pro", "GARMIN EDGE_530", "Watch6,18"
  source TEXT,                      -- GARMIN_CONNECT | UPLOAD | OAUTH_CLIENT | MANUAL
  external_id TEXT,
  raw_json TEXT,                    -- full intervals.icu response as JSON
  synced_at TEXT DEFAULT (datetime('now'))
);

-- Time-series streams (HR, power, pace over time)
CREATE TABLE IF NOT EXISTS streams (
  activity_id TEXT PRIMARY KEY,
  time_data TEXT,                   -- JSON array: seconds from start
  distance_data TEXT,               -- JSON array: cumulative meters
  heartrate_data TEXT,              -- JSON array
  watts_data TEXT,                  -- JSON array
  cadence_data TEXT,                -- JSON array
  altitude_data TEXT,               -- JSON array
  velocity_data TEXT,               -- JSON array: m/s
  FOREIGN KEY (activity_id) REFERENCES activities(id)
);

-- Athlete profile
CREATE TABLE IF NOT EXISTS athlete (
  id TEXT PRIMARY KEY,              -- intervals.icu athlete ID, e.g. "i647318"
  firstname TEXT,
  lastname TEXT,
  weight REAL,                      -- kg (icu_weight)
  ftp INTEGER,                      -- derived from the most recent cycling activity's icu_ftp
                                     -- (intervals.icu does not expose a single FTP on the athlete profile)
  max_heartrate INTEGER,            -- derived as MAX(max_heartrate) across synced activities
  resting_hr INTEGER,               -- icu_resting_hr
  raw_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Training goals
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT,                  -- "Ironman 70.3 Oceanside"
  event_date TEXT,                  -- ISO 8601
  event_type TEXT,                  -- triathlon, marathon, ultra, century
  notes TEXT,                       -- constraints, injuries, etc.
  created_at TEXT DEFAULT (datetime('now'))
);

-- Sync metadata
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  completed_at TEXT,
  activities_synced INTEGER,
  status TEXT                       -- success, failed, partial
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(start_date);
CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport_type);
CREATE INDEX IF NOT EXISTS idx_activities_sport_date ON activities(sport_type, start_date);

-- Useful views
DROP VIEW IF EXISTS weekly_volume;
CREATE VIEW weekly_volume AS
SELECT
  strftime('%Y-W%W', start_date) AS week,
  sport_type,
  COUNT(*) AS sessions,
  ROUND(SUM(moving_time) / 3600.0, 1) AS hours,
  ROUND(SUM(distance) / 1000.0, 1) AS km,
  ROUND(AVG(average_heartrate), 0) AS avg_hr,
  ROUND(AVG(training_load), 0) AS avg_load
FROM activities
GROUP BY week, sport_type
ORDER BY week DESC, sport_type;

DROP VIEW IF EXISTS recent_activities;
CREATE VIEW recent_activities AS
SELECT
  date(start_date) AS date,
  sport_type,
  name,
  moving_time / 60 AS minutes,
  ROUND(distance / 1000.0, 1) AS km,
  ROUND(average_heartrate, 0) AS hr,
  training_load
FROM activities
ORDER BY start_date DESC
LIMIT 50;
