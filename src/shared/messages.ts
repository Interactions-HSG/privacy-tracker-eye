// The complete set of messages exchanged between contexts. Keeping them in one
// discriminated union makes the protocol auditable and type-safe.

import type {
  Config,
  DisclosureKind,
  FingerprintEvidence,
  IntensityResult,
  TabSignals,
} from "./types";

/** content script -> background: the eye has mounted, send me current state. */
export interface HelloMessage {
  type: "hello";
}

/** background -> content script: push the latest intensity for this tab. */
export interface IntensityUpdateMessage {
  type: "intensity-update";
  result: IntensityResult;
  config: Config;
}

/** content script -> background: forwarded fingerprinting evidence delta. */
export interface FingerprintReportMessage {
  type: "fingerprint-report";
  evidence: Partial<FingerprintEvidence>;
}

/**
 * content script -> background: the participant filled in a form field.
 *
 * PRIVACY INVARIANT: this carries the *kind* of field, its visible label and a
 * character count only. The typed value never leaves the content script.
 */
export interface DisclosureReportMessage {
  type: "disclosure-report";
  kind: DisclosureKind;
  label: string;
  chars: number;
  sensitivity: number;
}

/** popup -> background: give me the snapshot for the active tab. */
export interface GetSnapshotMessage {
  type: "get-snapshot";
}

/** background -> popup: current signals + derived intensity for active tab. */
export interface SnapshotMessage {
  type: "snapshot";
  signals: TabSignals | null;
  result: IntensityResult | null;
  config: Config;
}

/** popup -> background: persist a configuration change. */
export interface SetConfigMessage {
  type: "set-config";
  config: Partial<Config>;
}

/** popup -> background: export the collected intensity log as JSON text. */
export interface ExportLogMessage {
  type: "export-log";
}

export interface ExportLogResultMessage {
  type: "export-log-result";
  json: string;
}

export type Message =
  | HelloMessage
  | IntensityUpdateMessage
  | FingerprintReportMessage
  | DisclosureReportMessage
  | GetSnapshotMessage
  | SnapshotMessage
  | SetConfigMessage
  | ExportLogMessage
  | ExportLogResultMessage;

/** Marker used by the in-page fingerprint probe -> content script bridge. */
export const PROBE_MESSAGE_TAG = "__tracker_eye_probe__";

export interface ProbeWindowMessage {
  tag: typeof PROBE_MESSAGE_TAG;
  evidence: Partial<FingerprintEvidence>;
}
