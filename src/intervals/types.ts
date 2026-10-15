// Types for the intervals.icu REST API (https://intervals.icu/api-docs.html).
//
// Field names below were confirmed against a live response from
// GET /api/v1/athlete/{id}/activities and GET /api/v1/athlete/{id} - intervals.icu's
// activity objects carry 150+ fields (weather, power-duration curve, zone splits, etc.);
// only the ones this tool actually uses are typed here.

export interface IntervalsAthlete {
  id: string; // e.g. "i647318"
  name?: string;
  firstname?: string;
  lastname?: string;
  icu_weight?: number | null; // kg
  icu_resting_hr?: number | null;
  // intervals.icu does not expose a single "FTP" on the athlete profile - FTP is
  // tracked per activity (see IntervalsActivity.icu_ftp) and can change over time.
  // We derive a current FTP from the most recent cycling activity during sync.
}

export interface IntervalsActivity {
  id: string; // e.g. "i197315651" - NOT numeric, unlike Strava's activity id
  name: string;
  type: string; // sport, e.g. "Run", "Ride", "VirtualRide", "WeightTraining", "Elliptical", "Swim"
  description?: string | null;

  start_date: string; // ISO 8601 UTC
  start_date_local: string; // ISO 8601 in the athlete's local timezone - used for all date grouping

  elapsed_time: number; // seconds
  moving_time: number; // seconds
  distance: number; // meters
  total_elevation_gain?: number; // meters

  average_speed?: number; // m/s
  max_speed?: number; // m/s

  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;

  icu_average_watts?: number; // average power (direct or estimated)
  icu_weighted_avg_watts?: number; // normalized/weighted power

  calories?: number;

  // intervals.icu's own computed training load for the activity - the direct
  // equivalent of Strava's "suffer score" (roughly TRIMP/TSS depending on what
  // data the activity has: power, pace, or HR).
  icu_training_load?: number;

  // true when the athlete tagged the activity as a race. Simpler and more
  // reliable than Strava's workout_type integer (0=default, 1=race, 2=workout, 3=long run).
  race?: boolean;

  // FTP in effect at the time of this (cycling) activity.
  icu_ftp?: number | null;

  // Device/source metadata - useful for spotting activities that arrived via
  // upload rather than a direct device sync (see device_name/source notes in
  // the README "Known limitations" section).
  device_name?: string | null;
  source?: string | null; // e.g. "GARMIN_CONNECT", "UPLOAD", "OAUTH_CLIENT", "MANUAL"
  external_id?: string | null;
}

export interface IntervalsStreamSet {
  // GET /api/v1/activity/{id}/streams returns an array of these, one per stream type.
  type: string; // "time" | "watts" | "heartrate" | "cadence" | "distance" | "altitude" | "velocity_smooth" | ...
  data: number[];
}
