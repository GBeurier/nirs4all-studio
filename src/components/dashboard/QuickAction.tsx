import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { LucideIcon, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuickActionColor = "primary" | "accent" | "success" | "warning";

interface QuickActionProps {
  title: string;
  description: string;
  icon: LucideIcon;
  path: string;
  color?: QuickActionColor;
}

const colorStyles: Record<QuickActionColor, string> = {
  primary:
    "bg-primary/5 border-primary/20 hover:border-primary/40 hover:bg-primary/10",
  accent:
    "bg-accent/5 border-accent/20 hover:border-accent/40 hover:bg-accent/10",
  success:
    "bg-success/5 border-success/20 hover:border-success/40 hover:bg-success/10",
  warning:
    "bg-warning/5 border-warning/20 hover:border-warning/40 hover:bg-warning/10",
};

const iconStyles: Record<QuickActionColor, string> = {
  primary: "bg-primary/15 text-primary",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
};

export function QuickAction({
  title,
  description,
  icon: Icon,
  path,
  color = "primary",
}: QuickActionProps) {
  return (
    <Link to={path}>
      <motion.div
        whileHover={{ scale: 1.02, y: -2 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "group relative flex flex-col gap-4 rounded-xl border p-5 transition-all duration-300",
          colorStyles[color]
        )}
      >
        <div className={cn("w-fit rounded-lg p-2.5", iconStyles[color])}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="absolute bottom-5 right-5 h-4 w-4 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100" />
      </motion.div>
    </Link>
  );
}
