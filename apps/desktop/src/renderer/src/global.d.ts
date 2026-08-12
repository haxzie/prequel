/// <reference types="vite/client" />

import type { DesktopApi } from "../../preload/index";

declare global {
  interface Window {
    prequel: DesktopApi;
  }
}

export {};
