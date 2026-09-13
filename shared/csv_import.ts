/** RFC4180-style parser: quoting/newlines are syntax, never guessed locale numbers. */
export function parseCsv(text: string, separator = ',', preserveBlankRecords = false): string[][] {
  if (![',', ';', '\t'].includes(separator)) throw new Error('Unsupported delimiter.');
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, endedQuote = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') { if (input[i + 1] === '"') { value += '"'; i++; } else { quoted = false; endedQuote = true; } }
      else value += ch;
    } else if (ch === '"' && value === '' && !endedQuote) quoted = true;
    else if (ch === separator) { row.push(value); value = ''; endedQuote = false; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(value); if (preserveBlankRecords || row.some(v => v !== '')) rows.push(row); row = []; value = ''; endedQuote = false;
    } else {
      if (endedQuote) throw new Error('Unexpected text after a closing quote.');
      value += ch;
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted value.');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
