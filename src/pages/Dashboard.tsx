import { motion } from "framer-motion";
import {
  Database,
  GitBranch,
  Play,
  BarChart3,
  Plus,
  Upload,
  FlaskConical,
  TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  trend?: { value: number; isPositive: boolean };
}

function StatCard({ title, value, description, icon: Icon, trend }: StatCardProps) {
  return (
    <motion.div variants={itemVariants}>
      <Card className="stats-card">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
          {trend && (
            <div className="flex items-center mt-2 text-xs">
              <TrendingUp
                className={`h-3 w-3 mr-1 ${
                  trend.isPositive ? "text-success" : "text-destructive"
                }`}
              />
              <span
                className={
                  trend.isPositive ? "text-success" : "text-destructive"
                }
              >
                {trend.isPositive ? "+" : ""}
                {trend.value}%
              </span>
              <span className="text-muted-foreground ml-1">from last week</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface QuickActionProps {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
}

function QuickAction({ title, description, icon: Icon, href }: QuickActionProps) {
  return (
    <motion.div variants={itemVariants}>
      <Link to={href}>
        <Card className="action-card h-full">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-3">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground text-center mt-1">
            {description}
          </p>
        </Card>
      </Link>
    </motion.div>
  );
}

export default function Dashboard() {
  // Mock data - will be replaced with API calls
  const stats = {
    datasets: 12,
    pipelines: 8,
    experiments: 24,
    avgR2: 0.94,
  };

  const quickActions: QuickActionProps[] = [
    {
      title: "Load Dataset",
      description: "Import spectral data",
      icon: Upload,
      href: "/datasets",
    },
    {
      title: "Build Pipeline",
      description: "Create ML workflow",
      icon: Plus,
      href: "/pipelines/new",
    },
    {
      title: "Playground",
      description: "Explore spectra",
      icon: FlaskConical,
      href: "/playground",
    },
    {
      title: "View Results",
      description: "Analyze performance",
      icon: BarChart3,
      href: "/results",
    },
  ];

  return (
    <motion.div
      className="space-y-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Welcome Section */}
      <motion.div variants={itemVariants} className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome to <span className="text-gradient">nirs4all</span>
        </h1>
        <p className="text-muted-foreground">
          Your unified platform for NIRS spectral analysis and machine learning.
        </p>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Datasets"
          value={stats.datasets}
          description="Total loaded"
          icon={Database}
          trend={{ value: 12, isPositive: true }}
        />
        <StatCard
          title="Pipelines"
          value={stats.pipelines}
          description="Created"
          icon={GitBranch}
        />
        <StatCard
          title="Experiments"
          value={stats.experiments}
          description="Completed"
          icon={Play}
          trend={{ value: 8, isPositive: true }}
        />
        <StatCard
          title="Avg. R²"
          value={stats.avgR2.toFixed(2)}
          description="Best models"
          icon={BarChart3}
          trend={{ value: 2.5, isPositive: true }}
        />
      </div>

      {/* Quick Actions */}
      <motion.div variants={itemVariants} className="space-y-4">
        <h2 className="text-xl font-semibold">Quick Actions</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => (
            <QuickAction key={action.title} {...action} />
          ))}
        </div>
      </motion.div>

      {/* Recent Activity */}
      <motion.div variants={itemVariants} className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recent Activity</h2>
          <Button variant="ghost" size="sm">
            View all
          </Button>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
                <Play className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">
                No recent activity
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Start by loading a dataset or creating a pipeline to see your
                activity here.
              </p>
              <Button className="mt-4" asChild>
                <Link to="/datasets">Get Started</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
