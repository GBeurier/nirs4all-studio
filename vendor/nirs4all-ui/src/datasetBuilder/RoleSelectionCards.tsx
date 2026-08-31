import type { ReactNode } from "react";

import { cx } from "./_cx.js";
import { icon, type BuilderIconKey } from "./icons.js";
import { ROLE_DESCRIPTORS, ROLE_ORDER, type Locale } from "./roles.js";
import type { DatasetRole } from "./types.js";

export interface RoleSelectionCardsProps {
  /** columns currently selected in the mapping table (drives the apply hint). */
  selectedCount?: number;
  activeRole?: DatasetRole | null;
  onAssignRole: (role: DatasetRole) => void;
  /** roles to show; defaults to the 6 primary roles from the spec. */
  roles?: DatasetRole[];
  locale?: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
  className?: string;
}

/** The big clickable role cards; clicking applies the role to the selection. */
export function RoleSelectionCards({
  selectedCount = 0,
  activeRole,
  onAssignRole,
  roles = ROLE_ORDER,
  locale = "fr",
  icons,
  className,
}: RoleSelectionCardsProps) {
  return (
    <div className={cx("dsb-roles", className)} role="group">
      {roles.map((role) => {
        const descriptor = ROLE_DESCRIPTORS[role];
        return (
          <button
            key={role}
            type="button"
            className="dsb-role-card"
            data-role={descriptor.token}
            data-active={activeRole === role || undefined}
            aria-pressed={activeRole === role}
            onClick={() => onAssignRole(role)}
            title={descriptor.hints[locale]}
          >
            <span className="dsb-role-card__icon">{icon(role, icons)}</span>
            <span className="dsb-role-card__label">{descriptor.labels[locale]}</span>
            <span className="dsb-role-card__desc">{descriptor.descriptions[locale]}</span>
            <span className="dsb-role-card__hint">{descriptor.hints[locale]}</span>
          </button>
        );
      })}
      <p className="dsb-roles__hint" data-has-selection={selectedCount > 0 || undefined}>
        {selectedCount > 0
          ? locale === "en"
            ? `Applies to ${selectedCount} selected column(s)`
            : `S'applique aux ${selectedCount} colonne(s) sélectionnée(s)`
          : locale === "en"
            ? "Select columns below, then pick a role"
            : "Sélectionnez des colonnes ci-dessous, puis choisissez un rôle"}
      </p>
    </div>
  );
}
