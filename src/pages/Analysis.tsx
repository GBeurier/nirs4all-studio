import { motion } from "@/lib/motion";
import { Beaker, BarChart3, TrendingUp, Layers, Settings2, type LucideIcon } from "lucide-react";
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
  title: string;
  description: string;
  icon: LucideIcon;
  status: "available" | "coming-soon" | "beta";
  href?: string;
}

const analysisTools: AnalysisToolProps[] = [
  {
    title: "PCA Analysis",
    description: "Principal Component Analysis for dimensionality reduction and data exploration",
    icon: Layers,
    status: "available",
    href: "/analysis/pca",
  },
  {
    title: "Variable Importance",
    description: "Identify the most important wavelengths and spectral regions",
    icon: TrendingUp,
    status: "available",
    href: "/analysis/importance",
  },
  {
    title: "Model Comparison",
    description: "Compare performance across different models and pipelines",
    icon: BarChart3,
    status: "available",
    href: "/analysis/comparison",
  },
  {
    title: "Residual Analysis",
    description: "Analyze prediction residuals and identify outliers",
    icon: Settings2,
    status: "beta",
    href: "/analysis/residuals",
  },
];

function AnalysisToolCard({ title, description, icon: Icon, status }: AnalysisToolProps) {
  return (
    <Card className="step-card cursor-pointer transition-all duration-300 hover:border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          {status === "beta" && (
            <Badge variant="outline" className="text-warning border-warning/50">
              Beta
            </Badge>
          )}
          {status === "coming-soon" && (
            <Badge variant="outline" className="text-muted-foreground">
              Coming Soon
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-base mb-2">{title}</CardTitle>
        <CardDescription className="text-sm">{description}</CardDescription>
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-4"
          disabled={status === "coming-soon"}
        >
          {status === "coming-soon" ? "Not Available" : "Open Tool"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function Analysis() {
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
          <h1 className="text-2xl font-bold tracking-tight">Analysis</h1>
          <p className="text-muted-foreground">
            Advanced tools for exploring and analyzing your spectral data
          </p>
        </div>
      </motion.div>

      {/* Analysis Tools Grid */}
      <motion.div variants={itemVariants}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {analysisTools.map((tool) => (
            <AnalysisToolCard key={tool.title} {...tool} />
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
                  Getting Started with Analysis
                </h3>
                <p className="text-muted-foreground mb-4">
                  Analysis tools help you understand your spectral data better. Start with PCA to
                  explore patterns, then use variable importance to identify key wavelengths.
                  Compare models to find the best approach for your application.
                </p>
                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                  <Badge variant="secondary">Requires completed runs</Badge>
                  <Badge variant="secondary">Export to CSV/PDF</Badge>
                  <Badge variant="secondary">Interactive visualizations</Badge>
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
              Run experiments first to generate data for analysis. Your results will appear here
              once you have completed runs.
            </p>
            <Button variant="outline" size="sm">
              View Runs
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
