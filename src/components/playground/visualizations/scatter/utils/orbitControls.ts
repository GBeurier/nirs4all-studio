/**
 * Orbit controls for 3D scatter plot
 * Handles mouse/touch input for rotation, zoom, and pan
 */

import type { OrbitState } from '../types';
import { mat4LookAt } from './projectionMatrix';

export interface OrbitControlsOptions {
  /** Initial azimuthal angle (radians) */
  initialTheta?: number;
  /** Initial polar angle (radians) */
  initialPhi?: number;
  /** Initial distance from target */
  initialDistance?: number;
  /** Initial target position */
  initialTarget?: [number, number, number];
  /** Minimum distance (zoom limit) */
  minDistance?: number;
  /** Maximum distance (zoom limit) */
  maxDistance?: number;
  /** Minimum polar angle (prevent flipping) */
  minPhi?: number;
  /** Maximum polar angle (prevent flipping) */
  maxPhi?: number;
  /** Rotation sensitivity */
  rotateSpeed?: number;
  /** Zoom sensitivity */
  zoomSpeed?: number;
  /** Pan sensitivity */
  panSpeed?: number;
  /** Enable damping (smooth deceleration) */
  enableDamping?: boolean;
  /** Damping factor (0-1, higher = more damping) */
  dampingFactor?: number;
  /** Callback on state change */
  onChange?: (state: OrbitState) => void;
}

const DEFAULT_OPTIONS: Required<OrbitControlsOptions> = {
  initialTheta: Math.PI / 4,
  initialPhi: Math.PI / 3,
  initialDistance: 4,
  initialTarget: [0, 0, 0],
  minDistance: 0.5,
  maxDistance: 20,
  minPhi: 0.1,
  maxPhi: Math.PI - 0.1,
  rotateSpeed: 0.005,
  zoomSpeed: 0.001,
  panSpeed: 0.002,
  enableDamping: true,
  dampingFactor: 0.1,
  onChange: () => {},
};

export class OrbitControls {
  private canvas: HTMLCanvasElement;
  private state: OrbitState;
  private options: Required<OrbitControlsOptions>;

  // Interaction state
  private isDragging = false;
  private isPanning = false;
  private lastX = 0;
  private lastY = 0;

  // Velocity for damping
  private velocityTheta = 0;
  private velocityPhi = 0;

  // Bound handlers for cleanup
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundContextMenu: (e: Event) => void;
  private boundTouchStart: (e: TouchEvent) => void;
  private boundTouchMove: (e: TouchEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;

  constructor(canvas: HTMLCanvasElement, options: OrbitControlsOptions = {}) {
    this.canvas = canvas;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.state = {
      theta: this.options.initialTheta,
      phi: this.options.initialPhi,
      distance: this.options.initialDistance,
      target: [...this.options.initialTarget],
    };

    // Bind handlers
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundWheel = this.handleWheel.bind(this);
    this.boundContextMenu = (e) => e.preventDefault();
    this.boundTouchStart = this.handleTouchStart.bind(this);
    this.boundTouchMove = this.handleTouchMove.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);

    // Attach listeners
    canvas.addEventListener('mousedown', this.boundMouseDown);
    canvas.addEventListener('wheel', this.boundWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.boundContextMenu);
    canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.boundTouchEnd);

    // Global listeners for drag continuation
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mouseup', this.boundMouseUp);
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button === 2) {
      // Right button: rotate (orbit around scene)
      this.isDragging = true;
      this.isPanning = false;
    } else if (e.button === 1) {
      // Middle button: pan
      this.isDragging = true;
      this.isPanning = true;
    }
    // Left button (0) is reserved for selection - don't consume it
    if (this.isDragging) {
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.velocityTheta = 0;
      this.velocityPhi = 0;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    if (this.isPanning) {
      this.pan(dx, dy);
    } else {
      this.rotate(dx, dy);
    }
  }

  private handleMouseUp(): void {
    this.isDragging = false;
    this.isPanning = false;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaY * this.options.zoomSpeed;
    this.zoom(delta);
  }

  private handleTouchStart(e: TouchEvent): void {
    if (e.touches.length === 1) {
      e.preventDefault();
      this.isDragging = true;
      this.isPanning = false;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      e.preventDefault();
      this.isDragging = true;
      this.isPanning = true;
      // Use center point for pan
      this.lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      this.lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.isDragging) return;
    e.preventDefault();

    if (e.touches.length === 1 && !this.isPanning) {
      const dx = e.touches[0].clientX - this.lastX;
      const dy = e.touches[0].clientY - this.lastY;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.rotate(dx, dy);
    } else if (e.touches.length === 2) {
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dx = centerX - this.lastX;
      const dy = centerY - this.lastY;
      this.lastX = centerX;
      this.lastY = centerY;
      this.pan(dx, dy);
    }
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (e.touches.length === 0) {
      this.isDragging = false;
      this.isPanning = false;
    }
  }

  private rotate(dx: number, dy: number): void {
    this.state.theta -= dx * this.options.rotateSpeed;
    this.state.phi = Math.max(
      this.options.minPhi,
      Math.min(this.options.maxPhi, this.state.phi - dy * this.options.rotateSpeed)
    );
    this.velocityTheta = -dx * this.options.rotateSpeed;
    this.velocityPhi = -dy * this.options.rotateSpeed;
    this.options.onChange(this.state);
  }

  private pan(dx: number, dy: number): void {
    // Pan in screen space
    const panX = -dx * this.options.panSpeed * this.state.distance;
    const panY = dy * this.options.panSpeed * this.state.distance;

    // Convert to world space based on current orientation
    const sinTheta = Math.sin(this.state.theta);
    const cosTheta = Math.cos(this.state.theta);

    this.state.target[0] += panX * cosTheta;
    this.state.target[1] += panY;
    this.state.target[2] += panX * sinTheta;

    this.options.onChange(this.state);
  }

  private zoom(delta: number): void {
    this.state.distance = Math.max(
      this.options.minDistance,
      Math.min(this.options.maxDistance, this.state.distance * (1 + delta))
    );
    this.options.onChange(this.state);
  }

  /**
   * Apply damping and return updated view matrix
   * Call this each frame
   */
  update(): Float32Array {
    if (this.options.enableDamping && !this.isDragging) {
      if (Math.abs(this.velocityTheta) > 0.0001 || Math.abs(this.velocityPhi) > 0.0001) {
        this.state.theta += this.velocityTheta;
        this.state.phi = Math.max(
          this.options.minPhi,
          Math.min(this.options.maxPhi, this.state.phi + this.velocityPhi)
        );
        this.velocityTheta *= (1 - this.options.dampingFactor);
        this.velocityPhi *= (1 - this.options.dampingFactor);
        this.options.onChange(this.state);
      }
    }

    return this.getViewMatrix();
  }

  /**
   * Get the current view matrix
   */
  getViewMatrix(): Float32Array {
    const { theta, phi, distance, target } = this.state;

    // Convert spherical to Cartesian
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const eye: [number, number, number] = [
      target[0] + distance * sinPhi * cosTheta,
      target[1] + distance * cosPhi,
      target[2] + distance * sinPhi * sinTheta,
    ];

    return mat4LookAt(eye, target, [0, 1, 0]);
  }

  /**
   * Get current camera position
   */
  getEyePosition(): [number, number, number] {
    const { theta, phi, distance, target } = this.state;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    return [
      target[0] + distance * sinPhi * cosTheta,
      target[1] + distance * cosPhi,
      target[2] + distance * sinPhi * sinTheta,
    ];
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = {
      theta: this.options.initialTheta,
      phi: this.options.initialPhi,
      distance: this.options.initialDistance,
      target: [...this.options.initialTarget],
    };
    this.velocityTheta = 0;
    this.velocityPhi = 0;
    this.options.onChange(this.state);
  }

  /**
   * Get current state
   */
  getState(): OrbitState {
    return { ...this.state };
  }

  /**
   * Set state directly
   */
  setState(state: Partial<OrbitState>): void {
    if (state.theta !== undefined) this.state.theta = state.theta;
    if (state.phi !== undefined) {
      this.state.phi = Math.max(
        this.options.minPhi,
        Math.min(this.options.maxPhi, state.phi)
      );
    }
    if (state.distance !== undefined) {
      this.state.distance = Math.max(
        this.options.minDistance,
        Math.min(this.options.maxDistance, state.distance)
      );
    }
    if (state.target !== undefined) {
      this.state.target = [...state.target];
    }
    this.options.onChange(this.state);
  }

  /**
   * Cleanup event listeners
   */
  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.boundMouseDown);
    this.canvas.removeEventListener('wheel', this.boundWheel);
    this.canvas.removeEventListener('contextmenu', this.boundContextMenu);
    this.canvas.removeEventListener('touchstart', this.boundTouchStart);
    this.canvas.removeEventListener('touchmove', this.boundTouchMove);
    this.canvas.removeEventListener('touchend', this.boundTouchEnd);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mouseup', this.boundMouseUp);
  }
}
