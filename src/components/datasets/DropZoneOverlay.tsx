/**
 * DropZoneOverlay - Full-screen overlay for drag-and-drop file/folder import
 *
 * Provides visual feedback when files are dragged over the datasets page.
 * Automatically detects folder vs files and shows appropriate messaging.
 */
import { useState, useRef, useCallback, useEffect } from "react";
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

/**
 * Hook to manage drag-and-drop state
 */
export interface DroppedContent {
  type: "folder" | "files";
  path: string;
  paths: string[];
  items: File[];
}

export interface UseDragDropOptions {
  onDrop: (content: DroppedContent) => void;
  disabled?: boolean;
}

export function useDragDrop({ onDrop, disabled }: UseDragDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [dropType, setDropType] = useState<"folder" | "files" | "unknown">("unknown");
  const [itemCount, setItemCount] = useState(0);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);

        // Try to detect type from DataTransfer
        const items = e.dataTransfer?.items;
        if (items && items.length > 0) {
          setItemCount(items.length);

          // Check if it's a folder (webkitGetAsEntry for directories)
          const firstItem = items[0];
          if (firstItem.webkitGetAsEntry) {
            const entry = firstItem.webkitGetAsEntry();
            if (entry?.isDirectory) {
              setDropType("folder");
            } else if (entry?.isFile) {
              setDropType("files");
            } else {
              setDropType("unknown");
            }
          } else {
            // Fallback: assume files
            setDropType(items.length === 1 ? "unknown" : "files");
          }
        }
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
        setDropType("unknown");
        setItemCount(0);
      }
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [disabled]
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      dragCounterRef.current = 0;
      setIsDragging(false);
      setDropType("unknown");
      setItemCount(0);

      const items = e.dataTransfer?.items;
      const files = e.dataTransfer?.files;

      if (!items || items.length === 0) return;

      // Process dropped items
      const paths: string[] = [];
      const fileList: File[] = [];
      let isFolder = false;

      // Use webkitGetAsEntry for better folder support
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry?.isDirectory) {
            isFolder = true;
            // For folders, we need the path - use the File API path if available
            const file = files?.[i];
            if (file) {
              // In Electron/pywebview, file.path contains the actual path
              const filePath = (file as File & { path?: string }).path;
              if (filePath) {
                paths.push(filePath);
              }
            }
          } else if (entry?.isFile) {
            const file = files?.[i];
            if (file) {
              fileList.push(file);
              const filePath = (file as File & { path?: string }).path;
              if (filePath) {
                paths.push(filePath);
              }
            }
          }
        } else if (files?.[i]) {
          // Fallback for browsers without webkitGetAsEntry
          fileList.push(files[i]);
          const filePath = (files[i] as File & { path?: string }).path;
          if (filePath) {
            paths.push(filePath);
          }
        }
      }

      if (paths.length > 0) {
        onDrop({
          type: isFolder ? "folder" : "files",
          path: paths[0],
          paths,
          items: fileList,
        });
      }
    },
    [disabled, onDrop]
  );

  useEffect(() => {
    if (disabled) return;

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [disabled, handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return {
    isDragging,
    dropType,
    itemCount,
  };
}
