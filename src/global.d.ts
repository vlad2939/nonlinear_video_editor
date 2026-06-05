import type { NativeApi } from "./shared/types";

declare global {
  interface Window {
    nativeApi?: NativeApi;
  }
}

export {};
