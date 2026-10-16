export async function readXlsx(bytes: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('В Excel-файле нет листа');
  if (sheet.columnCount > 50) throw new Error('В файле слишком много колонок (максимум 50)');
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (rows.length >= 302) return;
    const cells: string[] = [];
    for (let column = 1; column <= sheet.columnCount; column++) {
      const cell = row.getCell(column);
      const value = cell.value;
      if (typeof value === 'number' && Number.isInteger(value) && /^0+$/.test(cell.numFmt)) cells.push(String(value).padStart(cell.numFmt.length, '0'));
      else cells.push(cell.text.trim());
    }
    if (cells.some(Boolean)) rows.push(cells);
  });
  if (rows.length > 301) throw new Error('За один раз можно загрузить до 300 товаров');
  return rows;
}

export async function writeXlsx(rows: string[][]): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Товары');
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF654AD0' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `H${Math.max(1, rows.length)}` };
  [20, 38, 24, 24, 26, 18, 16, 45].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  return workbook.xlsx.writeBuffer();
}
