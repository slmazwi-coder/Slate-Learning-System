import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount anything a test rendered so the next one starts from an empty DOM.
afterEach(() => {
  cleanup();
});
