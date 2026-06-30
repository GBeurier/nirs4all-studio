let finetuneTabPromise: Promise<typeof import("../../finetuning/FinetuneTab")> | null = null;

export function loadFinetuneTab() {
  if (!finetuneTabPromise) {
    finetuneTabPromise = import("../../finetuning/FinetuneTab");
  }
  return finetuneTabPromise;
}

export function preloadFinetuneTab() {
  loadFinetuneTab();
}
