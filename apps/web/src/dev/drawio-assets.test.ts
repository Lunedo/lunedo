import { describe, expect, it } from "vitest";
import { DRAWIO_PATH } from "../diagrams/drawio-version.js";
import { drawioContentType, drawioFile, isShippedDrawioFile } from "./drawio-assets.js";

describe("shipped draw.io files", () => {
  it("leave out server parts, cloud connectors, plugins, client secrets and source maps", () => {
    for (const name of [
      "WEB-INF/google_client_secret",
      "META-INF/MANIFEST.MF",
      "connect/jira/editor.html",
      "plugins/props.js",
      "js/dropbox/Dropbox-sdk.min.js",
      "js/onedrive/OneDrive.js",
      "js/simplepeer/simplepeer.min.js",
      "js/integrate.min.js",
      "js/PreConfig.js",
      "service-worker.js",
      "workbox-05b6c01b.js",
      "js/app.min.js.map",
      "teams.html",
      "../outside.js",
      "/absolute.js",
      "js/",
    ]) {
      expect(isShippedDrawioFile(name), name).toBe(false);
    }
    for (const name of [
      "index.html",
      "js/app.min.js",
      "js/gliffy/drawio-gliffy.min.js",
      "stencils/aws4.xml",
      "resources/dia_de.txt",
    ]) {
      expect(isShippedDrawioFile(name), name).toBe(true);
    }
  });

  it("map request paths of the pinned version to shipped files and Pagehall's configuration", () => {
    expect(drawioFile(`${DRAWIO_PATH}index.html?embed=1`)).toBe("index.html");
    expect(drawioFile(`${DRAWIO_PATH}js/PreConfig.js`)).toBe("js/PreConfig.js");
    expect(drawioFile(`${DRAWIO_PATH}WEB-INF/web.xml`)).toBeNull();
    expect(drawioFile(`${DRAWIO_PATH}%2E%2E/secret`)).toBeNull();
    expect(drawioFile("/drawio/1.0.0/index.html")).toBeNull();
    expect(drawioFile("/api/v1/pages")).toBeNull();
    expect(drawioContentType("js/app.min.js")).toBe("text/javascript; charset=utf-8");
    expect(drawioContentType("stencils/x.xml")).toBe("application/xml");
  });
});
