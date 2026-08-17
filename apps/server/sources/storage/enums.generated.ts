// AUTO-GENERATED FILE - DO NOT EDIT.
// Source: prisma/schema.prisma
// Regenerate: yarn schema:sync

export const AccountIdentityEligibilityStatus = {
    unknown: "unknown",
    eligible: "eligible",
    ineligible: "ineligible",
} as const;

export type AccountIdentityEligibilityStatus = (typeof AccountIdentityEligibilityStatus)[keyof typeof AccountIdentityEligibilityStatus];

export const SessionPendingMessageStatus = {
    queued: "queued",
    discarded: "discarded",
} as const;

export type SessionPendingMessageStatus = (typeof SessionPendingMessageStatus)[keyof typeof SessionPendingMessageStatus];

export const RepositoryProviderKind = {
    github: "github",
    gitlab: "gitlab",
} as const;

export type RepositoryProviderKind = (typeof RepositoryProviderKind)[keyof typeof RepositoryProviderKind];

export const RepositoryConnectionMode = {
    quickstart: "quickstart",
    managed: "managed",
} as const;

export type RepositoryConnectionMode = (typeof RepositoryConnectionMode)[keyof typeof RepositoryConnectionMode];

export const RepositoryAuthKind = {
    github_app: "github_app",
    gitlab_token: "gitlab_token",
    gh_cli: "gh_cli",
    glab_cli: "glab_cli",
    user_pat: "user_pat",
} as const;

export type RepositoryAuthKind = (typeof RepositoryAuthKind)[keyof typeof RepositoryAuthKind];

export const SessionIssueRelation = {
    primary: "primary",
    context: "context",
} as const;

export type SessionIssueRelation = (typeof SessionIssueRelation)[keyof typeof SessionIssueRelation];

export const SessionRunState = {
    queued: "queued",
    claimed: "claimed",
    running: "running",
    waiting_user: "waiting_user",
    succeeded: "succeeded",
    failed: "failed",
    cancelled: "cancelled",
    expired: "expired",
} as const;

export type SessionRunState = (typeof SessionRunState)[keyof typeof SessionRunState];

export const ProviderActionKind = {
    comment: "comment",
    label_sync: "label_sync",
    assignee_sync: "assignee_sync",
    issue_link_back: "issue_link_back",
    open_change: "open_change",
    update_change: "update_change",
    close_issue: "close_issue",
} as const;

export type ProviderActionKind = (typeof ProviderActionKind)[keyof typeof ProviderActionKind];

export const VerificationSource = {
    remote_ci: "remote_ci",
    local_runtime: "local_runtime",
    manual_override: "manual_override",
} as const;

export type VerificationSource = (typeof VerificationSource)[keyof typeof VerificationSource];

export const VerificationLifecycleState = {
    queued: "queued",
    running: "running",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
    timed_out: "timed_out",
} as const;

export type VerificationLifecycleState = (typeof VerificationLifecycleState)[keyof typeof VerificationLifecycleState];

export const VerificationConclusion = {
    passed: "passed",
    failed: "failed",
    pending: "pending",
    skipped: "skipped",
    neutral: "neutral",
    action_required: "action_required",
    unknown: "unknown",
} as const;

export type VerificationConclusion = (typeof VerificationConclusion)[keyof typeof VerificationConclusion];

export const VerificationProjectionHeadline = {
    verified_remote: "verified_remote",
    verified_local_only: "verified_local_only",
    partially_verified: "partially_verified",
    unverified: "unverified",
    verification_failed: "verification_failed",
    verification_pending: "verification_pending",
} as const;

export type VerificationProjectionHeadline = (typeof VerificationProjectionHeadline)[keyof typeof VerificationProjectionHeadline];

export const VerificationBlockingState = {
    clear: "clear",
    warning: "warning",
    blocked: "blocked",
} as const;

export type VerificationBlockingState = (typeof VerificationBlockingState)[keyof typeof VerificationBlockingState];

export const ProviderActionExecutionMode = {
    server_worker: "server_worker",
    machine_runtime: "machine_runtime",
} as const;

export type ProviderActionExecutionMode = (typeof ProviderActionExecutionMode)[keyof typeof ProviderActionExecutionMode];

export const ProviderActionState = {
    queued: "queued",
    claimed: "claimed",
    running: "running",
    succeeded: "succeeded",
    failed: "failed",
    cancelled: "cancelled",
    expired: "expired",
} as const;

export type ProviderActionState = (typeof ProviderActionState)[keyof typeof ProviderActionState];

export const IssueWorkflowState = {
    idle: "idle",
    executing: "executing",
    change_open: "change_open",
    awaiting_review: "awaiting_review",
    done: "done",
} as const;

export type IssueWorkflowState = (typeof IssueWorkflowState)[keyof typeof IssueWorkflowState];

export const MergeabilityState = {
    mergeable: "mergeable",
    blocked_required_checks: "blocked_required_checks",
    blocked_reviews: "blocked_reviews",
    blocked_conflicts: "blocked_conflicts",
    draft: "draft",
    unknown: "unknown",
} as const;

export type MergeabilityState = (typeof MergeabilityState)[keyof typeof MergeabilityState];

export const PendingProviderAction = {
    send: "send",
    steer: "steer",
    interrupt_and_send: "interrupt_and_send",
} as const;

export type PendingProviderAction = (typeof PendingProviderAction)[keyof typeof PendingProviderAction];

export const AutomationScheduleKind = {
    cron: "cron",
    interval: "interval",
    manual: "manual",
} as const;

export type AutomationScheduleKind = (typeof AutomationScheduleKind)[keyof typeof AutomationScheduleKind];

export const AutomationTargetType = {
    new_session: "new_session",
    existing_session: "existing_session",
} as const;

export type AutomationTargetType = (typeof AutomationTargetType)[keyof typeof AutomationTargetType];

export const AutomationRunState = {
    queued: "queued",
    claimed: "claimed",
    running: "running",
    succeeded: "succeeded",
    failed: "failed",
    cancelled: "cancelled",
    expired: "expired",
} as const;

export type AutomationRunState = (typeof AutomationRunState)[keyof typeof AutomationRunState];

export const RelationshipStatus = {
    none: "none",
    requested: "requested",
    pending: "pending",
    friend: "friend",
    rejected: "rejected",
} as const;

export type RelationshipStatus = (typeof RelationshipStatus)[keyof typeof RelationshipStatus];

export const ShareAccessLevel = {
    view: "view",
    edit: "edit",
    admin: "admin",
} as const;

export type ShareAccessLevel = (typeof ShareAccessLevel)[keyof typeof ShareAccessLevel];
