export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  let commas = 0; let semicolons = 0; let inHeaderQuote = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (inHeaderQuote && text[index + 1] === '"') index++;
      else inHeaderQuote = !inHeaderQuote;
    } else if (!inHeaderQuote && (char === '\n' || char === '\r')) break;
    else if (!inHeaderQuote && char === ',') commas++;
    else if (!inHeaderQuote && char === ';') semicolons++;
  }
  const delimiter = semicolons > commas ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else if (quoted || cell === '') quoted = !quoted;
      else throw new Error(`Неверная кавычка в строке ${rows.length + 1}`);
    } else if (!quoted && char === delimiter) {
      row.push(cell); cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Незакрытая кавычка в CSV');
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((line) => line.some((value) => value.trim() !== ''));
}

export function serializeCsv(rows: string[][]): string {
  const escape = (value: string) => {
    const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + rows.map((row) => row.map(escape).join(';')).join('\r\n');
}
