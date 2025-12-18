import { motion } from "framer-motion";
import { Play, Plus, Search, Clock, CheckCircle2, XCircle, Pause } from "lucide-react";
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

const statusConfig = {
  queued: { icon: Clock, color: "text-muted-foreground", bg: "bg-muted" },
  running: { icon: Play, color: "text-warning", bg: "bg-warning/10" },
  completed: { icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
  failed: { icon: XCircle, color: "text-destructive", bg: "bg-destructive/10" },
  paused: { icon: Pause, color: "text-muted-foreground", bg: "bg-muted" },
};

export default function Runs() {
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
          <h1 className="text-2xl font-bold tracking-tight">Runs</h1>
          <p className="text-muted-foreground">
            Manage and monitor your experiment runs
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Run
        </Button>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid gap-4 md:grid-cols-4">
        {Object.entries(statusConfig).slice(0, 4).map(([status, config]) => {
          const Icon = config.icon;
          return (
            <Card key={status} className="glass-card">
              <CardContent className="p-4 flex items-center gap-4">
                <div className={`p-2 rounded-lg ${config.bg}`}>
                  <Icon className={`h-5 w-5 ${config.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">0</p>
                  <p className="text-xs text-muted-foreground capitalize">{status}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </motion.div>

      {/* Search */}
      <motion.div variants={itemVariants} className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search runs..." className="pl-9" />
        </div>
      </motion.div>

      {/* Empty State */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Play className="h-10 w-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No runs yet
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Start a new run to train models on your datasets using your
                configured pipelines. Track progress and compare results.
              </p>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Start New Run
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Run Guide */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">How to start a run</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  1
                </Badge>
                <div>
                  <p className="font-medium text-sm">Select Dataset(s)</p>
                  <p className="text-xs text-muted-foreground">
                    Choose one or more datasets for training
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  2
                </Badge>
                <div>
                  <p className="font-medium text-sm">Choose Pipeline(s)</p>
                  <p className="text-xs text-muted-foreground">
                    Select pipelines to run on each dataset
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  3
                </Badge>
                <div>
                  <p className="font-medium text-sm">Configure & Launch</p>
                  <p className="text-xs text-muted-foreground">
                    Set options and start the experiment
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
