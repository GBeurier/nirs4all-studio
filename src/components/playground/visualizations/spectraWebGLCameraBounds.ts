export interface SpectraWebGLCameraSize {
  width: number;
  height: number;
}

export interface SpectraWebGLCameraMargins {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface SpectraWebGLCameraBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export const SPECTRA_WEBGL_CAMERA_MARGINS = {
  left: 0.06,
  right: 0.02,
  bottom: 0.12,
  top: 0.04,
} satisfies SpectraWebGLCameraMargins;

export function computeSpectraWebGLCameraBounds(
  size: SpectraWebGLCameraSize,
  margins: SpectraWebGLCameraMargins = SPECTRA_WEBGL_CAMERA_MARGINS
): SpectraWebGLCameraBounds {
  const dataWidth = 1 + margins.left + margins.right;
  const dataHeight = 1 + margins.bottom + margins.top;
  const aspect = size.width / size.height;
  const requiredYRange = dataWidth / aspect;

  const baseBounds = {
    left: -margins.left,
    right: 1 + margins.right,
    bottom: -margins.bottom,
    top: 1 + margins.top,
  };

  if (requiredYRange >= dataHeight) {
    const extraY = (requiredYRange - dataHeight) / 2;
    return {
      ...baseBounds,
      bottom: -margins.bottom - extraY,
      top: 1 + margins.top + extraY,
    };
  }

  return baseBounds;
}
