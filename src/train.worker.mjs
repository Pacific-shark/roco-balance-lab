import { train } from "./rl.mjs";
self.onmessage = ({ data }) => {
  try {
    const model = train({
      ...data,
      onProgress: (row) => self.postMessage({ kind: "progress", row }),
    });
    self.postMessage({ kind: "done", model });
  } catch (error) {
    self.postMessage({ kind: "error", message: error.message });
  }
};
