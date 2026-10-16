import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import { EXCALIDRAW_ASSET_PATH } from "../dev/excalidraw-assets.js";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
