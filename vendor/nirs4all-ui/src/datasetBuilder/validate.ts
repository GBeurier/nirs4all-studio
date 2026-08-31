/**
 * Real-time consistency checks over the current sources.
 *
 * Produces an ordered list of OK / warning / error checks and an overall
 * status. Pure: recompute it on every meaningful change. Text is localized (FR
 * default) but stays terse — the card renders `label` + optional `details`.
 */

import { deriveSchema } from "./schema.js";
import type { Locale } from "./roles.js";
import type {
  DatasetSource,
  ValidationCheck,
  ValidationLevel,
  ValidationResult,
} from "./types.js";

interface Copy {
  fileValid: string;
  rolesAssigned: (n: number) => string;
  idsOk: string;
  noId: string;
  noX: string;
  noY: string;
  noYDetails: string;
  replicatesDetected: (col: string) => string;
  partitionDetected: (col: string) => string;
  noPartition: string;
  unassignedNumeric: (n: number) => string;
  ready: string;
  noSource: string;
}

const COPY: Record<Locale, Copy> = {
  fr: {
    fileValid: "Fichier valide",
    rolesAssigned: (n) => `Colonnes assignées : ${n} rôles définis`,
    idsOk: "IDs cohérents",
    noId: "Aucun identifiant détecté",
    noX: "Aucune colonne X définie",
    noY: "Aucune cible Y disponible",
    noYDetails: "Assignez au moins une colonne au rôle Y pour l'entraînement.",
    replicatesDetected: (col) => `Répétitions détectées : colonne « ${col} »`,
    partitionDetected: (col) => `Partition détectée : colonne « ${col} »`,
    noPartition: "Aucune partition détectée — tout sera utilisé comme train",
    unassignedNumeric: (n) => `${n} colonnes numériques non assignées`,
    ready: "Prêt pour la suite",
    noSource: "Ajoutez une source de données pour commencer",
  },
  en: {
    fileValid: "Valid file",
    rolesAssigned: (n) => `Assigned columns: ${n} roles defined`,
    idsOk: "Consistent IDs",
    noId: "No identifier detected",
    noX: "No X column defined",
    noY: "No Y target available",
    noYDetails: "Assign at least one column to the Y role for training.",
    replicatesDetected: (col) => `Replicates detected: column “${col}”`,
    partitionDetected: (col) => `Partition detected: column “${col}”`,
    noPartition: "No partition detected — everything will be used as train",
    unassignedNumeric: (n) => `${n} unassigned numeric columns`,
    ready: "Ready for the next step",
    noSource: "Add a data source to get started",
  },
};

const NUMERIC = new Set(["integer", "float"]);

function worst(a: ValidationLevel, b: ValidationLevel): ValidationLevel {
  const order: ValidationLevel[] = ["ok", "warning", "error"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

export function validateBuilder(
  sources: DatasetSource[],
  locale: Locale = "fr",
): ValidationResult {
  const t = COPY[locale];
  const checks: ValidationCheck[] = [];

  if (sources.length === 0) {
    return {
      status: "error",
      checks: [{ id: "no-source", level: "error", label: t.noSource }],
    };
  }

  const schema = deriveSchema(sources);

  checks.push({ id: "file-valid", level: "ok", label: t.fileValid });

  const assignedRoles = new Set<string>();
  if (schema.xSources.length) assignedRoles.add("x");
  if (schema.yColumns.length) assignedRoles.add("y");
  if (schema.idColumns.length) assignedRoles.add("id");
  if (schema.metadataColumns.length) assignedRoles.add("metadata");
  if (schema.partitionColumns.length) assignedRoles.add("partition");
  if (schema.replicateColumns.length) assignedRoles.add("replicate");
  checks.push({
    id: "roles-assigned",
    level: assignedRoles.size > 0 ? "ok" : "warning",
    label: t.rolesAssigned(assignedRoles.size),
  });

  // X presence.
  checks.push(
    schema.xSources.length > 0
      ? { id: "has-x", level: "ok", label: `X : ${schema.xSources.length} source(s)` }
      : { id: "has-x", level: "error", label: t.noX },
  );

  // Y presence (only errors on train-bearing datasets — test-only X is allowed).
  const hasTrainOnlyX = sources.some(
    (s) => s.usage.useAs === "x_test" || s.usage.useAs === "y_test",
  );
  checks.push(
    schema.yColumns.length > 0
      ? { id: "has-y", level: "ok", label: `Y : ${schema.yColumns.length} cible(s)` }
      : {
          id: "has-y",
          level: hasTrainOnlyX ? "warning" : "error",
          label: t.noY,
          details: t.noYDetails,
        },
  );

  // IDs.
  checks.push(
    schema.idColumns.length > 0
      ? { id: "has-id", level: "ok", label: t.idsOk }
      : { id: "has-id", level: "warning", label: t.noId },
  );

  // Replicates.
  if (schema.replicateColumns.length) {
    checks.push({
      id: "replicates",
      level: "ok",
      label: t.replicatesDetected(schema.replicateColumns[0]?.columnName ?? ""),
    });
  }

  // Partition.
  if (schema.partitionColumns.length) {
    checks.push({
      id: "partition",
      level: "ok",
      label: t.partitionDetected(schema.partitionColumns[0]?.columnName ?? ""),
    });
  } else {
    checks.push({ id: "partition", level: "warning", label: t.noPartition });
  }

  // Unassigned numeric columns.
  const unassignedNumeric = sources.reduce(
    (acc, s) =>
      acc +
      s.columns.filter((c) => c.assignedRole === "ignored" && NUMERIC.has(c.detectedType)).length,
    0,
  );
  if (unassignedNumeric > 0) {
    checks.push({
      id: "unassigned-numeric",
      level: "warning",
      label: t.unassignedNumeric(unassignedNumeric),
    });
  }

  const status = checks.reduce<ValidationLevel>((acc, c) => worst(acc, c.level), "ok");
  if (status === "ok") {
    checks.push({ id: "ready", level: "ok", label: t.ready });
  }

  return { status, checks };
}
