export function normalizeNameTokens(name: string): Set<string> {
  return new Set(
    name
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function countMatchingNameTokens(signupName: string, documentText: string): number {
  const signupTokens = normalizeNameTokens(signupName);
  const documentTokens = normalizeNameTokens(documentText);
  return [...signupTokens].filter((token) => documentTokens.has(token)).length;
}

const nonNameTokens = new Set([
  "birth",
  "card",
  "county",
  "date",
  "district",
  "dob",
  "expiry",
  "given",
  "height",
  "id",
  "identity",
  "issue",
  "kenya",
  "marital",
  "national",
  "no",
  "number",
  "of",
  "place",
  "republic",
  "residence",
  "serial",
  "sex",
  "signature",
  "status",
  "surname",
  "tribe",
]);

export function extractNameCandidate(ocrText: string, signupName: string): string {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) =>
      line.replace(/^\s*(?:full\s+name|name|surname|given\s+names?)\s*[:.-]?\s*/i, "").trim(),
    )
    .map((line) => ({ line, tokens: [...normalizeNameTokens(line)] }))
    .filter(
      ({ line, tokens }) =>
        line.length > 0 &&
        !/\d/.test(line) &&
        tokens.length > 0 &&
        !tokens.some((token) => nonNameTokens.has(token)),
    );

  let bestCandidate = "";
  let bestMatchingCount = 0;
  for (let start = 0; start < lines.length; start += 1) {
    for (let length = 1; length <= 4 && start + length <= lines.length; length += 1) {
      const candidate = lines
        .slice(start, start + length)
        .map(({ line }) => line)
        .join(" ");
      const matchingCount = countMatchingNameTokens(signupName, candidate);
      if (
        matchingCount > bestMatchingCount ||
        (matchingCount === bestMatchingCount &&
          matchingCount > 0 &&
          candidate.length < bestCandidate.length)
      ) {
        bestCandidate = candidate;
        bestMatchingCount = matchingCount;
      }
    }
  }
  return bestCandidate;
}
