export const DEFAULT_IN_MEMORY_THRESHOLD = 500 * 1024 * 1024;
export const DEFAULT_BLOB_THRESHOLD = 10 * 1024 * 1024 * 1024;
export const DEFAULT_MAX_RATIO = 1000;

export function recommendedMode(fileSize, deviceMemoryGb) {
  const memoryGb = deviceMemoryGb || 4;
  const maxBlobSize = DEFAULT_BLOB_THRESHOLD;

  if (fileSize < DEFAULT_IN_MEMORY_THRESHOLD) {
    return "in-memory";
  }
  if (fileSize <= maxBlobSize) {
    return "blob";
  }
  return "streaming";
}

export function sizeWarning(fileSize, deviceMemoryGb) {
  const memoryGb = deviceMemoryGb || 4;
  const fileGb = fileSize / (1024 * 1024 * 1024);

  if (fileGb > memoryGb * 2) {
    return `File size ${fileGb.toFixed(1)}GB is large for ${memoryGb}GB RAM. Consider streaming mode.`;
  }
  return null;
}

export function browserSupportWarnings() {
  const issues = [];
  if (typeof DecompressionStream === "undefined") {
    issues.push("DecompressionStream not available.");
  }
  if (typeof Worker === "undefined") {
    issues.push("Web Workers not available.");
  }
  return issues;
}

export async function detectCompression(blob) {
  const header = await blob.slice(0, 4).arrayBuffer();
  const view = new Uint8Array(header);
  if (view[0] === 0x1f && view[1] === 0x8b) {
    return "gzip";
  }
  if (view[0] === 0x42 && view[1] === 0x5a) {
    return "bzip2";
  }
  if (view[0] === 0xfd && view[1] === 0x37) {
    return "xz";
  }
  if (view[0] === 0x58 && view[1] === 0x0a) {
    return "rds";
  }
  return "unknown";
}

function parseGzipHeader(bytes, index) {
  if (index + 10 > bytes.length) return null;
  if (bytes[index] !== 0x1f || bytes[index + 1] !== 0x8b || bytes[index + 2] !== 0x08) {
    return null;
  }
  const flags = bytes[index + 3];
  if ((flags & 0xe0) !== 0) return null;
  let cursor = index + 10;
  if (flags & 0x04) {
    if (cursor + 2 > bytes.length) return null;
    const xlen = bytes[cursor] | (bytes[cursor + 1] << 8);
    cursor += 2 + xlen;
    if (cursor > bytes.length) return null;
  }
  if (flags & 0x08) {
    while (cursor < bytes.length && bytes[cursor] !== 0) cursor += 1;
    if (cursor >= bytes.length) return null;
    cursor += 1;
  }
  if (flags & 0x10) {
    while (cursor < bytes.length && bytes[cursor] !== 0) cursor += 1;
    if (cursor >= bytes.length) return null;
    cursor += 1;
  }
  if (flags & 0x02) {
    if (cursor + 2 > bytes.length) return null;
    cursor += 2;
  }
  return cursor - index;
}

function findGzipMemberOffsets(buffer) {
  const bytes = new Uint8Array(buffer);
  const offsets = [];
  for (let i = 0; i + 10 <= bytes.length; i += 1) {
    if (parseGzipHeader(bytes, i) !== null) {
      offsets.push(i);
    }
  }
  try {
    console.debug("gzip header scan", {
      size: blob.size,
      rawMatches,
      validated: offsets.length,
    });
  } catch {
    // ignore logging failures
  }
  return offsets;
}

async function findGzipMemberOffsetsFromBlob(blob, chunkSize = 8 * 1024 * 1024) {
  const offsets = [];
  let rawMatches = 0;
  let offset = 0;
  let carry = new Uint8Array(0);
  const carryLimit = 64 * 1024;
  while (offset < blob.size) {
    const end = Math.min(blob.size, offset + chunkSize);
    const chunk = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    const merged = new Uint8Array(carry.length + chunk.length);
    if (carry.length) merged.set(carry);
    merged.set(chunk, carry.length);
    for (let i = 0; i + 2 < merged.length; i += 1) {
      if (merged[i] === 0x1f && merged[i + 1] === 0x8b && merged[i + 2] === 0x08) {
        rawMatches += 1;
      }
    }
    const localOffsets = findGzipMemberOffsets(merged.buffer);
    const base = offset - carry.length;
    for (const local of localOffsets) {
      const absolute = base + local;
      if (absolute >= 0 && (offsets.length === 0 || absolute > offsets[offsets.length - 1])) {
        offsets.push(absolute);
      }
    }
    carry = merged.slice(Math.max(0, merged.length - carryLimit));
    offset = end;
  }
  return offsets;
}

export async function detectGzipMemberOffsets(blob, chunkSize = 8 * 1024 * 1024) {
  const offsets = await findGzipMemberOffsetsFromBlob(blob, chunkSize);
  try {
    console.debug("gzip member offsets", {
      size: blob.size,
      count: offsets.length,
      sample: offsets.slice(0, 8),
    });
  } catch {
    // ignore logging failures
  }
  return offsets;
}

export function streamMultiMemberGzip(blob, offsets) {
  const members = Array.from(offsets || []);
  if (members.length <= 1) {
    return blob.stream().pipeThrough(new DecompressionStream("gzip"));
  }
  return new ReadableStream({
    async start(controller) {
      try {
        for (let i = 0; i < members.length; i += 1) {
          const start = members[i];
          const end = members[i + 1] ?? blob.size;
          const slice = blob.slice(start, end);
          const decompressor = new DecompressionStream("gzip");
          const stream = slice.stream().pipeThrough(decompressor);
          const reader = stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.byteLength) controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });
}

async function decompressStreamToBlob(stream, onProgress) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (onProgress) {
      onProgress({
        phase: "decompressing",
        bytesProcessed: total,
        message: `Decompressed ${(total / (1024 ** 2)).toFixed(1)}MB`,
      });
    }
  }
  const blob = new Blob(chunks);
  console.log(`[GZIP FIX DEBUG] Decompressed blob size: ${blob.size} bytes (${(blob.size / (1024 ** 3)).toFixed(2)} GB)`);
  console.log(`[GZIP FIX DEBUG] Chunks count: ${chunks.length}, Total from chunks: ${total} bytes`);
  console.log(`[GZIP FIX DEBUG] Blob size matches total: ${blob.size === total}`);

  // Verify blob is actually correct
  if (blob.size !== total) {
    console.error(`[GZIP FIX DEBUG] ERROR: Blob size (${blob.size}) does not match decompressed total (${total})!`);
  }

  return blob;
}

function canUseOpfs() {
  return (
    typeof navigator !== "undefined" &&
    navigator.storage &&
    typeof navigator.storage.getDirectory === "function"
  );
}

async function cleanupOpfsTempFiles(prefix = "rds-decompressed-") {
  if (!canUseOpfs()) return;
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) {
      if (name.startsWith(prefix)) {
        try {
          await root.removeEntry(name);
        } catch (err) {
          console.warn("OPFS cleanup failed", err);
        }
      }
    }
  } catch (err) {
    console.warn("OPFS cleanup skipped", err);
  }
}

async function decompressStreamToOpfsFile(stream, options = {}) {
  const { onProgress, filename } = options;
  await cleanupOpfsTempFiles();
  const reader = stream.getReader();
  const root = await navigator.storage.getDirectory();
  const name = filename || `rds-decompressed-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`;
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let total = 0;
  let closed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength) {
        await writable.write(value);
        total += value.byteLength;
        if (onProgress) {
          onProgress({
            phase: "decompressing",
            bytesProcessed: total,
            message: `Decompressed ${(total / (1024 ** 2)).toFixed(1)}MB`,
          });
        }
      }
    }
  } finally {
    if (!closed) {
      try {
        await writable.close();
        closed = true;
      } catch (err) {
        console.warn("OPFS close failed", err);
      }
    }
  }
  return await handle.getFile();
}

async function decompressMultiMemberGzip(blob, offsets, options = {}) {
  const { onProgress } = options;
  const pieces = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const start = offsets[i];
    const end = offsets[i + 1] ?? blob.size;
    const slice = blob.slice(start, end);
    const decompressor = new DecompressionStream("gzip");
    const stream = slice.stream().pipeThrough(decompressor);
    const part = await decompressStreamToBlob(stream, onProgress);
    pieces.push(part);
  }
  return new Blob(pieces);
}

export async function decompressMultiMemberGzipBlob(blob, offsets, options = {}) {
  return await decompressMultiMemberGzip(blob, offsets, options);
}

function estimateDecompressedSize(compressedBytes, ratioEstimate = 3) {
  return compressedBytes * ratioEstimate;
}

function calculateTimeoutMs(compressedBytes) {
  const sizeGb = compressedBytes / (1024 ** 3);
  const timeout = sizeGb * 60000;
  return Math.max(30000, Math.min(600000, timeout));
}

async function decompressWithTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Decompression timeout after ${Math.round(timeoutMs / 1000)}s.`
          )
        );
      }, timeoutMs);
    }),
  ]);
}

export async function decompressBlobIfNeeded(blob, options = {}) {
  const {
    filename,
    onProgress,
    budgetBytes,
    maxRatio = DEFAULT_MAX_RATIO,
    ratioEstimate = 3,
    timeoutMs,
    testDelayMs,
  } = options;

  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "DecompressionStream not available. Use Chrome 89+, Firefox 102+, or Safari 16.4+."
    );
  }

  const compression = await detectCompression(blob);

  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(".gz") && compression !== "gzip") {
      throw new Error(
        `File "${filename}" has .gz extension but is not gzip compressed.`
      );
    }
    if (lower.endsWith(".rds") && compression !== "rds" && compression !== "gzip") {
      throw new Error(
        `File "${filename}" does not appear to be a valid RDS file.`
      );
    }
  }

  if (compression === "rds") {
    return blob;
  }
  if (compression === "bzip2") {
    throw new Error("bzip2 not supported in WASM. Please decompress first.");
  }
  if (compression === "xz") {
    throw new Error("xz not supported in WASM. Please decompress first.");
  }
  if (compression !== "gzip") {
    throw new Error("Unrecognized file format. Expected gzip or RDS.");
  }

  // IMPORTANT: Skip multi-member detection and always use single-stream decompression.
  // The browser's DecompressionStream("gzip") correctly handles both single-member
  // and multi-member (concatenated) gzip files natively. Previous code scanned for
  // gzip magic bytes (0x1f 0x8b) to detect members, but this produced thousands of
  // false positives when those bytes appeared randomly in DEFLATE streams, causing
  // incomplete decompression and parse failures for large files.
  //
  // Removed logic:
  // - findGzipMemberOffsetsFromBlob() - buggy header scanning
  // - decompressMultiMemberGzip() - unnecessary with native browser support

  if (budgetBytes) {
    const estimated = estimateDecompressedSize(blob.size, ratioEstimate);
    if (estimated > budgetBytes) {
      throw new Error(
        `Estimated decompressed size exceeds budget (${Math.round(estimated)} > ${budgetBytes}).`
      );
    }
  }

  const maxBytes = blob.size * maxRatio;
  const effectiveTimeoutMs =
    typeof timeoutMs === "number" ? timeoutMs : calculateTimeoutMs(blob.size);

  const decompressPromise = (async () => {
    if (typeof testDelayMs === "number" && testDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }

    // Simple single-stream decompression - works for all gzip files
    const decompressor = new DecompressionStream("gzip");
    const stream = blob.stream().pipeThrough(decompressor);
    const decompressed = await decompressStreamToBlob(stream, onProgress);
    if (decompressed.size > maxBytes) {
      throw new Error(
        `Compression ratio exceeded safety limit (${maxRatio}:1).`
      );
    }
    if (budgetBytes && decompressed.size > budgetBytes) {
      throw new Error(
        `Decompressed size exceeds budget (${decompressed.size} > ${budgetBytes}).`
      );
    }
    return decompressed;
  })();

  return decompressWithTimeout(decompressPromise, effectiveTimeoutMs);
}

export async function decompressBlobForRandomAccess(blob, options = {}) {
  const {
    filename,
    onProgress,
    budgetBytes,
    maxRatio = DEFAULT_MAX_RATIO,
    ratioEstimate = 3,
    timeoutMs,
    preferOpfs = true,
    allowMemoryFallback = false,
  } = options;

  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "DecompressionStream not available. Use Chrome 89+, Firefox 102+, or Safari 16.4+."
    );
  }

  const compression = await detectCompression(blob);
  if (compression === "rds") {
    return blob;
  }
  if (compression === "bzip2") {
    throw new Error("bzip2 not supported in WASM. Please decompress first.");
  }
  if (compression === "xz") {
    throw new Error("xz not supported in WASM. Please decompress first.");
  }
  if (compression !== "gzip") {
    throw new Error("Unrecognized file format. Expected gzip or RDS.");
  }

  if (budgetBytes) {
    const estimated = estimateDecompressedSize(blob.size, ratioEstimate);
    if (estimated > budgetBytes && !(preferOpfs && canUseOpfs())) {
      throw new Error(
        `Estimated decompressed size exceeds budget (${Math.round(estimated)} > ${budgetBytes}).`
      );
    }
  }

  const maxBytes = blob.size * maxRatio;
  const effectiveTimeoutMs =
    typeof timeoutMs === "number" ? timeoutMs : calculateTimeoutMs(blob.size);

  const decompressPromise = (async () => {
    const decompressor = new DecompressionStream("gzip");
    const stream = blob.stream().pipeThrough(decompressor);
    let decompressed;
    if (preferOpfs && canUseOpfs()) {
      try {
        decompressed = await decompressStreamToOpfsFile(stream, { onProgress, filename });
      } catch (err) {
        const name = err && err.name ? String(err.name) : '';
        const message = err && err.message ? String(err.message) : String(err);
        const haystack = `${name} ${message}`.toLowerCase();
        const isQuota = haystack.includes('quota');
        if (isQuota && !allowMemoryFallback) {
          throw new Error(
            "OPFS quota exceeded while decompressing. Increase browser storage quota or disable streaming."
          );
        }
        if (isQuota && allowMemoryFallback) {
          decompressed = await decompressStreamToBlob(stream, onProgress);
        } else {
          throw err;
        }
      }
    } else {
      decompressed = await decompressStreamToBlob(stream, onProgress);
    }
    if (decompressed.size > maxBytes) {
      throw new Error(
        `Compression ratio exceeded safety limit (${maxRatio}:1).`
      );
    }
    if (budgetBytes && decompressed.size > budgetBytes && !(preferOpfs && canUseOpfs())) {
      throw new Error(
        `Decompressed size exceeds budget (${decompressed.size} > ${budgetBytes}).`
      );
    }
    return decompressed;
  })();

  return decompressWithTimeout(decompressPromise, effectiveTimeoutMs);
}

export async function decompressRds(
  blob,
  {
    onProgress,
    inMemoryThreshold = DEFAULT_IN_MEMORY_THRESHOLD,
    blobThreshold = DEFAULT_BLOB_THRESHOLD,
  } = {},
) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream not available.");
  }
  const decompressed = await decompressBlobIfNeeded(blob, {
    onProgress,
  });
  const decompressedSize = decompressed.size;
  const mode = recommendedMode(decompressedSize, navigator.deviceMemory);
  if (mode === "streaming") {
    return { mode, size: decompressedSize };
  }

  if (mode === "in-memory" && decompressedSize <= inMemoryThreshold) {
    const buffer = new Uint8Array(await decompressed.arrayBuffer());
    return { mode, size: decompressedSize, buffer };
  }

  if (decompressedSize > blobThreshold) {
    return { mode: "streaming", size: decompressedSize };
  }

  return { mode: "blob", size: decompressedSize, blob: decompressed };
}
