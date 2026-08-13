import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// RTL's own auto-cleanup registers against a GLOBAL `afterEach`, which only
// exists when vitest's `test.globals` is `true` (it is not, here — every test
// file imports its own `describe`/`it`/`expect` explicitly). Without this,
// a component rendered in one test leaks into the next test's DOM.
afterEach(cleanup);
