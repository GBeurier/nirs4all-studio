import { motion } from "framer-motion";
import { FlaskConical, Upload, Wand2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

export default function Playground() {
  return (
    <motion.div
      className="h-full flex flex-col gap-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Playground</h1>
          <p className="text-muted-foreground">
            Interactive spectral visualization and preprocessing exploration
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Upload className="mr-2 h-4 w-4" />
            Load Data
          </Button>
          <Button>
            <Wand2 className="mr-2 h-4 w-4" />
            Demo Data
          </Button>
        </div>
      </motion.div>

      {/* Main Content */}
      <motion.div variants={itemVariants} className="flex-1">
        <Card className="h-full">
          <CardContent className="h-full p-6">
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 mb-6">
                <FlaskConical className="h-12 w-12 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold text-foreground mb-3">
                Spectral Playground
              </h3>
              <p className="text-muted-foreground max-w-lg mb-6">
                Load spectral data to visualize, explore, and apply preprocessing
                transformations in real-time. Build and test your preprocessing
                chain before using it in a pipeline.
              </p>
              <div className="flex gap-4">
                <Button variant="outline" size="lg">
                  <Upload className="mr-2 h-5 w-5" />
                  Upload Spectra
                </Button>
                <Button size="lg">
                  <Wand2 className="mr-2 h-5 w-5" />
                  Try Demo Data
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-6">
                Supported formats: CSV, JCAMP-DX, Excel
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
