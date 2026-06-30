import { Link } from "react-router-dom";
import { RefreshCw, Target } from "lucide-react";
import type { ResultRelatedLinkData, ResultRelatedLinkIcon } from "./resultDetailData";

interface ResultMetricsRelatedLinksProps {
  links: ResultRelatedLinkData[];
}

export function ResultMetricsRelatedLinks({ links }: ResultMetricsRelatedLinksProps) {
  return (
    <div className="flex items-center gap-3 pt-2 text-xs">
      {links.map((link) => (
        <Link
          key={link.id}
          to={link.to}
          className="text-muted-foreground hover:text-primary flex items-center gap-1"
        >
          {renderRelatedLinkIcon(link.icon)}
          {link.label}
        </Link>
      ))}
    </div>
  );
}

function renderRelatedLinkIcon(icon: ResultRelatedLinkIcon): React.ReactNode {
  if (icon === "runs") return <RefreshCw className="h-3 w-3" />;
  return <Target className="h-3 w-3" />;
}
