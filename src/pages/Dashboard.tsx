import { motion } from "@/lib/motion";
import {
  Database,
  GitBranch,
  Play,
  BarChart3,
  FolderOpen,
  FlaskConical,
  TrendingUp,
  Zap,
  ArrowRight,
  LucideIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineError } from "@/components/ui/state-display";
import { StatsCard, QuickAction, RecentProject, DeveloperQuickStart } from "@/components/dashboard";
import { useDashboard, formatRelativeTime } from "@/hooks/useDashboard";
import { useIsDeveloperMode } from "@/context/DeveloperModeContext";
import type { QuickActionColor } from "@/components/dashboard";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface QuickActionItem {
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  path: string;
  color: QuickActionColor;
}

const quickActionItems: QuickActionItem[] = [
  {
    titleKey: "dashboard.quickStartItems.loadDataset",
    descriptionKey: "dashboard.quickStartItems.loadDatasetDesc",
    icon: FolderOpen,
    path: "/datasets",
    color: "primary",
  },
  {
    titleKey: "dashboard.quickStartItems.buildPipeline",
    descriptionKey: "dashboard.quickStartItems.buildPipelineDesc",
    icon: GitBranch,
    path: "/pipelines/new",
    color: "accent",
  },
  {
    titleKey: "dashboard.quickStartItems.playground",
    descriptionKey: "dashboard.quickStartItems.playgroundDesc",
    icon: FlaskConical,
    path: "/playground",
    color: "success",
  },
  {
    titleKey: "dashboard.quickStartItems.viewResults",
    descriptionKey: "dashboard.quickStartItems.viewResultsDesc",
    icon: BarChart3,
    path: "/results",
    color: "warning",
  },
];

export default function Dashboard() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useDashboard();
  const isDeveloperMode = useIsDeveloperMode();
  const navigate = useNavigate();

  const stats = data?.stats ?? {
    datasets: 0,
    pipelines: 0,
    runs: 0,
    avgMetric: 0,
    trends: {
      datasets: { value: 0, direction: "neutral" as const },
      pipelines: { value: 0, direction: "neutral" as const },
      runs: { value: 0, direction: "neutral" as const },
      avgMetric: { value: 0, direction: "neutral" as const },
    },
  };

  const recentRuns = data?.recent_runs ?? [];

  return (
    <motion.div
      className="space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Welcome Section */}
      <motion.div variants={itemVariants}>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
          Welcome to{" "}
           <span>
              <span className="text-blue-600 font-bold">nirs</span>
              <span className="text-red-600 font-bold">4</span>
              <span className="text-black font-bold">all</span>
            </span>
        </h1>
        <p className="mt-1 text-muted-foreground">
          Build and run spectroscopy ML pipelines with ease
        </p>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        variants={itemVariants}
      >
        <StatsCard
          label={t("dashboard.stats.datasets")}
          value={stats.datasets}
          icon={Database}
          trend="linked"
          trendValue={stats.trends.datasets.value}
          trendDirection={stats.trends.datasets.direction}
          isLoading={isLoading}
        />
        <StatsCard
          label={t("dashboard.stats.pipelines")}
          value={stats.pipelines}
          icon={GitBranch}
          trend="saved"
          trendValue={stats.trends.pipelines.value}
          trendDirection={stats.trends.pipelines.direction}
          isLoading={isLoading}
        />
        <StatsCard
          label={t("dashboard.stats.experiments")}
          value={stats.runs}
          icon={Play}
          trend="completed"
          trendValue={stats.trends.runs.value}
          trendDirection={stats.trends.runs.direction}
          isLoading={isLoading}
        />
        <StatsCard
          label={t("dashboard.stats.avgR2")}
          value={stats.avgMetric > 0 ? stats.avgMetric.toFixed(2) : "—"}
          icon={TrendingUp}
          trend={stats.avgMetric > 0 ? t("dashboard.stats.bestModels") : "no data yet"}
          trendValue={stats.trends.avgMetric.value}
          trendDirection={stats.trends.avgMetric.direction}
          isLoading={isLoading}
        />
      </motion.div>

      {/* Quick Actions */}
      <motion.div variants={itemVariants}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t("dashboard.quickActions")}</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickActionItems.map((action) => (
            <QuickAction
              key={action.titleKey}
              title={t(action.titleKey)}
              description={t(action.descriptionKey)}
              icon={action.icon}
              path={action.path}
              color={action.color}
            />
          ))}
        </div>
      </motion.div>

      {/* Developer Quick Start - Only shown in developer mode */}
      {isDeveloperMode && (
        <motion.div variants={itemVariants}>
          <DeveloperQuickStart
            onDatasetGenerated={(datasetId) => {
              if (datasetId) {
                navigate("/datasets");
              }
            }}
          />
        </motion.div>
      )}

      {/* Recent Projects / Runs */}
      <motion.div variants={itemVariants}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            {t("dashboard.recentExperiments")}
          </h2>
          {recentRuns.length > 0 && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
              <Link to="/runs">
                {t("dashboard.viewAll")}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="step-card animate-pulse"
              >
                <div className="h-5 w-3/4 rounded bg-muted mb-2" />
                <div className="h-4 w-1/2 rounded bg-muted" />
                <div className="mt-4 border-t border-border/50 pt-4 flex justify-between">
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-6 w-16 rounded-full bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : recentRuns.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {recentRuns.map((run) => (
              <RecentProject
                key={run.id}
                id={run.id}
                name={run.name}
                dataset={run.dataset_name}
                lastRun={formatRelativeTime(run.created_at)}
                status={run.status}
                metric={
                  run.metric_name && run.metric_value !== undefined
                    ? { name: run.metric_name, value: run.metric_value }
                    : undefined
                }
                href={`/results?dataset=${encodeURIComponent(run.dataset_name || '')}`}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                  <Zap className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">
                  {t("dashboard.empty.title")}
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {t("dashboard.empty.description")}
                </p>
                <Button className="mt-4" asChild>
                  <Link to="/datasets">{t("dashboard.getStarted")}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.div>

      {/* Error state */}
      {error && (
        <motion.div variants={itemVariants}>
          <InlineError message="Failed to load dashboard data. Please try refreshing the page." />
        </motion.div>
      )}
    </motion.div>
  );
}
