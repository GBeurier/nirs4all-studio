import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "@/lib/motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Database,
  GitBranch,
  Settings,
  Play,
  Star,
  Search,
  Filter,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

// Mock datasets
const mockDatasets = [
  {
    id: "1",
    name: "wheat_nir.csv",
    samples: 240,
    features: 2150,
    target: "Protein",
  },
  {
    id: "2",
    name: "corn_moisture.csv",
    samples: 180,
    features: 1850,
    target: "Moisture",
  },
  {
    id: "3",
    name: "soybean_oil.spc",
    samples: 320,
    features: 2048,
    target: "Oil",
  },
  {
    id: "4",
    name: "rice_quality.jdx",
    samples: 150,
    features: 1900,
    target: "Quality",
  },
  {
    id: "5",
    name: "dairy_fat.csv",
    samples: 420,
    features: 2200,
    target: "Fat",
  },
];

// Mock pipelines
const mockPipelines = [
  {
    id: "1",
    name: "SNV + PLS Optimal",
    preset: true,
    favorite: true,
    steps: "SNV → SG(1,2) → PLS(3-15)",
  },
  {
    id: "2",
    name: "MSC Standard",
    preset: true,
    favorite: false,
    steps: "MSC → KFold(5) → PLS(10)",
  },
  {
    id: "3",
    name: "Deep Learning CNN",
    preset: true,
    favorite: true,
    steps: "SNV → Normalize → CNN1D",
  },
  {
    id: "4",
    name: "Ensemble Grid Search",
    preset: false,
    favorite: true,
    steps: "Alternatives[SNV,MSC] → RF+XGB",
  },
  {
    id: "5",
    name: "SVR Optimized",
    preset: false,
    favorite: false,
    steps: "SG(2) → PCA(20) → SVR",
  },
  {
    id: "6",
    name: "Custom PLS Range",
    preset: false,
    favorite: true,
    steps: "SNV → PLS(Range[5,20,1])",
  },
  {
    id: "7",
    name: "Multi-Target PLS",
    preset: true,
    favorite: false,
    steps: "MSC → MultiPLS → Optuna",
  },
  {
    id: "8",
    name: "Baseline Standard",
    preset: true,
    favorite: false,
    steps: "Center → Scale → PLS(8)",
  },
];

const steps = [
  { id: 1, label: "Select Datasets", icon: Database },
  { id: 2, label: "Select Pipelines", icon: GitBranch },
  { id: 3, label: "Configure", icon: Settings },
  { id: 4, label: "Launch", icon: Play },
];

export default function NewExperiment() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [experimentName, setExperimentName] = useState("");
  const [experimentDescription, setExperimentDescription] = useState("");
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [selectedPipelines, setSelectedPipelines] = useState<string[]>([]);
  const [datasetSearch, setDatasetSearch] = useState("");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState<
    "all" | "favorites" | "presets"
  >("all");
  const [cvFolds, setCvFolds] = useState("5");
  const [cvStrategy, setCvStrategy] = useState("kfold");
  const [shuffle, setShuffle] = useState(true);

  const toggleDataset = (id: string) => {
    setSelectedDatasets((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const togglePipeline = (id: string) => {
    setSelectedPipelines((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const filteredDatasets = mockDatasets.filter((d) =>
    d.name.toLowerCase().includes(datasetSearch.toLowerCase())
  );

  const filteredPipelines = mockPipelines.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(pipelineSearch.toLowerCase()) ||
      p.steps.toLowerCase().includes(pipelineSearch.toLowerCase());
    if (pipelineFilter === "favorites") return matchesSearch && p.favorite;
    if (pipelineFilter === "presets") return matchesSearch && p.preset;
    return matchesSearch;
  });

  const canProceed = () => {
    if (currentStep === 1) return selectedDatasets.length > 0;
    if (currentStep === 2) return selectedPipelines.length > 0;
    if (currentStep === 3) return experimentName.trim().length > 0;
    return true;
  };

  const totalRuns = selectedDatasets.length * selectedPipelines.length;

  const handleLaunch = () => {
    // TODO: Call API to create and start the run
    console.log("Launching experiment:", {
      name: experimentName,
      description: experimentDescription,
      datasets: selectedDatasets,
      pipelines: selectedPipelines,
      cvFolds,
      cvStrategy,
      shuffle,
    });
    navigate("/runs");
  };

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/runs")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Experiment</h1>
          <p className="text-muted-foreground">
            Create and launch pipeline experiments
          </p>
        </div>
      </motion.div>

      {/* Step Indicator */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between max-w-2xl mx-auto"
      >
        {steps.map((step, index) => {
          const StepIcon = step.icon;
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          return (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : isCompleted
                      ? "border-chart-1 bg-chart-1 text-primary-foreground"
                      : "border-border bg-card text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs mt-2",
                    isActive
                      ? "text-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "w-24 h-0.5 mx-2",
                    isCompleted ? "bg-chart-1" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </motion.div>

      {/* Step Content */}
      <motion.div variants={itemVariants}>
        <Card className="max-w-4xl mx-auto">
          <CardContent className="p-6">
            {/* Step 1: Select Datasets */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">
                    Select Datasets
                  </h2>
                  <Badge variant="secondary">
                    {selectedDatasets.length} selected
                  </Badge>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search datasets..."
                    value={datasetSearch}
                    onChange={(e) => setDatasetSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {filteredDatasets.map((dataset) => (
                    <div
                      key={dataset.id}
                      onClick={() => toggleDataset(dataset.id)}
                      className={cn(
                        "p-4 border rounded-lg cursor-pointer transition-colors",
                        selectedDatasets.includes(dataset.id)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedDatasets.includes(dataset.id)}
                          onCheckedChange={() => toggleDataset(dataset.id)}
                        />
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {dataset.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {dataset.samples} samples • {dataset.features}{" "}
                            features • Target: {dataset.target}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 2: Select Pipelines */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">
                    Select Pipelines
                  </h2>
                  <Badge variant="secondary">
                    {selectedPipelines.length} selected
                  </Badge>
                </div>
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search pipelines..."
                      value={pipelineSearch}
                      onChange={(e) => setPipelineSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select
                    value={pipelineFilter}
                    onValueChange={(v: "all" | "favorites" | "presets") =>
                      setPipelineFilter(v)
                    }
                  >
                    <SelectTrigger className="w-40">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Pipelines</SelectItem>
                      <SelectItem value="favorites">Favorites</SelectItem>
                      <SelectItem value="presets">Presets</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {filteredPipelines.map((pipeline) => (
                    <div
                      key={pipeline.id}
                      onClick={() => togglePipeline(pipeline.id)}
                      className={cn(
                        "p-4 border rounded-lg cursor-pointer transition-colors",
                        selectedPipelines.includes(pipeline.id)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedPipelines.includes(pipeline.id)}
                          onCheckedChange={() => togglePipeline(pipeline.id)}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground">
                              {pipeline.name}
                            </p>
                            {pipeline.favorite && (
                              <Star className="h-3 w-3 fill-chart-2 text-chart-2" />
                            )}
                            {pipeline.preset && (
                              <Badge variant="outline" className="text-xs">
                                Preset
                              </Badge>
                            )}
                          </div>
                          <code className="text-sm text-muted-foreground">
                            {pipeline.steps}
                          </code>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Configure */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-foreground">
                  Configure Experiment
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Experiment Name *
                    </label>
                    <Input
                      value={experimentName}
                      onChange={(e) => setExperimentName(e.target.value)}
                      placeholder="e.g., Wheat Protein Optimization"
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">
                      Description
                    </label>
                    <Textarea
                      value={experimentDescription}
                      onChange={(e) => setExperimentDescription(e.target.value)}
                      placeholder="Optional description for this experiment..."
                      className="mt-1.5"
                      rows={2}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground">
                        Cross-Validation Strategy
                      </label>
                      <Select value={cvStrategy} onValueChange={setCvStrategy}>
                        <SelectTrigger className="mt-1.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kfold">K-Fold</SelectItem>
                          <SelectItem value="stratified">Stratified K-Fold</SelectItem>
                          <SelectItem value="loo">Leave-One-Out</SelectItem>
                          <SelectItem value="holdout">Holdout</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground">
                        Number of Folds
                      </label>
                      <Select
                        value={cvFolds}
                        onValueChange={setCvFolds}
                        disabled={cvStrategy === "loo"}
                      >
                        <SelectTrigger className="mt-1.5">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="3">3-fold</SelectItem>
                          <SelectItem value="5">5-fold</SelectItem>
                          <SelectItem value="10">10-fold</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="shuffle"
                      checked={shuffle}
                      onCheckedChange={(checked) => setShuffle(checked === true)}
                    />
                    <label
                      htmlFor="shuffle"
                      className="text-sm font-medium text-foreground cursor-pointer"
                    >
                      Shuffle data before splitting
                    </label>
                  </div>
                </div>
                <Card className="bg-muted/30">
                  <CardContent className="p-4">
                    <h3 className="font-medium text-foreground mb-3">Summary</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Datasets:</span>
                        <span className="ml-2 text-foreground">
                          {selectedDatasets.length}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Pipelines:</span>
                        <span className="ml-2 text-foreground">
                          {selectedPipelines.length}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Runs:</span>
                        <span className="ml-2 text-foreground font-semibold">
                          {totalRuns}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">CV Strategy:</span>
                        <span className="ml-2 text-foreground">
                          {cvStrategy === "loo"
                            ? "LOO"
                            : `${cvFolds}-fold ${cvStrategy}`}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Step 4: Launch */}
            {currentStep === 4 && (
              <div className="space-y-6 text-center py-8">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Play className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-foreground">
                    {experimentName}
                  </h2>
                  {experimentDescription && (
                    <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                      {experimentDescription}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-2">
                    {totalRuns} runs across {selectedDatasets.length} datasets
                    and {selectedPipelines.length} pipelines
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {selectedDatasets.map((id) => {
                    const dataset = mockDatasets.find((d) => d.id === id);
                    return (
                      <Badge key={id} variant="secondary">
                        {dataset?.name}
                      </Badge>
                    );
                  })}
                </div>
                <Button size="lg" onClick={handleLaunch}>
                  <Play className="h-4 w-4 mr-2" />
                  Launch Experiment
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Navigation */}
      {currentStep < 4 && (
        <motion.div
          variants={itemVariants}
          className="flex justify-between max-w-4xl mx-auto"
        >
          <Button
            variant="outline"
            onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
            disabled={currentStep === 1}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={() => setCurrentStep((prev) => Math.min(4, prev + 1))}
            disabled={!canProceed()}
          >
            Next
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
