import type { ReactNode } from "react";

import { cx } from "./_cx.js";
import { icon, type BuilderIconKey } from "./icons.js";
import { STRINGS } from "./locale.js";
import type { Locale } from "./roles.js";
import type { ValidationCheck, ValidationResult } from "./types.js";

export interface LiveValidationCardProps {
  validation: ValidationResult;
  locale?: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
  /** optional trailing value shown to the right of each check (e.g. a filename). */
  trailing?: (check: ValidationCheck) => ReactNode;
  className?: string;
  title?: string;
}

const LEVEL_ICON = { ok: "check", warning: "warning", error: "error" } as const;

/** Real-time validation card: OK / warning / error checks with a header status. */
export function LiveValidationCard({
  validation,
  locale = "fr",
  icons,
  trailing,
  className,
  title,
}: LiveValidationCardProps) {
  const t = STRINGS[locale];
  return (
    <section className={cx("dsb-validation", className)} data-status={validation.status} aria-label={title ?? t.liveValidation}>
      <header className="dsb-validation__head">
        <span className="dsb-validation__head-icon">{icon(LEVEL_ICON[validation.status], icons)}</span>
        <strong>{title ?? t.liveValidation}</strong>
      </header>
      <ul className="dsb-validation__list">
        {validation.checks.map((check) => (
          <li key={check.id} className="dsb-validation__item" data-level={check.level}>
            <span className="dsb-validation__icon">{icon(LEVEL_ICON[check.level], icons)}</span>
            <span className="dsb-validation__text">
              <span className="dsb-validation__label">{check.label}</span>
              {check.details ? <span className="dsb-validation__details">{check.details}</span> : null}
            </span>
            {trailing ? <span className="dsb-validation__trailing">{trailing(check)}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
