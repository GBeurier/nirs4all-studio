export interface NativeSessionDependencies {
  startControlPlane(): Promise<void> | void;
  createWindow(): Promise<void>;
}

/** Start the desktop shell with only its mandatory Rust control plane. */
export async function startNativeSession(
  dependencies: NativeSessionDependencies,
): Promise<void> {
  await dependencies.startControlPlane();
  await dependencies.createWindow();
}
