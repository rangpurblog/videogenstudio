export interface ProductMapping {
  productIndex: number;
  script: string;
  link: string;
}

export interface ParseResult {
  mappings: ProductMapping[];
  unmappedLinks: string[];
  missingSections: number[];
}

/**
 * Finds all "Product N:" markers in the script and extracts the text that
 * follows each one until the next marker (or end of string). Then pairs each
 * extracted section with the product link at position N-1 from the links array.
 */
export function parseScript(script: string, links: string[]): ParseResult {
  const pattern = /Product\s+(\d+)\s*:/gi;
  const matches = [...script.matchAll(pattern)];

  if (matches.length === 0) {
    return { mappings: [], unmappedLinks: links.filter(Boolean), missingSections: [] };
  }

  const mappings: ProductMapping[] = matches.map((match, i) => {
    const productIndex = parseInt(match[1], 10);
    const contentStart = match.index! + match[0].length;
    const contentEnd = matches[i + 1]?.index ?? script.length;
    const sectionScript = script.slice(contentStart, contentEnd).trim();

    return {
      productIndex,
      script: sectionScript,
      link: links[productIndex - 1] ?? '',
    };
  });

  const usedIndices = new Set(mappings.map((m) => m.productIndex));
  const unmappedLinks = links
    .filter(Boolean)
    .filter((_, i) => !usedIndices.has(i + 1));

  const missingSections: number[] = [];
  for (let i = 1; i <= links.filter(Boolean).length; i++) {
    if (!usedIndices.has(i)) missingSections.push(i);
  }

  return { mappings, unmappedLinks, missingSections };
}
