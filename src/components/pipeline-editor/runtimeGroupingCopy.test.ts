/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { RUNTIME_GROUPING_COPY } from "@/lib/runtimeSplitGrouping";
import { localizeRuntimeGroupingCopy } from "./runtimeGroupingCopy";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("localizeRuntimeGroupingCopy", () => {
  it("translates the shared grouping copy and keeps unknown text as is", async () => {
    await i18n.changeLanguage("fr");
    expect(localizeRuntimeGroupingCopy(i18n.t, RUNTIME_GROUPING_COPY.conflictTitle)).toBe(
      "Un pipeline sélectionné définit déjà des groupes d’échantillons.",
    );
    expect(localizeRuntimeGroupingCopy(i18n.t, "something else")).toBe("something else");
    expect(localizeRuntimeGroupingCopy(i18n.t, null)).toBeNull();
  });

  it("returns the English copy in English", async () => {
    await i18n.changeLanguage("en");
    expect(localizeRuntimeGroupingCopy(i18n.t, RUNTIME_GROUPING_COPY.conflictTitle)).toBe(
      RUNTIME_GROUPING_COPY.conflictTitle,
    );
  });
});
