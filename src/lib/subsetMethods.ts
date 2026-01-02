import { SubsetMode } from '@/types/spectral';

// Get random subset indices
function getRandomSubset(n: number, count: number): number[] {
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, Math.min(count, n)).sort((a, b) => a - b);
}

// Get quantile indices based on Y values
function getQuantileIndices(y: number[], quantiles = [0.05, 0.25, 0.5, 0.75, 0.95]): number[] {
  const indexed = y.map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
  return quantiles.map(q => {
    const idx = Math.floor(q * (indexed.length - 1));
    return indexed[idx].i;
  });
}

// Simple k-means clustering to get centroid indices
function getKMeansCentroids(spectra: number[][], k: number = 5, maxIter: number = 20): number[] {
  const n = spectra.length;
  if (n <= k) return Array.from({ length: n }, (_, i) => i);

  // Initialize centroids randomly
  const centroidIndices = getRandomSubset(n, k);
  let centroids = centroidIndices.map(i => [...spectra[i]]);

  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = spectra.map(spectrum => {
      let minDist = Infinity;
      let minIdx = 0;
      centroids.forEach((centroid, ci) => {
        const dist = spectrum.reduce((sum, v, j) => sum + Math.pow(v - centroid[j], 2), 0);
        if (dist < minDist) {
          minDist = dist;
          minIdx = ci;
        }
      });
      return minIdx;
    });

    // Check convergence
    if (newAssignments.every((a, i) => a === assignments[i])) break;
    assignments = newAssignments;

    // Update centroids
    centroids = centroids.map((_, ci) => {
      const clusterPoints = spectra.filter((_, i) => assignments[i] === ci);
      if (clusterPoints.length === 0) return centroids[ci];
      const m = clusterPoints[0].length;
      return Array.from({ length: m }, (_, j) =>
        clusterPoints.reduce((sum, p) => sum + p[j], 0) / clusterPoints.length
      );
    });
  }

  // Find closest actual sample to each centroid
  return centroids.map(centroid => {
    let minDist = Infinity;
    let minIdx = 0;
    spectra.forEach((spectrum, i) => {
      const dist = spectrum.reduce((sum, v, j) => sum + Math.pow(v - centroid[j], 2), 0);
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    });
    return minIdx;
  }).filter((v, i, a) => a.indexOf(v) === i); // Remove duplicates
}

// Main function to get subset indices
export function getSubsetIndices(
  spectra: number[][],
  y: number[],
  mode: SubsetMode,
  count: number = 20
): number[] {
  switch (mode) {
    case 'all':
      return Array.from({ length: spectra.length }, (_, i) => i);
    case 'random':
      return getRandomSubset(spectra.length, count);
    case 'quantiles':
      return getQuantileIndices(y);
    case 'kmeans':
      return getKMeansCentroids(spectra, Math.min(count, 10));
    default:
      return Array.from({ length: Math.min(spectra.length, count) }, (_, i) => i);
  }
}
