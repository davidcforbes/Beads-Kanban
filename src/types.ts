export type IssueStatus = "open" | "in_progress" | "blocked" | "closed";

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

  is_ready: number; // 0/1
  blocked_by_count: number; // integer
}

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

  is_ready: boolean;
  blocked_by_count: number;
  labels: string[];

  // Relationships
  parent?: { id: string; title: string };
  children?: { id: string; title: string }[];
  blocks?: { id: string; title: string }[];
  blocked_by?: { id: string; title: string }[];
}

export interface BoardColumn {
  key: BoardColumnKey;
  title: string;
}

export interface BoardData {
  columns: BoardColumn[];
  cards: BoardCard[];
}
