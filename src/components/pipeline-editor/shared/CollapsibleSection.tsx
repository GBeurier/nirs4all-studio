/**
 * CollapsibleSection - Reusable collapsible section with header
 *
 * Provides consistent styling for expandable/collapsible sections
 * throughout the pipeline editor. Extracted from repeated patterns.
 *
 * @example
 * <CollapsibleSection title="Advanced Settings">
 *   <SomeContent />
 * </CollapsibleSection>
 *
 * <CollapsibleSection
 *   title="Parameters"
 *   icon={<Settings className="h-4 w-4" />}
 *   defaultOpen={true}
 *   badge={<Badge>5</Badge>}
 * >
 *   <ParameterList />
 * </CollapsibleSection>
 */

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CollapsibleSectionProps {
  /** Section title displayed in the header */
  title: React.ReactNode;
  /** Content to display when expanded */
  children: React.ReactNode;
  /** Optional icon displayed before the title */
  icon?: React.ReactNode;
  /** Optional badge/indicator displayed after the title */
  badge?: React.ReactNode;
  /** Optional action button/element on the right (before chevron) */
  action?: React.ReactNode;
  /** Whether the section is open by default (default: false) */
  defaultOpen?: boolean;
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Additional classes for the container */
  className?: string;
  /** Additional classes for the trigger button */
  triggerClassName?: string;
  /** Additional classes for the content wrapper */
  contentClassName?: string;
  /** Variant style for the section */
  variant?: "default" | "ghost" | "outline";
  /** Size of the section header */
  size?: "sm" | "md" | "lg";
  /** Whether the section is disabled */
  disabled?: boolean;
}

const variantStyles = {
  default: "border rounded-lg",
  ghost: "",
  outline: "border border-dashed rounded-lg",
};

const sizeStyles = {
  sm: "h-7 text-xs",
  md: "h-8 text-sm",
  lg: "h-10 text-base",
};

const contentPaddingStyles = {
  sm: "pt-2",
  md: "pt-3",
  lg: "pt-4",
};

export function CollapsibleSection({
  title,
  children,
  icon,
  badge,
  action,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  triggerClassName,
  contentClassName,
  variant = "ghost",
  size = "md",
  disabled = false,
}: CollapsibleSectionProps) {
  // Support both controlled and uncontrolled modes
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = (newOpen: boolean) => {
    if (disabled) return;
    if (!isControlled) {
      setUncontrolledOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(variantStyles[variant], className)}
    >
      <CollapsibleTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "w-full justify-between text-muted-foreground",
            sizeStyles[size],
            disabled && "opacity-50 cursor-not-allowed",
            triggerClassName
          )}
          disabled={disabled}
        >
          <span className="flex items-center gap-2">
            {icon}
            <span className={cn(size === "sm" ? "text-xs" : "text-sm")}>
              {title}
            </span>
            {badge}
          </span>
          <span className="flex items-center gap-2">
            {action}
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent
        className={cn(contentPaddingStyles[size], contentClassName)}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
