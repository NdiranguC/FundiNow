import { describe, expect, it } from "vitest";
import {
  countMatchingNameTokens,
  extractNameCandidate,
  normalizeNameTokens,
} from "./identity-verification";

describe("identity verification name matching", () => {
  it("normalizes case, punctuation, and accents into distinct tokens", () => {
    expect([...normalizeNameTokens("José-Kamau, KIPROP")]).toEqual(["jose", "kamau", "kiprop"]);
  });

  it("matches distinct name tokens regardless of order", () => {
    expect(countMatchingNameTokens("John Kamau Kiprop", "Kiprop John Otieno")).toBe(2);
  });

  it("does not count repeated tokens more than once", () => {
    expect(countMatchingNameTokens("John John Kamau", "John John John")).toBe(1);
  });

  it("does not match partial tokens", () => {
    expect(countMatchingNameTokens("John Kamau", "Johnson Kamauwa")).toBe(0);
  });

  it("extracts a likely name line without matching ID headings or numbers", () => {
    expect(
      extractNameCandidate(
        "REPUBLIC OF KENYA\nNATIONAL ID CARD\nJOHN KAMAU KIPROP\nID No: 123456",
        "John Kamau Kiprop",
      ),
    ).toBe("JOHN KAMAU KIPROP");
  });

  it("combines adjacent name lines when OCR splits the printed name", () => {
    expect(extractNameCandidate("JOHN\nKAMAU\nDATE OF BIRTH", "John Kamau")).toBe("JOHN KAMAU");
  });
});
