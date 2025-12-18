import { motion } from "framer-motion";
import { useParams, useNavigate } from "react-router-dom";
import { Save, Play, Undo, Redo, Trash2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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

// Component categories for the palette
const componentCategories = [
  {
    name: "Preprocessing",
    color: "bg-blue-500",
    items: ["StandardScaler", "SNV", "MSC", "Savitzky-Golay", "Baseline Correction"],
  },
  {
    name: "Splitting",
    color: "bg-purple-500",
    items: ["Train/Test Split", "K-Fold CV", "LOOCV", "Stratified K-Fold"],
  },
  {
    name: "Models",
    color: "bg-green-500",
    items: ["PLS Regression", "Random Forest", "SVM", "Neural Network", "XGBoost"],
  },
  {
    name: "Metrics",
    color: "bg-orange-500",
    items: ["R² Score", "RMSE", "MAE", "RPD", "Bias"],
  },
];

export default function PipelineEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";

  return (
    <motion.div
      className="h-full flex flex-col gap-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Toolbar */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/pipelines")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Input
            placeholder="Pipeline name..."
            defaultValue={isNew ? "" : "My Pipeline"}
            className="w-64 font-semibold"
          />
          <Badge variant="outline">
            {isNew ? "New" : "Draft"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled>
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" disabled>
            <Redo className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button variant="outline">
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
          <Button>
            <Play className="mr-2 h-4 w-4" />
            Run
          </Button>
        </div>
      </motion.div>

      {/* Main Editor Area */}
      <motion.div variants={itemVariants} className="flex-1 grid grid-cols-12 gap-4">
        {/* Component Library */}
        <div className="col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Components</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {componentCategories.map((category) => (
                <div key={category.name}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-2 h-2 rounded-full ${category.color}`} />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {category.name}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {category.items.map((item) => (
                      <div
                        key={item}
                        className="px-3 py-2 text-sm rounded-md border border-border/50 bg-card cursor-grab hover:border-primary/50 hover:bg-primary/5 transition-colors"
                        draggable
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Canvas */}
        <div className="col-span-6">
          <Card className="h-full">
            <CardContent className="h-full p-6 flex flex-col items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">
                  Drop components here
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Drag components from the library on the left to build your pipeline.
                  Connect preprocessing, splitting, model, and metrics steps.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Configuration Panel */}
        <div className="col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground text-sm">
                Select a component to configure its parameters
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </motion.div>
  );
}
