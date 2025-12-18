import { motion } from "framer-motion";
import { Database, Plus, Search, FolderOpen, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

// Placeholder component for datasets page
export default function Datasets() {
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
          <h1 className="text-2xl font-bold tracking-tight">Datasets</h1>
          <p className="text-muted-foreground">
            Manage your spectral datasets and configurations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <FolderOpen className="mr-2 h-4 w-4" />
            Browse
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Dataset
          </Button>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div variants={itemVariants} className="grid gap-4 md:grid-cols-3">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Datasets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Samples
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Storage Used
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0 MB</div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Search and Filter */}
      <motion.div variants={itemVariants} className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search datasets..." className="pl-9" />
        </div>
        <Button variant="outline" size="icon">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </motion.div>

      {/* Empty State */}
      <motion.div variants={itemVariants}>
        <Card>
          <CardContent className="p-12">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-4">
                <Database className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                No datasets yet
              </h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Get started by adding a dataset. You can link a folder containing
                your spectral data files (CSV, JCAMP-DX, or other supported formats).
              </p>
              <div className="flex gap-3">
                <Button variant="outline">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Select Folder
                </Button>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Dataset
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Workspace Info */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="outline">Workspace</Badge>
              <span className="text-sm text-muted-foreground">
                No workspace selected
              </span>
            </div>
            <Button variant="ghost" size="sm">
              Select Workspace
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
