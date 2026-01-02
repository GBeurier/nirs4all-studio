import { motion } from "framer-motion";
import { BarChart3, Search, Filter, Download, ArrowUpDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

const groupByOptions = [
  { value: "dataset", label: "Dataset" },
  { value: "model", label: "Model" },
  { value: "pipeline", label: "Pipeline" },
  { value: "experiment", label: "Experiment" },
  { value: "preprocessing", label: "Preprocessing" },
];

export default function Results() {
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
          <h1 className="text-2xl font-bold tracking-tight">Results</h1>
          <p className="text-muted-foreground">
            View and compare model performance across experiments
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div variants={itemVariants} className="flex flex-wrap gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search results..." className="pl-9" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <ArrowUpDown className="mr-2 h-4 w-4" />
              Group by: Dataset
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {groupByOptions.map((option) => (
              <DropdownMenuItem key={option.value}>
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline">
          <Filter className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </motion.div>

      {/* Metrics Summary */}
      <motion.div variants={itemVariants} className="grid gap-4 md:grid-cols-5">
        {[
          { label: "R²", value: "-", description: "Coefficient of determination" },
          { label: "RMSE", value: "-", description: "Root mean square error" },
          { label: "MAE", value: "-", description: "Mean absolute error" },
          { label: "RPD", value: "-", description: "Ratio of performance to deviation" },
          { label: "nRMSE", value: "-", description: "Normalized RMSE" },
        ].map((metric) => (
          <Card key={metric.label} className="glass-card">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">{metric.label}</p>
              <p className="text-2xl font-bold">{metric.value}</p>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Empty State */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                <BarChart3 className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No results yet
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Run experiments to generate results. Compare model performance,
                view prediction plots, and analyze residuals.
              </p>
              <Badge variant="outline" className="text-muted-foreground">
                Waiting for completed runs
              </Badge>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
