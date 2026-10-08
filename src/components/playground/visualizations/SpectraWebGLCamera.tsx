import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import {
  computeSpectraWebGLCameraBounds,
  type SpectraWebGLCameraBounds,
} from './spectraWebGLCameraBounds';

function applySpectraWebGLCameraBounds(
  camera: THREE.OrthographicCamera,
  bounds: SpectraWebGLCameraBounds
) {
  camera.left = bounds.left;
  camera.right = bounds.right;
  camera.bottom = bounds.bottom;
  camera.top = bounds.top;
}

export function SpectraWebGLCamera() {
  const { camera, size, invalidate } = useThree();

  useLayoutEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.position.set(0.5, 0.5, 5);
      camera.near = 0.1;
      camera.far = 100;
      applySpectraWebGLCameraBounds(camera, computeSpectraWebGLCameraBounds({ width: size.width, height: size.height }));
      camera.updateProjectionMatrix();
      invalidate();
    }
  }, [camera, size.width, size.height, invalidate]);

  return null;
}
