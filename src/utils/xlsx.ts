import ExcelJS from 'exceljs'

export type XlsxCell = string | number | Date | null

export async function downloadXlsx(
  filename: string,
  title: string,
  period: string,
  headers: string[],
  rows: XlsxCell[][],
  amountColumn: number,
) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Urban Tanker'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Report', { views: [{ showGridLines: false }] })
  sheet.addRow([title])
  sheet.addRow([period])
  sheet.addRow([])
  sheet.addRow(headers)
  sheet.addRows(rows)
  sheet.columns = headers.map((header) => ({
    width: Math.min(42, Math.max(12, header.length + 2)),
  }))
  sheet.getRow(1).font = { bold: true, size: 14 }
  sheet.getRow(4).font = { bold: true }
  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4, column: headers.length },
  }
  sheet.getColumn(amountColumn).numFmt = '"INR" #,##0.00'

  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(buffer)
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
