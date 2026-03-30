import type {
  CarDriver,
  TireSet,
  TrackLayout,
  TrackSection,
  SavedComparison,
  DashboardTemplate,
  DashboardModule,
  SessionListItem,
  UserInfo,
  Preferences,
} from './models';

// Generic wrappers
export interface OkResponse {
  ok: boolean;
}

export interface ErrorResponse {
  error: string;
}

// Auth
export interface AuthUserResponse {
  user: UserInfo | null;
  oauth_enabled: boolean;
}

// Car/Drivers
export type CarDriversResponse = CarDriver[];
export interface CarDriverCreateResponse extends OkResponse {
  car_driver: CarDriver;
}

// Tire Sets
export type TireSetsResponse = TireSet[];
export interface TireSetCreateResponse extends OkResponse {
  tire_set: TireSet;
}

// Track Layouts
export interface TrackLayoutsResponse {
  layouts: TrackLayout[];
  session_map: Record<string, string>;
}
export interface TrackLayoutCreateResponse extends OkResponse {
  layout: TrackLayout;
}

// Sessions
export type SessionListResponse = SessionListItem[];
export interface SessionsFullResponse {
  sessions: SessionSummary[];
  car_drivers: CarDriver[];
}
export interface SessionSummary {
  id: string;
  car_driver_id: string;
  session_type: string;
  track: string;
  driver: string;
  car: string;
  outing_number: string;
  session_number: string;
  ambient_temp_c: number | null;
  track_temp_c: number | null;
  lap_count: number;
}

// Session Detail
export interface SessionDetailResponse {
  session: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  chart_data: Record<string, unknown> | null;
  dashboard_data: Record<string, unknown> | null;
  available_tools: string[];
  tool_data: Record<string, unknown> | null;
  tire_set: TireSet | null;
  car_driver: CarDriver | null;
  car_drivers: CarDriver[];
  tire_sets: TireSet[];
  track_layouts: TrackLayout[];
  can_reprocess: boolean;
  needs_reprocess: boolean;
  smoothing_level: number;
  is_v2: boolean;
}

// Sections
export type SectionsResponse = TrackSection[];
export interface SectionsSaveResponse extends OkResponse {
  sections: TrackSection[];
}

// Comparisons
export interface ComparisonCreateResponse extends OkResponse {
  id: string;
  url: string;
}
export interface ComparisonUpdateResponse extends OkResponse {
  comparison: SavedComparison;
}

// Dashboard
export type DashboardTemplatesResponse = DashboardTemplate[];
export interface DashboardTemplateCreateResponse {
  id: string;
  name: string;
  layout: DashboardModule[];
  created_at: string;
}
export interface DashboardLayoutResponse {
  layout: DashboardModule[] | null;
}

// Sync
export interface SyncStatusResponse {
  status: string;
  last_synced_at?: string;
  remote_timestamp?: string;
  message?: string;
}
export interface SyncFilesResponse {
  files: SyncFile[];
  summary: {
    total: number;
    synced: number;
    pending: number;
    pending_size: number;
  };
}
export interface SyncFile {
  path: string;
  type: string;
  size: number;
  status: string;
}

// Settings
export interface SettingsResponse {
  preferences: Preferences;
  data_root: string;
  user: UserInfo | null;
  oauth_enabled: boolean;
}

// Upload
/** Suggested save-form values derived from the parser / OutingInformation. */
export interface UploadFormMetadata {
  session_type?: string;
  track?: string;
  driver?: string;
  car?: string;
  outing_number?: string | number;
  session_number?: string | number;
}

/** Successful `/upload` parse response (before save). */
export interface UploadParseResponse {
  parsed: true;
  metadata?: Record<string, string>;
  upload_path: string;
  form_metadata?: UploadFormMetadata;
  row_count?: number;
  lap_split_count?: number;
}

export interface UploadTaskStatus {
  pct: number;
  stage: string;
  error: string | null;
  done: boolean;
  redirect: string | null;
  label: string;
}
