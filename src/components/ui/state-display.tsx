/**
 * Reusable State Display Components
 *
 * Provides consistent UI for:
 * - Empty states (no data)
 * - Error states (failed to load)
 * - Loading states (data loading)
 * - Reconnecting states (WebSocket reconnecting)
 * - No workspace states (workspace not linked)
 *
 * Phase 4 Implementation: Error Handling & UX Polish
 */

import * as React from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { LucideIcon, AlertCircle, FolderOpen, RefreshCw, Database, WifiOff, Play, GitBranch, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ============================================================================
// Empty State
// ============================================================================

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon = Database,
  title,
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardContent className="p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
            <Icon className="h-10 w-10 text-primary" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-2">{title}</h3>
          <p className="text-muted-foreground max-w-md mb-6">{description}</p>
          {(action || secondaryAction) && (
            <div className="flex gap-3">
              {secondaryAction && (
                secondaryAction.href ? (
                  <Button variant="outline" asChild>
                    <Link to={secondaryAction.href}>{secondaryAction.label}</Link>
                  </Button>
                ) : (
                  <Button variant="outline" onClick={secondaryAction.onClick}>
                    {secondaryAction.label}
                  </Button>
                )
              )}
              {action && (
                action.href ? (
                  <Button asChild>
                    <Link to={action.href}>{action.label}</Link>
                  </Button>
                ) : (
                  <Button onClick={action.onClick}>{action.label}</Button>
                )
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Error State
// ============================================================================

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn("border-destructive/50", className)}>
      <CardContent className="p-8">
        <div className="flex flex-col items-center justify-center text-center">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">{title ?? t("common.state.error.title")}</h3>
          <p className="text-muted-foreground mb-4">{message}</p>
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {retryLabel ?? t("common.state.error.retry")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Inline Error Message
// ============================================================================

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ message, onRetry, className }: InlineErrorProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex items-center gap-2 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive",
        className
      )}
    >
      <AlertCircle className="h-5 w-5 shrink-0" />
      <span className="flex-1 text-sm">{message}</span>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="shrink-0" aria-label={t("common.retry")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// No Workspace State
// ============================================================================

interface NoWorkspaceStateProps {
  title?: string;
  description?: string;
  className?: string;
}

export function NoWorkspaceState({
  title,
  description,
  className,
}: NoWorkspaceStateProps) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={FolderOpen}
      title={title ?? t("common.state.noWorkspace.title")}
      description={description ?? t("common.state.noWorkspace.description")}
      action={{
        label: t("common.linkWorkspace"),
        href: "/settings?tab=workspaces",
      }}
      className={className}
    />
  );
}

// ============================================================================
// No Results State (empty runs/experiments)
// ============================================================================

interface NoResultsStateProps {
  title?: string;
  description?: string;
  className?: string;
}

export function NoResultsState({
  title,
  description,
  className,
}: NoResultsStateProps) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={Play}
      title={title ?? t("common.state.noResults.title")}
      description={description ?? t("common.state.noResults.description")}
      action={{
        label: t("common.state.noResults.action"),
        href: "/editor",
      }}
      className={className}
    />
  );
}

// ============================================================================
// No Pipelines State
// ============================================================================

interface NoPipelinesStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  actionPath?: string;
  className?: string;
}

export function NoPipelinesState({
  title,
  description,
  actionLabel,
  actionPath = "/pipelines/new",
  className,
}: NoPipelinesStateProps) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={GitBranch}
      title={title ?? t("common.state.noPipelines.title")}
      description={description ?? t("common.state.noPipelines.description")}
      action={{
        label: actionLabel ?? t("common.state.noPipelines.action"),
        href: actionPath,
      }}
      className={className}
    />
  );
}

// ============================================================================
// No Datasets State
// ============================================================================

interface NoDatasetsStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  actionPath?: string;
  onImport?: () => void;
  className?: string;
}

export function NoDatasetsState({
  title,
  description,
  actionLabel,
  actionPath,
  onImport,
  className,
}: NoDatasetsStateProps) {
  const { t } = useTranslation();
  const action = actionPath
    ? { label: actionLabel ?? t("common.state.noDatasets.goToSettings"), href: actionPath }
    : onImport
      ? { label: actionLabel ?? t("common.state.noDatasets.import"), onClick: onImport }
      : { label: actionLabel ?? t("common.state.noDatasets.goToSettings"), href: "/settings" };

  return (
    <EmptyState
      icon={Database}
      title={title ?? t("common.state.noDatasets.title")}
      description={description ?? t("common.state.noDatasets.description")}
      action={action}
      className={className}
    />
  );
}

// ============================================================================
// Loading State (Full card)
// ============================================================================

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({
  message,
  className,
}: LoadingStateProps) {
  const { t } = useTranslation();
  return (
    <Card className={className}>
      <CardContent className="p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{message ?? t("common.loading")}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Inline Loading
// ============================================================================

interface InlineLoadingProps {
  message?: string;
  className?: string;
}

export function InlineLoading({
  message,
  className,
}: InlineLoadingProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex items-center justify-center py-8", className)}>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <span className="ml-2 text-muted-foreground">{message ?? t("common.loading")}</span>
    </div>
  );
}

// ============================================================================
// Card Loading Skeleton
// ============================================================================

interface CardSkeletonProps {
  count?: number;
  className?: string;
}

export function CardSkeleton({ count = 3, className }: CardSkeletonProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Reconnecting Indicator (for WebSocket)
// ============================================================================

interface ReconnectingIndicatorProps {
  message?: string;
  attempt?: number;
  maxAttempts?: number;
  className?: string;
}

export function ReconnectingIndicator({
  message,
  attempt,
  maxAttempts,
  className,
}: ReconnectingIndicatorProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400",
        className
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span className="text-sm">{message ?? t("common.state.reconnecting")}</span>
      {attempt !== undefined && maxAttempts !== undefined && (
        <span className="text-xs text-muted-foreground">
          ({attempt}/{maxAttempts})
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Run Failed State
// ============================================================================

interface RunFailedStateProps {
  errorMessage?: string;
  onRetry?: () => void;
  onViewLogs?: () => void;
  className?: string;
}

export function RunFailedState({
  errorMessage,
  onRetry,
  onViewLogs,
  className,
}: RunFailedStateProps) {
  const { t } = useTranslation();
  return (
    <Card className={cn("border-destructive/50", className)}>
      <CardContent className="p-6">
        <div className="flex flex-col items-center justify-center text-center">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {t("common.state.runFailed.title")}
          </h3>
          {errorMessage && (
            <p className="text-muted-foreground mb-4 font-mono text-sm bg-muted/50 p-3 rounded-lg max-w-md">
              {errorMessage}
            </p>
          )}
          <div className="flex gap-3">
            {onViewLogs && (
              <Button variant="outline" onClick={onViewLogs}>
                {t("common.state.runFailed.viewLogs")}
              </Button>
            )}
            {onRetry && (
              <Button onClick={onRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("common.state.runFailed.retry")}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Search Empty State
// ============================================================================

interface SearchEmptyStateProps {
  query: string;
  onClear?: () => void;
  className?: string;
}

export function SearchEmptyState({
  query,
  onClear,
  className,
}: SearchEmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("text-center py-8", className)}>
      <p className="text-muted-foreground mb-4">
        <Trans
          i18nKey="common.state.searchEmpty.message"
          values={{ query }}
          components={{ q: <span className="font-medium text-foreground" /> }}
        />
      </p>
      {onClear && (
        <Button variant="ghost" onClick={onClear}>
          {t("common.state.searchEmpty.clear")}
        </Button>
      )}
    </div>
  );
}
