// Keyboard-wedge scanners send a burst of keys, optionally followed by Enter.
export function createScannerInput() {
  let code = '', lastAt = 0;
  return {
    push(key: string, at: number) {
      if (key.length !== 1) return;
      code = at - lastAt > 80 ? key : code + key;
      lastAt = at;
    },
    take() {
      const result = code.length >= 4 ? code : undefined;
      code = ''; lastAt = 0;
      return result;
    },
    reset() { code = ''; lastAt = 0; },
  };
}
