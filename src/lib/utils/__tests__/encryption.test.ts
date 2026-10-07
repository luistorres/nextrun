import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "../encryption";

describe("encryption utilities", () => {
  beforeAll(() => {
    // Set a test encryption key (32 bytes = 64 hex chars)
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("encrypts and decrypts a string", () => {
    const original = "my-secret-token-value";
    const encrypted = encrypt(original);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const original = "same-input";
    const enc1 = encrypt(original);
    const enc2 = encrypt(original);
    expect(enc1).not.toBe(enc2);
  });

  it("encrypted string has iv:authTag:ciphertext format", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
  });

  it("throws on invalid encrypted string", () => {
    expect(() => decrypt("invalid")).toThrow();
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toBe("");
  });

  it("handles long strings", () => {
    const long = "a".repeat(10000);
    const encrypted = encrypt(long);
    expect(decrypt(encrypted)).toBe(long);
  });
});
