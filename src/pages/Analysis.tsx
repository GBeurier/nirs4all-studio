import { motion } from "@/lib/motion";
import { useTranslation } from "react-i18next";
import { Beaker, BarChart3, TrendingUp, Layers, Settings2, ArrowLeftRight, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface AnalysisToolProps {
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  status: "available" | "coming-soon" | "beta";
  href?: string;
}

const analysisTools: AnalysisToolProps[] = [
  {
    titleKey: "analysis.transfer.title",
    descriptionKey: "analysis.transfer.description",
    icon: ArrowLeftRight,
    status: "available",
    href: "/analysis/transfer",
  },
  {
    titleKey: "analysis.pca.title",
    descriptionKey: "analysis.pca.description",
    icon: Layers,
    status: "available",
    href: "/analysis/pca",
  },
  {
    titleKey: "analysis.variableImportance.title",
    descriptionKey: "analysis.variableImportance.description",
    icon: TrendingUp,
    status: "available",
    href: "/analysis/importance",
  },
  {
    titleKey: "analysis.modelComparison.title",
    descriptionKey: "analysis.modelComparison.description",
    icon: BarChart3,
    status: "available",
    href: "/analysis/comparison",
  },
  {
    titleKey: "analysis.residualAnalysis.title",
    descriptionKey: "analysis.residualAnalysis.description",
    icon: Settings2,
    status: "beta",
    href: "/analysis/residuals",
  },
];

function AnalysisToolCard({ titleKey, descriptionKey, icon: Icon, status, href }: AnalysisToolProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleClick = () => {
    if (status !== "coming-soon" && href) {
      navigate(href);
    }
  };

  return (
    <Card
      className="step-card cursor-pointer transition-all duration-300 hover:border-primary/40"
      onClick={handleClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          {status === "beta" && (
            <Badge variant="outline" className="text-warning border-warning/50">
              {t("analysis.badges.beta")}
            </Badge>
          )}
          {status === "coming-soon" && (
            <Badge variant="outline" className="text-muted-foreground">
              {t("analysis.badges.comingSoon")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-base mb-2">{t(titleKey)}</CardTitle>
        <CardDescription className="text-sm">{t(descriptionKey)}</CardDescription>
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-4"
          disabled={status === "coming-soon"}
        >
          {status === "coming-soon" ? t("analysis.badges.notAvailable") : t("analysis.openTool")}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Analysis() {
  const { t } = useTranslation();
  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("analysis.title")}</h1>
          <p className="text-muted-foreground">
            {t("analysis.subtitle")}
          </p>
        </div>
      </motion.div>

      {/* Analysis Tools Grid */}
      <motion.div variants={itemVariants}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {analysisTools.map((tool) => (
            <AnalysisToolCard key={tool.titleKey} {...tool} />
          ))}
        </div>
      </motion.div>

      {/* Quick Start */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 shrink-0">
                <Beaker className="h-10 w-10 text-primary" />
              </div>
              <div className="flex-1 text-center md:text-left">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {t("analysis.gettingStarted.title")}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {t("analysis.gettingStarted.description")}
                </p>
                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                  <Badge variant="secondary">{t("analysis.gettingStarted.requiresRuns")}</Badge>
                  <Badge variant="secondary">{t("analysis.gettingStarted.exportFormats")}</Badge>
                  <Badge variant="secondary">{t("analysis.gettingStarted.interactive")}</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Empty State - when no data available */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              {t("analysis.empty.description")}
            </p>
            <Button variant="outline" size="sm">
              {t("analysis.empty.viewRuns")}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
