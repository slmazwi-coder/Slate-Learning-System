/*
 * © 2026 Age thirty4 technologies. All Rights Reserved.
 * Proprietary and Confidential.
 * Unauthorized copying of this file, via any means, is strictly prohibited.
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount anything a test rendered so the next one starts from an empty DOM.
afterEach(() => {
  cleanup();
});
