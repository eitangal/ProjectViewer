/**
 * CSV / TSV Parsing, Sorting, Filtering, and Export Utilities (RFC 4180 compliant)
 */

export function autoDetectDelimiter(sample: string): string {
  if (!sample) return ',';
  // Check the first row up to the first unquoted newline
  const firstLine = sample.split(/\r\n|\n|\r/)[0] || '';
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;
  let pipes = 0;

  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') {
      if (inQuotes && firstLine[i + 1] === '"') {
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (ch === ',') commas++;
      else if (ch === ';') semicolons++;
      else if (ch === '\t') tabs++;
      else if (ch === '|') pipes++;
    }
  }

  const counts = [
    { delim: ',', count: commas },
    { delim: ';', count: semicolons },
    { delim: '\t', count: tabs },
    { delim: '|', count: pipes },
  ];

  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].delim : ',';
}

export function parseCsv(text: string, customDelimiter?: string): string[][] {
  if (!text || text.trim() === '') {
    return [];
  }

  const delimiter = customDelimiter || autoDetectDelimiter(text);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          // Escaped quote: "" -> "
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += ch;
        i++;
        continue;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
        continue;
      }

      if (text.substring(i, i + delimiter.length) === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        i += delimiter.length;
        continue;
      }

      if (ch === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
        continue;
      }

      if (ch === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
        continue;
      }

      currentField += ch;
      i++;
    }
  }

  // Push final field & row if present
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Trim trailing empty row if caused by ending newline
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && lastRow[0].trim() === '') {
      rows.pop();
    }
  }

  // Normalize all rows to have uniform column count matching the max columns
  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  if (maxCols > 0) {
    for (let r = 0; r < rows.length; r++) {
      while (rows[r].length < maxCols) {
        rows[r].push('');
      }
    }
  }

  return rows;
}

export function compareCsvValues(a: string, b: string): number {
  const cleanA = (a ?? '').trim();
  const cleanB = (b ?? '').trim();

  // Empty values always sort to the bottom
  if (cleanA === '' && cleanB === '') return 0;
  if (cleanA === '') return 1;
  if (cleanB === '') return -1;

  // Numeric comparison (handles decimals, negatives, currency/commas)
  const numRegex = /^-?[\d,]+(\.\d+)?$/;
  if (numRegex.test(cleanA) && numRegex.test(cleanB)) {
    const numA = parseFloat(cleanA.replace(/,/g, ''));
    const numB = parseFloat(cleanB.replace(/,/g, ''));
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
  }

  // Date comparison (valid timestamps with reasonable length, not pure numbers)
  if (cleanA.length >= 8 && cleanB.length >= 8) {
    const timeA = Date.parse(cleanA);
    const timeB = Date.parse(cleanB);
    if (!isNaN(timeA) && !isNaN(timeB)) {
      return timeA - timeB;
    }
  }

  return cleanA.localeCompare(cleanB, undefined, { numeric: true, sensitivity: 'base' });
}

export function exportToCsv(headers: string[], rows: string[][], delimiter = ','): string {
  const escapeCell = (cell: string) => {
    const val = cell ?? '';
    if (val.includes(delimiter) || val.includes('"') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const headerLine = headers.map(escapeCell).join(delimiter);
  const dataLines = rows.map((row) => row.map(escapeCell).join(delimiter));
  return [headerLine, ...dataLines].join('\n');
}

export function exportToJson(headers: string[], rows: string[][]): string {
  const data = rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const key = h && h.trim() ? h.trim() : `Column_${idx + 1}`;
      obj[key] = row[idx] ?? '';
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}
