import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareReceipt } from "./imageResize";

/**
 * `prepareReceipt` only touches the DOM on the resize path, so the decisions
 * around it are testable with two stubs: a FileReader that hands back a data
 * URL, and an Image that decodes only what the stub says is decodable. That
 * is exactly the shape of the HEIC case — the browser reads the bytes fine
 * and then refuses to decode them.
 */

type Decodable = (src: string) => boolean;

function installDomStubs(decodable: Decodable): () => void {
  const g = globalThis as Record<string, unknown>;
  const saved = { FileReader: g.FileReader, Image: g.Image };

  g.FileReader = class {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error: unknown = null;
    readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,AAAA`;
      queueMicrotask(() => this.onload?.());
    }
  };

  g.Image = class {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = "";
    set src(value: string) {
      this.#src = value;
      queueMicrotask(() => {
        if (decodable(value)) {
          this.naturalWidth = 800;
          this.naturalHeight = 600;
          this.onload?.();
        } else {
          this.onerror?.();
        }
      });
    }
    get src() {
      return this.#src;
    }
  };

  return () => {
    g.FileReader = saved.FileReader;
    g.Image = saved.Image;
  };
}

test("an image the browser cannot decode passes through untouched", async () => {
  const restore = installDomStubs((src) => !src.includes("heic"));
  try {
    const file = new File([new Uint8Array([1, 2, 3])], "IMG_4213.HEIC", {
      type: "image/heic",
    });
    const out = await prepareReceipt(file);
    assert.equal(out.blob, file, "the original bytes go up as they are");
    assert.equal(out.blob.type, "image/heic");
    assert.equal(out.filename, "IMG_4213.HEIC");
  } finally {
    restore();
  }
});

test("a small JPEG the browser can decode is not re-encoded", async () => {
  const restore = installDomStubs(() => true);
  try {
    const file = new File([new Uint8Array([1, 2, 3])], "receipt.jpg", {
      type: "image/jpeg",
    });
    const out = await prepareReceipt(file);
    assert.equal(out.blob, file);
    assert.equal(out.filename, "receipt.jpg");
  } finally {
    restore();
  }
});

test("a PDF never reaches the decoder", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "receipt.pdf", {
    type: "application/pdf",
  });
  const out = await prepareReceipt(file);
  assert.equal(out.blob, file);
  assert.equal(out.filename, "receipt.pdf");
});
