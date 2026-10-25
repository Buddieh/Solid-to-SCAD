// Runs learnChange off the main thread so the page stays responsive while it fits.
import { learnChange } from './src/core/learn.js';

self.onmessage = ({ data: { id, base, variant } }) => {
  try {
    const result = learnChange(base, variant, { onProgress: progress => self.postMessage({ id, progress }) });
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
