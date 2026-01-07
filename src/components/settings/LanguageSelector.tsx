/**
 * Language Selector Component
 *
 * Dropdown selector for changing the interface language.
 * Displays the current language with flag and allows switching.
 *
 * Phase 6 Implementation - Settings Roadmap
 */

import { useLanguage } from "@/context/LanguageContext";
import { useTranslation } from "react-i18next";
import { Check, Globe, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { SupportedLanguage } from "@/lib/i18n";

interface LanguageSelectorProps {
  /** Show label above selector */
  showLabel?: boolean;
  /** Compact mode - smaller size */
  compact?: boolean;
  /** Additional className */
  className?: string;
}

export function LanguageSelector({
  showLabel = true,
  compact = false,
  className = "",
}: LanguageSelectorProps) {
  const { t } = useTranslation();
  const { language, changeLanguage, languages, isLoading } = useLanguage();

  const handleLanguageChange = async (value: string) => {
    await changeLanguage(value as SupportedLanguage);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {showLabel && (
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">
            {t("settings.general.language.title")}
          </Label>
        </div>
      )}
      {showLabel && (
        <p className="text-xs text-muted-foreground">
          {t("settings.general.language.description")}
        </p>
      )}

      <Select
        value={language}
        onValueChange={handleLanguageChange}
        disabled={isLoading}
      >
        <SelectTrigger
          className={compact ? "w-[140px]" : "w-[200px]"}
          aria-label={t("settings.general.language.select")}
        >
          <SelectValue>
            {isLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{t("common.loading")}</span>
              </div>
            ) : (
              <LanguageDisplay
                code={language}
                languages={languages}
                compact={compact}
              />
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {languages.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              <div className="flex items-center gap-2 w-full">
                <span className="text-base" role="img" aria-label={lang.name}>
                  {lang.flag}
                </span>
                <span className="flex-1">{lang.nativeName}</span>
                {!compact && (
                  <span className="text-muted-foreground text-xs">
                    ({lang.name})
                  </span>
                )}
                {language === lang.code && (
                  <Check className="h-4 w-4 text-primary ml-2" />
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showLabel && (
        <p className="text-xs text-muted-foreground mt-2">
          {t("settings.general.language.restart")}
        </p>
      )}
    </div>
  );
}

/**
 * Display component for selected language
 */
function LanguageDisplay({
  code,
  languages,
  compact,
}: {
  code: string;
  languages: readonly { code: string; name: string; nativeName: string; flag: string }[];
  compact: boolean;
}) {
  const lang = languages.find((l) => l.code === code);
  if (!lang) return <span>Unknown</span>;

  return (
    <div className="flex items-center gap-2">
      <span className="text-base" role="img" aria-label={lang.name}>
        {lang.flag}
      </span>
      <span>{compact ? lang.code.toUpperCase() : lang.nativeName}</span>
    </div>
  );
}

export default LanguageSelector;
