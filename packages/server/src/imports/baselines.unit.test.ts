import { describe, expect, it } from "vitest";
import { checksum, normalizedBody } from "./baselines.js";

describe("source checksums", () => {
  it("treats character references and the characters they stand for alike", () => {
    expect(checksum("page", "Title", normalizedBody("<p>Daf&uuml;r&nbsp;gr&#252;n &#x2192;</p>"))).toBe(
      checksum("page", "Title", normalizedBody("<p>Dafür grün →</p>")),
    );
  });

  it("treats line endings and escaped apostrophes alike", () => {
    expect(normalizedBody("a\r\nb\rc &apos;d&#39;")).toBe("a\nb\nc 'd'");
  });

  it("keeps markup escapes, so escaped text never turns into markup", () => {
    expect(normalizedBody('<p title="&quot;">&lt;b&gt; &amp; &quot;x&quot;</p>')).toBe(
      '<p title="&quot;">&lt;b&gt; &amp; &quot;x&quot;</p>',
    );
    expect(checksum(normalizedBody("&lt;b&gt;"))).not.toBe(checksum(normalizedBody("<b>")));
  });

  it("changes when the content changes", () => {
    expect(checksum("page", "Title", normalizedBody("<p>A</p>"))).not.toBe(
      checksum("page", "Title", normalizedBody("<p>B</p>")),
    );
  });
});
