import { motion } from "framer-motion";
import { GitBranch, Plus, Search, Star, Clock, Users, FileJson } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const tabs = [
  { id: "all", label: "All", icon: GitBranch },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "mine", label: "My Pipelines", icon: Users },
  { id: "presets", label: "Presets", icon: FileJson },
  { id: "recent", label: "Recent", icon: Clock },
];

export default function Pipelines() {
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
          <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
          <p className="text-muted-foreground">
            Create and manage your ML processing pipelines
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <FileJson className="mr-2 h-4 w-4" />
            Import
          </Button>
          <Button asChild>
            <Link to="/pipelines/new">
              <Plus className="mr-2 h-4 w-4" />
              New Pipeline
            </Link>
          </Button>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div variants={itemVariants} className="flex gap-1 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={tab.id === "all" ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0"
          >
            <tab.icon className="mr-2 h-4 w-4" />
            {tab.label}
          </Button>
        ))}
      </motion.div>

      {/* Search */}
      <motion.div variants={itemVariants} className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search pipelines..." className="pl-9" />
        </div>
      </motion.div>

      {/* Empty State */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                <GitBranch className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No pipelines yet
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Create your first pipeline to define a preprocessing, model, and
                evaluation workflow. Pipelines can be reused across different datasets.
              </p>
              <div className="flex gap-3">
                <Button variant="outline">
                  <FileJson className="mr-2 h-4 w-4" />
                  Import Pipeline
                </Button>
                <Button asChild>
                  <Link to="/pipelines/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Pipeline
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Preset Pipelines */}
      <motion.div variants={itemVariants} className="space-y-4">
        <h2 className="text-lg font-semibold">Preset Pipelines</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            { name: "Food Analysis", description: "Standard preprocessing for food samples", category: "preset" },
            { name: "Pharma QC", description: "Quality control for pharmaceutical samples", category: "preset" },
            { name: "Basic Regression", description: "Simple PLS regression pipeline", category: "preset" },
          ].map((preset) => (
            <Card key={preset.name} className="step-card cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{preset.name}</h3>
                  <Badge variant="outline" className="text-xs">
                    Preset
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  {preset.description}
                </p>
                <Button variant="ghost" size="sm" className="w-full">
                  Use as Template
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
