import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value() {
    this.open = true;
  },
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  value() {
    this.open = false;
  },
});
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

Object.defineProperty(globalThis, "CSS", {
  configurable: true,
  value: {
    escape: (value: string) =>
      Array.from(value)
        .map((char) => "\\" + char.codePointAt(0)!.toString(16) + " ")
        .join(""),
  },
});
