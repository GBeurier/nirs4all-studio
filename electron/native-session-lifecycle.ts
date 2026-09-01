export interface NativeSessionDependencies {
  startControlPlane(): void;
  createWindow(): Promise<void>;
}

/** Start the desktop shell with only its mandatory Rust control plane. */
export async function startNativeSession(
  dependencies: NativeSessionDependencies,
): Promise<void> {
  dependencies.startControlPlane();
  await dependencies.createWindow();
}
