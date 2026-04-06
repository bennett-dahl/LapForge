export enum SessionType {
  Practice1 = 'Practice 1',
  Practice2 = 'Practice 2',
  Practice3 = 'Practice 3',
  Qualifying = 'Qualifying',
  Race1 = 'Race 1',
  Race2 = 'Race 2',
}

export interface CarDriver {
  id: string;
  car_identifier: string;
  driver_name: string;
}

export interface TireSet {
  id: string;
  name: string;
  car_driver_id: string | null;
  morning_pressure_fl: number | null;
  morning_pressure_fr: number | null;
  morning_pressure_rl: number | null;
  morning_pressure_rr: number | null;
}

export interface BleedEvent {
  corner: string;
  bleed_type: string;
  psi_removed: number;
  lap_number?: number | null;
  tpms_before?: number | null;
  tpms_after?: number | null;
  notes?: string;
  timestamp?: string;
}

export interface Session {
  id: string;
  car_driver_id: string;
  session_type: SessionType;
  track: string;
  driver: string;
  car: string;
  outing_number: string;
  session_number: string;
  ambient_temp_c: number | null;
  track_temp_c: number | null;
  tire_set_id: string | null;
  roll_out_pressure_fl: number | null;
  roll_out_pressure_fr: number | null;
  roll_out_pressure_rl: number | null;
  roll_out_pressure_rr: number | null;
  target_pressure_psi: number | null;
  track_layout_id: string | null;
  lap_count_notes: string | null;
  planning_tag: string | null;
  bleed_events: BleedEvent[];
  file_path: string | null;
  parsed_data: Record<string, unknown> | null;
}

export interface Weekend {
  id: string;
  name: string;
  track: string;
  date_start: string;
  date_end: string;
  created_at: string;
  plan_count?: number;
}

export interface CornerPressures {
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

export interface PlanPressures {
  fl?: number | null;
  fr?: number | null;
  rl?: number | null;
  rr?: number | null;
  target?: number | null;
  notes?: string;
}

export interface ChecklistStep {
  key: string;
  label: string;
  required: boolean;
  status: 'not_started' | 'linked' | 'reviewed';
  session_ids: string[];
  notes: string;
}

export interface Plan {
  id: string;
  car_driver_id: string;
  weekend_id: string;
  session_ids: string[];
  checklist: ChecklistStep[];
  planning_mode: 'qual' | 'race' | 'both';
  qual_plan: PlanPressures;
  race_plan: PlanPressures;
  qual_lap_range: [number, number];
  race_stint_lap_range: [number, number | null];
  pressure_band_psi: number;
  current_ambient_temp_c: number | null;
  current_track_temp_c: number | null;
  created_at: string;
}

export interface WindowCornerStat {
  avg: number | null;
  min: number | null;
  max: number | null;
  lap_start_pressure: number | null;
  pct_in_band: number | null;
  delta_from_target: number | null;
}

export interface WindowStats {
  fl?: WindowCornerStat;
  fr?: WindowCornerStat;
  rl?: WindowCornerStat;
  rr?: WindowCornerStat;
  _summary?: { avg_delta: number; pct_in_band: number };
}

export interface BoardSession {
  id: string;
  label: string;
  session_type: string;
  target_pressure_psi: number | null;
  roll_out_psi: CornerPressures;
  ambient_temp_c: number | null;
  track_temp_c: number | null;
  tire_summary: Record<string, unknown> | null;
  bleed_events: BleedEvent[];
  planning_tag: string | null;
  tire_set_name: string | null;
  qual_window_stats: WindowStats | null;
  race_window_stats: WindowStats | null;
}

export interface TrackSection {
  id: string;
  track_name: string;
  name: string;
  start_distance: number;
  end_distance: number;
  section_type: string;
  sort_order: number;
  corner_group?: number | null;
}

export interface TrackLayout {
  id: string;
  name: string;
  track_name: string;
  source_session_id: string | null;
  source_lap_index: number | null;
  created_at: string;
}

export interface SavedComparison {
  id: string;
  name: string;
  session_ids: string[];
}

export interface SessionListItem {
  id: string;
  label: string;
  track: string;
}

export interface DashboardTemplate {
  id: string;
  name: string;
  layout: DashboardModule[];
  created_at: string;
}

export interface DashboardModule {
  type: string;
  width?: string;
  height?: number | null;
  channels?: string[];
  /** Partition of `channels` into Y axis groups (axis ids: y, y2, y3, …). */
  yAxisGroups?: string[][];
  /** Per-axis scale options; keys match Chart.js scale ids (y, y2, …). */
  yAxisConfig?: Record<string, { autoScale?: boolean; min?: number; max?: number }>;
  /** Client-side pressure smoothing level index (0 = Raw). */
  smoothLevel?: number;
  /** Custom line colors per channel key (hex). */
  channelColors?: Record<string, string>;
  /** Custom Y-axis group colors keyed by group index '0'..'3' (hex). */
  groupColors?: Record<string, string>;
  [key: string]: unknown;
}

export interface UserInfo {
  user_key: string;
  email: string;
  name: string;
  picture: string;
}

export interface Preferences {
  default_target_pressure_psi: number;
  default_pressure_unit: string;
  default_temp_unit: string;
  default_distance_unit: string;
  [key: string]: unknown;
}
