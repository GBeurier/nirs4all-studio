/**
 * DropZoneOverlay - Full-screen overlay for drag-and-drop file/folder import
 *
 * Provides visual feedback when files are dragged over the datasets page.
 * Automatically detects folder vs files and shows appropriate messaging.
 */
import { motion, AnimatePresence } from "@/lib/motion";
import { Folder, FileSpreadsheet, Upload } from "lucide-react";

interface DropZoneOverlayProps {
  /** Whether the overlay is visible */
  isVisible: boolean;
  /** Type of content being dragged (detected from DataTransfer) */
  dropType: "folder" | "files" | "unknown";
  /** Number of items being dragged */
  itemCount: number;
}

export function DropZoneOverlay({
  isVisible,
  dropType,
  itemCount,
}: DropZoneOverlayProps) {
  const getIcon = () => {
    switch (dropType) {
      case "folder":
        return <Folder className="h-16 w-16" />;
      case "files":
        return <FileSpreadsheet className="h-16 w-16" />;
      default:
        return <Upload className="h-16 w-16" />;
    }
  };

  const getMessage = () => {
    switch (dropType) {
      case "folder":
        return "Drop folder to import dataset";
      case "files":
        return itemCount > 1
          ? `Drop ${itemCount} files to import`
          : "Drop file to import";
      default:
        return "Drop files or folder to import";
    }
  };

  const getSubMessage = () => {
    switch (dropType) {
      case "folder":
        return "Files will be auto-detected and mapped";
      case "files":
        return "Configure file roles in the wizard";
      default:
        return "Supported: CSV, Excel, Parquet, NPY, NPZ";
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex flex-col items-center gap-6 p-12 rounded-2xl border-2 border-dashed border-primary bg-primary/5"
          >
            {/* Animated icon container */}
            <motion.div
              animate={{
                y: [0, -8, 0],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="text-primary"
            >
              {getIcon()}
            </motion.div>

            {/* Main message */}
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                {getMessage()}
              </h2>
              <p className="text-muted-foreground">{getSubMessage()}</p>
            </div>

            {/* Visual indicator ring */}
            <motion.div
              animate={{
                scale: [1, 1.1, 1],
                opacity: [0.5, 0.8, 0.5],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="absolute inset-0 rounded-2xl border-2 border-primary/30 pointer-events-none"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
