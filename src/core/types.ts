/**
 * BuildPilot core data model.
 *
 * Every piece of information carries its provenance. The five layers are kept apart on purpose:
 *   1. Observed facts   -> Event, TestRun, Evidence(kind = "observed")
 *   2. Derived inferences -> Session.status, Issue, Evidence(kind = "inferred")
 *   3. Recommendations  -> Recommendation (source = "rules" | "ai")
 *   4. Approved actions -> Approval
 *   5. Verified outcomes -> Recommendation.verification, TestRun
 */

export type Confidence = "verified" | "inferred" | "unverified" | "failed" | "unknown";

export type Stage =
  | "discovery"
  | "planning"
  | "prototyping"
  | "implementation"
  | "integration"
  | "testing"
  | "stabilization"
  | "deployment"
  | "maintenance";

export type SessionStatus =
  | "running"
  | "idle"
  | "blocked"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "unknown";

export type Severity = "blocker" | "high" | "medium" | "low" | "info";

export interface Project {
  id: string; // stable hash of the absolute root path
  root: string;
  name: string;
  createdAt: number;
  lastAnalyzedAt: number | null;
}

export interface Requirement {
  id: string;
  projectId: string;
  title: string;
  acceptance: string; // plain-English acceptance criteria; may be empty -> flagged
  status: "todo" | "in_progress" | "done" | "dropped";
  /** "done" only counts toward progress when evidence is "verified". */
  evidence: Confidence;
  evidenceNote: string;
  source: "user" | "imported";
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string; // Claude Code session_id
  projectId: string | null;
  cwd: string;
  transcriptPath: string | null;
  status: SessionStatus;
  statusReason: string;
  currentTask: string | null; // last user prompt (redacted, truncated) - "known" only when observed
  model: string | null;
  permissionMode: string | null;
  startedAt: number;
  lastEventAt: number;
  endedAt: number | null;
  eventCount: number;
  errorCount: number;
}

export interface HookEvent {
  id: number;
  sessionId: string;
  hookEvent: string; // hook_event_name exactly as Claude Code sent it
  ts: number;
  toolName: string | null;
  toolUseId: string | null;
  summary: string; // short, redacted, human-readable
  filePath: string | null;
  isError: boolean;
  errorText: string | null; // redacted, truncated
  agentId: string | null;
  fingerprint: string; // dedupe key
}

export interface Issue {
  key: string; // stable rule key so issues don't duplicate
  severity: Severity;
  title: string;
  plain: string; // beginner explanation
  evidence: EvidenceItem[];
  sessionId?: string;
}

export interface EvidenceItem {
  kind: "observed" | "inferred";
  text: string;
  ref?: string; // file path, command, event id
}

export interface Recommendation {
  key: string;
  title: string;
  why: string;
  severity: Severity;
  score: number; // higher = more valuable next action
  source: "rules" | "ai";
  evidence: EvidenceItem[];
  action?: RecommendedAction;
  /** Filled in when BuildPilot later checks whether the recommendation was satisfied. */
  verification?: { status: Confidence; checkedAt: number; note: string };
}

export type RecommendedAction =
  | { kind: "prompt"; goal: GoalType; request: string }
  | { kind: "run_script"; script: string }
  | { kind: "checkpoint" }
  | { kind: "open_file"; path: string }
  | { kind: "install_hooks" }
  | { kind: "audit" }
  | { kind: "visual_check" }
  | { kind: "worktree"; sessionId: string }
  | { kind: "open_tab"; tab: "overview" | "sessions" | "supervisor" | "prompts" | "memory" | "connect" };

export interface TestRun {
  id: number;
  projectId: string;
  command: string;
  startedAt: number;
  durationMs: number;
  exitCode: number | null;
  passed: boolean;
  outputTail: string; // redacted
  source: "buildpilot" | "observed_session";
}

export interface Decision {
  id: number;
  projectId: string;
  title: string;
  detail: string;
  createdAt: number;
}

export interface Approval {
  id: number;
  projectId: string;
  action: string;
  detail: string;
  approvedAt: number;
  outcome: string | null;
}

export interface ChangeSet {
  branch: string | null;
  head: string | null;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  ahead: number | null;
  behind: number | null;
}

export type GoalType =
  | "feature"
  | "bugfix"
  | "integration"
  | "tests"
  | "refactor"
  | "ui"
  | "security"
  | "deploy"
  | "performance"
  | "explain"
  | "handoff";

export interface UsageSnapshot {
  model: string | null;
  /** Tokens sent to the model on the most recent assistant turn (input + cache read + cache write). */
  lastTurnInputTokens: number | null;
  totalOutputTokens: number | null;
  assistantTurns: number;
  /** Always an estimate; null means Unknown. */
  contextWindowEstimate: { tokens: number; basis: string } | null;
  source: "transcript" | "none";
}
