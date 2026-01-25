/**
 * Motion wrapper unit tests
 *
 * Tests for the reduce-motion functionality that disables framer-motion animations
 * when the user has enabled "Reduce animations" in settings.
 *
 * Note: Full DOM-based tests would require jsdom to be installed.
 * These tests verify the module structure and exports.
 */

import { describe, it, expect } from 'vitest';
import { shouldReduceMotion, isFirefox, motion, AnimatePresence, LayoutGroup } from '../motion';

describe('motion module exports', () => {
  it('exports shouldReduceMotion function', () => {
    expect(typeof shouldReduceMotion).toBe('function');
  });

  it('exports isFirefox boolean', () => {
    expect(typeof isFirefox).toBe('boolean');
  });

  it('exports motion object with div element', () => {
    expect(motion).toBeDefined();
    expect(motion.div).toBeDefined();
  });

  it('exports motion object with common HTML elements', () => {
    const expectedElements = [
      'div', 'span', 'section', 'article', 'main', 'header', 'footer',
      'nav', 'aside', 'ul', 'li', 'a', 'button', 'p',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ];

    for (const element of expectedElements) {
      expect(motion[element as keyof typeof motion]).toBeDefined();
    }
  });

  it('exports AnimatePresence component', () => {
    expect(AnimatePresence).toBeDefined();
  });

  it('exports LayoutGroup component', () => {
    expect(LayoutGroup).toBeDefined();
  });
});

describe('shouldReduceMotion conditions', () => {
  it('should check for reduce-motion class on documentElement', () => {
    // The function checks document.documentElement.classList.contains("reduce-motion")
    // This verifies the logic exists by inspecting the function
    const fnStr = shouldReduceMotion.toString();
    expect(fnStr).toContain('reduce-motion');
  });

  it('should check for prefers-reduced-motion media query', () => {
    // The function checks window.matchMedia("(prefers-reduced-motion: reduce)")
    const fnStr = shouldReduceMotion.toString();
    expect(fnStr).toContain('prefers-reduced-motion');
  });

  it('should check isFirefox condition', () => {
    // The function should include isFirefox in its conditions
    const fnStr = shouldReduceMotion.toString();
    expect(fnStr).toContain('isFirefox');
  });
});
