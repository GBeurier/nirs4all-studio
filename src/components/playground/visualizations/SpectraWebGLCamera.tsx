import { useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
  const { camera, size } = useThree();

  useLayoutEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.position.set(0.5, 0.5, 5);
      camera.near = 0.1;
      camera.far = 100;
      camera.updateProjectionMatrix();
    }
  }, [camera]);

  useFrame(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      applySpectraWebGLCameraBounds(camera, computeSpectraWebGLCameraBounds(size));
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
