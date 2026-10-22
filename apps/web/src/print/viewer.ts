import { CoreViewer, ReadyState } from "@vivliostyle/core";
import "../fonts.js";
import "./viewer.css";

export interface PrintResult {
  pages: number;
}

export interface PrintOptions {
  baseUrl?: string;
}

export interface PrintViewer {
  render(html: string, options?: PrintOptions): Promise<PrintResult>;
}

declare global {
  interface Window {
    lunedoPrint?: PrintViewer;
  }
}

function viewport(): HTMLElement {
  const element = document.getElementById("viewport");
  if (!element) throw new Error("The print viewport is missing");
  return element;
}

function showAllSheets(): void {
  const box = document.querySelector<HTMLElement>("[data-vivliostyle-outer-zoom-box]");
  const sheets = document.querySelector<HTMLElement>("[data-vivliostyle-spread-container]");
  if (box && sheets) box.style.height = `${sheets.getBoundingClientRect().height}px`;
}

function render(html: string, options: PrintOptions): Promise<PrintResult> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.title = parsed.title || document.title;
  document.documentElement.lang = parsed.documentElement.lang || document.documentElement.lang;
  const viewer = new CoreViewer(
    { viewportElement: viewport() },
    { allowScripts: false, renderAllPages: true, autoResize: false },
  );
  return new Promise((resolve, reject) => {
    viewer.addListener("readystatechange", () => {
      if (viewer.readyState !== ReadyState.COMPLETE) return;
      showAllSheets();
      resolve({ pages: document.querySelectorAll("[data-vivliostyle-page-container]").length });
    });
    viewer.addListener("error", (payload) => {
      reject(new Error(payload.content?.messages?.join(" ") || "The document could not be laid out"));
    });
    viewer.loadDocument(
      { url: new URL("/document.html", options.baseUrl ?? window.location.href).href },
      { documentObject: parsed },
    );
  });
}

window.lunedoPrint = {
  render: async (html, options = {}) => {
    await document.fonts.ready;
    return render(html, options);
  },
};
