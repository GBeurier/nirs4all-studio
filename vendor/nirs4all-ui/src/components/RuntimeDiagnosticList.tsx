import type { ReactNode } from "react";

import {
  formatRuntimeTokenLabel,
  normalizeRuntimeDiagnostics,
  type RuntimeDiagnosticItem,
} from "../runtime/index.js";

export interface RuntimeDiagnosticListProps {
  source?: unknown;
  diagnostics?: readonly RuntimeDiagnosticItem[] | null;
  className?: string;
  itemClassName?: string | ((item: RuntimeDiagnosticItem) => string | undefined);
  messageClassName?: string;
  metadataClassName?: string;
  empty?: ReactNode;
  renderItem?: (item: RuntimeDiagnosticItem) => ReactNode;
}

function resolveDiagnosticTitle(item: RuntimeDiagnosticItem): string {
  const parts = [
    formatRuntimeTokenLabel(item.verb),
    formatRuntimeTokenLabel(item.cause),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Runtime diagnostic";
}

function resolveItemClassName(
  itemClassName: RuntimeDiagnosticListProps["itemClassName"],
  item: RuntimeDiagnosticItem,
): string | undefined {
  return typeof itemClassName === "function" ? itemClassName(item) : itemClassName;
}

export function RuntimeDiagnosticList({
  source,
  diagnostics,
  className,
  itemClassName,
  messageClassName,
  metadataClassName,
  empty,
  renderItem,
}: RuntimeDiagnosticListProps) {
  const items = diagnostics ?? normalizeRuntimeDiagnostics(source);
  if (items.length === 0) return empty == null ? null : <>{empty}</>;

  return (
    <ul className={className}>
      {items.map((item) => (
        <li className={resolveItemClassName(itemClassName, item)} key={item.id}>
          {renderItem ? renderItem(item) : (
            <>
              <strong>{resolveDiagnosticTitle(item)}</strong>
              <span className={messageClassName}>{item.message}</span>
              {item.mitigation ? (
                <span className={metadataClassName}>Mitigation: {item.mitigation}</span>
              ) : null}
              {item.unsupportedCapability ? (
                <span className={metadataClassName}>
                  Missing capability: {formatRuntimeTokenLabel(item.unsupportedCapability)}
                </span>
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
