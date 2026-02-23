/**
 * Copy only backend source files to backend-dist/ (no Python runtime or venv).
 * Used for lightweight installer builds where Python is downloaded at runtime.
 *
 * Usage:
 *   node scripts/copy-backend-source.cjs [--clean]
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const backendDist = path.join(projectRoot, "backend-dist");

const clean = process.argv.includes("--clean");

function copyDirSync(src, dest, excludePatterns = ["__pycache__", ".pyc"]) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludePatterns.some((p) => entry.name.includes(p))) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, excludePatterns);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDirSize(dirPath) {
  let totalSize = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += getDirSize(fullPath);
    } else {
      totalSize += fs.statSync(fullPath).size;
    }
  }
  return totalSize;
}

console.log("========================================");
console.log("  Copy Backend Source Files");
console.log("========================================");
console.log("");

// Clean if requested
if (clean && fs.existsSync(backendDist)) {
  fs.rmSync(backendDist, { recursive: true, force: true });
  console.log("  Cleaned backend-dist/");
}

fs.mkdirSync(backendDist, { recursive: true });

// Copy backend source files only
const items = [
  { src: "api", type: "dir" },
  { src: "websocket", type: "dir" },
  { src: "main.py", type: "file" },
  { src: "public", type: "dir" },
  { src: "recommended-config.json", type: "file" },
];

for (const item of items) {
  const srcPath = path.join(projectRoot, item.src);
  const destPath = path.join(backendDist, item.src);

  if (!fs.existsSync(srcPath)) {
    console.log(`  Warning: ${item.src} not found, skipping`);
    continue;
  }

  if (item.type === "dir") {
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
    copyDirSync(srcPath, destPath);
    console.log(`  Copied: ${item.src}/ (${formatSize(getDirSize(destPath))})`);
  } else {
    fs.copyFileSync(srcPath, destPath);
    console.log(`  Copied: ${item.src} (${formatSize(fs.statSync(destPath).size)})`);
  }
}

const totalSize = getDirSize(backendDist);
console.log("");
console.log(`  Total: ${formatSize(totalSize)}`);
console.log("  Output: backend-dist/ (source only, no Python/venv)");
console.log("");
