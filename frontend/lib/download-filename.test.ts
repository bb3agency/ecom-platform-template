import { describe, expect, it } from "vitest";
import { resolveDownloadFilename } from "./download-filename";

/**
 * The saved invoice file must be named after the invoice number INSIDE the PDF.
 * Callers only know what their (possibly stale) React state holds — the server
 * knows what it just rendered — so the header wins whenever it is readable.
 */
function responseWith(header: string | null): Response {
  const headers = new Headers();
  if (header !== null) headers.set("content-disposition", header);
  return new Response(null, { headers });
}

describe("resolveDownloadFilename", () => {
  it("prefers the server filename over the caller's guess", () => {
    // The reported bug: state said ORD-…, the PDF said INV-2026-00042.
    expect(
      resolveDownloadFilename(
        responseWith('attachment; filename="INV-2026-00042.pdf"'),
        "ORD-B8GK-ASUP-invoice.pdf",
      ),
    ).toBe("INV-2026-00042.pdf");
  });

  it("handles unquoted and oddly-spaced header forms", () => {
    expect(resolveDownloadFilename(responseWith("attachment; filename=INV-2026-1.pdf"), "f.pdf")).toBe(
      "INV-2026-1.pdf",
    );
    expect(
      resolveDownloadFilename(responseWith('attachment;filename =  "INV-2026-2.pdf"'), "f.pdf"),
    ).toBe("INV-2026-2.pdf");
  });

  it("prefers the RFC 5987 extended form and decodes it", () => {
    expect(
      resolveDownloadFilename(
        responseWith("attachment; filename=\"fallback.pdf\"; filename*=UTF-8''INV%2D2026%2D00007.pdf"),
        "f.pdf",
      ),
    ).toBe("INV-2026-00007.pdf");
  });

  it("falls back when the header is absent, empty, or has no filename", () => {
    expect(resolveDownloadFilename(responseWith(null), "fallback.pdf")).toBe("fallback.pdf");
    expect(resolveDownloadFilename(responseWith("attachment"), "fallback.pdf")).toBe("fallback.pdf");
    expect(resolveDownloadFilename(responseWith('attachment; filename=""'), "fallback.pdf")).toBe(
      "fallback.pdf",
    );
  });

  it("never lets a server-supplied name traverse paths or carry unsafe characters", () => {
    expect(
      resolveDownloadFilename(responseWith('attachment; filename="../../etc/passwd"'), "f.pdf"),
    ).toBe("passwd");
    expect(
      resolveDownloadFilename(responseWith('attachment; filename="C:\\\\Windows\\\\evil.pdf"'), "f.pdf"),
    ).toBe("evil.pdf");
    expect(
      resolveDownloadFilename(responseWith('attachment; filename="in:v*a|l?id.pdf"'), "f.pdf"),
    ).toBe("invalid.pdf");
  });

  it("keeps the characters an invoice number is made of", () => {
    expect(
      resolveDownloadFilename(responseWith('attachment; filename="INV-2026-00042.pdf"'), "f.pdf"),
    ).toBe("INV-2026-00042.pdf");
  });
});
