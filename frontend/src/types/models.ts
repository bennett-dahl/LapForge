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
  file_path: string | null;
  parsed_data: Record<string, unknown> | null;
}

export interface Weekend {
  id: string;
  car_driver_id: string;
  name: string;
  session_ids: string[];
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
