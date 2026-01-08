"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardLoadMoreSchema = exports.BoardLoadColumnSchema = exports.DependencySchema = exports.LabelSchema = exports.CommentAddSchema = exports.SetStatusSchema = exports.IssueCreateSchema = exports.IssueUpdateSchema = void 0;
const zod_1 = require("zod");
// Zod validation schemas for runtime message validation
const IssueIdSchema = zod_1.z.string().min(1).max(200);
const BoardColumnKeySchema = zod_1.z.enum(['ready', 'open', 'in_progress', 'blocked', 'closed']);
exports.IssueUpdateSchema = zod_1.z.object({
    id: IssueIdSchema,
    updates: zod_1.z.object({
        title: zod_1.z.string().max(500).optional(),
        description: zod_1.z.string().max(10000).optional(),
        status: zod_1.z.enum(['open', 'in_progress', 'blocked', 'closed']).optional(),
        priority: zod_1.z.number().int().min(0).max(4).optional(),
        issue_type: zod_1.z.enum(['task', 'bug', 'feature', 'epic', 'chore']).optional(),
        assignee: zod_1.z.string().max(100).nullable().optional(),
        estimated_minutes: zod_1.z.number().int().min(0).nullable().optional(),
        acceptance_criteria: zod_1.z.string().max(10000).optional(),
        design: zod_1.z.string().max(10000).optional(),
        notes: zod_1.z.string().max(10000).optional(),
        external_ref: zod_1.z.string().max(200).nullable().optional(),
        due_at: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.null()]).optional(),
        defer_until: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.null()]).optional()
    })
});
exports.IssueCreateSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(500),
    description: zod_1.z.string().max(10000).optional(),
    status: zod_1.z.enum(['open', 'in_progress', 'blocked', 'closed']).optional(),
    priority: zod_1.z.number().int().min(0).max(4).optional(),
    issue_type: zod_1.z.enum(['task', 'bug', 'feature', 'epic', 'chore']).optional(),
    assignee: zod_1.z.string().max(100).nullable().optional(),
    estimated_minutes: zod_1.z.number().int().min(0).nullable().optional(),
    acceptance_criteria: zod_1.z.string().max(10000).optional(),
    design: zod_1.z.string().max(10000).optional(),
    notes: zod_1.z.string().max(10000).optional(),
    external_ref: zod_1.z.string().max(200).nullable().optional(),
    due_at: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.null()]).optional(),
    defer_until: zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.null()]).optional(),
    labels: zod_1.z.array(zod_1.z.string().max(100)).optional(),
    pinned: zod_1.z.boolean().optional(),
    is_template: zod_1.z.boolean().optional(),
    ephemeral: zod_1.z.boolean().optional(),
    parent_id: zod_1.z.string().max(100).optional(),
    blocked_by_ids: zod_1.z.array(zod_1.z.string().max(100)).optional()
});
exports.SetStatusSchema = zod_1.z.object({
    id: IssueIdSchema,
    status: zod_1.z.enum(['open', 'in_progress', 'blocked', 'closed'])
});
exports.CommentAddSchema = zod_1.z.object({
    id: IssueIdSchema,
    text: zod_1.z.string().min(1).max(10000),
    author: zod_1.z.string().max(100)
});
exports.LabelSchema = zod_1.z.object({
    id: IssueIdSchema,
    label: zod_1.z.string().min(1).max(100)
});
exports.DependencySchema = zod_1.z.object({
    id: IssueIdSchema,
    otherId: IssueIdSchema,
    type: zod_1.z.enum(['blocks', 'parent-child']).optional()
});
// Schemas for incremental loading messages
exports.BoardLoadColumnSchema = zod_1.z.object({
    column: BoardColumnKeySchema,
    offset: zod_1.z.number().int().min(0),
    limit: zod_1.z.number().int().min(1).max(500)
});
exports.BoardLoadMoreSchema = zod_1.z.object({
    column: BoardColumnKeySchema
});
