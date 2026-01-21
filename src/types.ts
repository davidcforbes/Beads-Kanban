import { z } from 'zod';

export type IssueStatus = "open" | "in_progress" | "blocked" | "closed";

export type IssueType = "task" | "bug" | "feature" | "epic" | "chore";

export type BoardColumnKey = "ready" | "open" | "in_progress" | "blocked" | "closed";

export interface IssueRow {
  id: string;
  title: string;
  description: string;
  status: IssueStatus | string;
  priority: number;
  issue_type: string;
  assignee: string | null;
  estimated_minutes: number | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  external_ref: string | null;
  acceptance_criteria: string;
  design: string;
  notes: string;
  due_at: string | null;
  defer_until: string | null;

  is_ready: number; // 0/1
  blocked_by_count: number; // integer
  pinned: number | null; // 0/1
  is_template: number | null; // 0/1
  ephemeral: number | null; // 0/1

  // Event/Agent metadata
  event_kind: string | null;
  actor: string | null;
  target: string | null;
  payload: string | null;
  sender: string | null;
  mol_type: string | null;
  role_type: string | null;
  rig: string | null;
  agent_state: string | null;
  last_activity: string | null;
  hook_bead: string | null;
  role_bead: string | null;
  await_type: string | null;
  await_id: string | null;
  timeout_ns: number | null;
  waiters: string | null;
}

// 3-Tier Progressive Loading Card Types

/**
 * Tier 1: Minimal card data from fast bd list query (100-300ms for 400 issues)
 * Contains only essential fields for displaying cards in kanban columns
 */
export interface MinimalCard {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  closed_at?: string | null;
  close_reason?: string | null;
  dependency_count: number;
  dependent_count: number;
}

/**
 * Tier 2: Enriched card with optional display enhancement fields
 * Adds labels, assignee, etc. for better UI without full relationship data
 */
export interface EnrichedCard extends MinimalCard {
  assignee?: string | null;
  estimated_minutes?: number | null;
  labels?: string[];
  external_ref?: string | null;
  pinned?: boolean;
  blocked_by_count?: number;
  is_ready?: boolean;
}

/**
 * Tier 3: Full card with all fields including relationships and comments
 * Loaded on-demand when editing (50ms per issue via bd show)
 */
export interface FullCard extends EnrichedCard {
  acceptance_criteria: string;
  design: string;
  notes: string;
  due_at?: string | null;
  defer_until?: string | null;

  is_ready?: boolean;
  is_template?: boolean;
  ephemeral?: boolean;

  // Event/Agent metadata
  event_kind?: string | null;
  actor?: string | null;
  target?: string | null;
  payload?: string | null;
  sender?: string | null;
  mol_type?: string | null;
  role_type?: string | null;
  rig?: string | null;
  agent_state?: string | null;
  last_activity?: string | null;
  hook_bead?: string | null;
  role_bead?: string | null;
  await_type?: string | null;
  await_id?: string | null;
  timeout_ns?: number | null;
  waiters?: string | null;

  // Relationships
  parent?: DependencyInfo;
  children?: DependencyInfo[];
  blocks?: DependencyInfo[];
  blocked_by?: DependencyInfo[];
  comments?: Comment[];
}

/**
 * Legacy BoardCard interface - maintained for backward compatibility
 * New code should use MinimalCard/EnrichedCard/FullCard hierarchy
 */
export interface BoardCard {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  assignee?: string | null;
  estimated_minutes?: number | null;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  external_ref?: string | null;
  acceptance_criteria: string;
  design: string;
  notes: string;
  due_at?: string | null;
  defer_until?: string | null;

  is_ready: boolean;
  blocked_by_count: number;
  labels: string[];
  pinned?: boolean;
  is_template?: boolean;
  ephemeral?: boolean;

  // Event/Agent metadata
  event_kind?: string | null;
  actor?: string | null;
  target?: string | null;
  payload?: string | null;
  sender?: string | null;
  mol_type?: string | null;
  role_type?: string | null;
  rig?: string | null;
  agent_state?: string | null;
  last_activity?: string | null;
  hook_bead?: string | null;
  role_bead?: string | null;
  await_type?: string | null;
  await_id?: string | null;
  timeout_ns?: number | null;
  waiters?: string | null;

  // Relationships
  parent?: DependencyInfo;
  children?: DependencyInfo[];
  blocks?: DependencyInfo[];
  blocked_by?: DependencyInfo[];
  comments?: Comment[];
}

export interface DependencyInfo {
  id: string;
  title: string;
  created_at?: string;
  created_by?: string;
  metadata?: string;
  thread_id?: string;
}

export interface Comment {
  id: number;
  issue_id: string;
  author: string;
  text: string;
  created_at: string;
}

export interface BoardColumn {
  key: BoardColumnKey;
  title: string;
}

export interface BoardData {
  columns: BoardColumn[];
  cards?: BoardCard[];  // Optional - not needed when using columnData
  // Enhanced fields for incremental loading (optional for backward compat)
  columnData?: ColumnDataMap;
  // Read-only mode flag - when true, webview should disable all mutation controls
  readOnly?: boolean;
}

// Helper types for incremental loading
export interface ColumnLoadState {
  offset: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

export interface ColumnData extends ColumnLoadState {
  cards: BoardCard[];
}

export type ColumnDataMap = Record<BoardColumnKey, ColumnData>;

// Zod validation schemas for runtime message validation
// Strict issue ID format: project.name-suffix (prevents path traversal, XSS, command injection)
// Must start with alphanumeric, can contain alphanumeric/dots/hyphens, must end with -suffix
export const IssueIdSchema = z.string().regex(
  /^[a-z0-9][a-z0-9.-]*-[a-z0-9]+$/i,
  'Invalid issue ID format - must match pattern: project-suffix'
);
const BoardColumnKeySchema = z.enum(['ready', 'open', 'in_progress', 'blocked', 'closed']);

export const IssueUpdateSchema = z.object({
  id: IssueIdSchema,
  updates: z.object({
    title: z.string().max(500).optional(),
    description: z.string().max(10000).optional(),
    status: z.enum(['open', 'in_progress', 'blocked', 'closed']).optional(),
    priority: z.number().int().min(0).max(4).optional(),
    issue_type: z.enum(['task', 'bug', 'feature', 'epic', 'chore']).optional(),
    assignee: z.string().max(100).nullable().optional(),
    estimated_minutes: z.number().int().min(0).nullable().optional(),
    acceptance_criteria: z.string().max(10000).optional(),
    design: z.string().max(10000).optional(),
    notes: z.string().max(10000).optional(),
    external_ref: z.string().max(200).nullable().optional(),
    due_at: z.union([z.string().datetime(), z.null()]).optional(),
    defer_until: z.union([z.string().datetime(), z.null()]).optional()
  })
});

export const IssueCreateSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  status: z.enum(['open', 'in_progress', 'blocked', 'closed']).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  issue_type: z.enum(['task', 'bug', 'feature', 'epic', 'chore']).optional(),
  assignee: z.string().max(100).nullable().optional(),
  estimated_minutes: z.number().int().min(0).nullable().optional(),
  acceptance_criteria: z.string().max(10000).optional(),
  design: z.string().max(10000).optional(),
  notes: z.string().max(10000).optional(),
  external_ref: z.string().max(200).nullable().optional(),
  due_at: z.union([z.string().datetime(), z.null()]).optional(),
  defer_until: z.union([z.string().datetime(), z.null()]).optional(),
  labels: z.array(z.string().max(100)).optional(),
  pinned: z.boolean().optional(),
  is_template: z.boolean().optional(),
  ephemeral: z.boolean().optional(),
  parent_id: z.string().max(100).optional(),
  blocked_by_ids: z.array(z.string().max(100)).optional(),
  children_ids: z.array(z.string().max(100)).optional()
});

export const SetStatusSchema = z.object({
  id: IssueIdSchema,
  status: z.enum(['open', 'in_progress', 'blocked', 'closed'])
});

export const CommentAddSchema = z.object({
  id: IssueIdSchema,
  text: z.string().min(1).max(10000),
  author: z.string().max(100)
});

export const LabelSchema = z.object({
  id: IssueIdSchema,
  label: z.string().min(1).max(100)
});

export const DependencySchema = z.object({
  id: IssueIdSchema,
  otherId: IssueIdSchema,
  type: z.enum(['blocks', 'parent-child']).optional()
});

// Schemas for incremental loading messages
export const BoardLoadColumnSchema = z.object({
  column: BoardColumnKeySchema,
  offset: z.number().int().min(0).max(5000), // Prevent DoS from excessive offset values
  limit: z.number().int().min(1).max(500)
});

export const BoardLoadMoreSchema = z.object({
  column: BoardColumnKeySchema
});

// Graph View Types
export interface GraphNode {
  id: string;
  card: EnrichedCard | FullCard;
  x: number;
  y: number;
  layer: number; // BFS depth level
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'parent-child' | 'blocks' | 'blocked-by';
}

export interface GraphViewState {
  nodePositions?: Record<string, { x: number; y: number }>;
  focusMode: boolean;
  focusDepth: number;
  direction: 'TB' | 'LR';
  zoom: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphLayoutOptions {
  direction?: 'TB' | 'LR';
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalSpacing?: number;
  verticalSpacing?: number;
  focusMode?: boolean;
  focusNodeId?: string;
  focusDepth?: number;
}
