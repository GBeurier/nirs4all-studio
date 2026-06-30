import { AnimatePresence, motion } from "@/lib/motion";
import { PipelineCard, PipelineRow } from "@/components/pipelines";
import { cn } from "@/lib/utils";
import type { Pipeline, ViewMode } from "@/types/pipelines";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface PipelinesCollectionViewProps {
  collectionKey: string;
  onDelete: (pipeline: Pipeline) => void;
  onDuplicate: (pipeline: Pipeline) => void | Promise<void>;
  onExport: (pipeline: Pipeline) => void;
  onToggleFavorite: (pipelineId: string) => void | Promise<void>;
  pipelines: Pipeline[];
  viewMode: ViewMode;
}

export function PipelinesCollectionView({
  collectionKey,
  onDelete,
  onDuplicate,
  onExport,
  onToggleFavorite,
  pipelines,
  viewMode,
}: PipelinesCollectionViewProps) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={`${collectionKey}-${viewMode}`}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className={cn(
          viewMode === "grid"
            ? "grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            : "space-y-2"
        )}
      >
        {pipelines.map((pipeline) =>
          viewMode === "grid" ? (
            <motion.div key={pipeline.id} variants={itemVariants} layout>
              <PipelineCard
                pipeline={pipeline}
                onToggleFavorite={() => void onToggleFavorite(pipeline.id)}
                onDuplicate={() => void onDuplicate(pipeline)}
                onDelete={() => onDelete(pipeline)}
                onExport={() => onExport(pipeline)}
              />
            </motion.div>
          ) : (
            <motion.div key={pipeline.id} variants={itemVariants} layout>
              <PipelineRow
                pipeline={pipeline}
                onToggleFavorite={() => void onToggleFavorite(pipeline.id)}
                onDuplicate={() => void onDuplicate(pipeline)}
                onDelete={() => onDelete(pipeline)}
                onExport={() => onExport(pipeline)}
              />
            </motion.div>
          )
        )}
      </motion.div>
    </AnimatePresence>
  );
}
