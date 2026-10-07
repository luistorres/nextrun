import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { extractFitFromZip } from "./connect-fit-download";

const FIT_BYTES = new Uint8Array([0x0e, 0x10, 0x43, 0x08, 0x2e, 0x46, 0x49, 0x54]);

describe("extractFitFromZip", () => {
  it("extracts the .fit entry from a zip archive", () => {
    const zip = zipSync({ "123456789.fit": FIT_BYTES });
    const fit = extractFitFromZip(zip);
    expect(fit).not.toBeNull();
    expect(Buffer.from(FIT_BYTES).equals(fit!)).toBe(true);
  });

  it("matches the FIT entry case-insensitively among other entries", () => {
    const zip = zipSync({
      "readme.txt": new Uint8Array([1]),
      "ACTIVITY.FIT": FIT_BYTES,
    });
    const fit = extractFitFromZip(zip);
    expect(fit).not.toBeNull();
    expect(fit!.length).toBe(FIT_BYTES.length);
  });

  it("returns null when the archive has no .fit entry", () => {
    const zip = zipSync({ "activity.gpx": new Uint8Array([1, 2, 3]) });
    expect(extractFitFromZip(zip)).toBeNull();
  });

  it("returns null for an empty .fit entry", () => {
    const zip = zipSync({ "empty.fit": new Uint8Array([]) });
    expect(extractFitFromZip(zip)).toBeNull();
  });

  it("returns null for bytes that are not a zip archive", () => {
    expect(extractFitFromZip(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(extractFitFromZip(new Uint8Array([]))).toBeNull();
    // A raw FIT file served without zipping is also not a valid archive
    expect(extractFitFromZip(FIT_BYTES)).toBeNull();
  });
});
