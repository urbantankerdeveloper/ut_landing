import { jsPDF } from 'jspdf'

export type PdfReportRow = { reference: string; label: string; category: string; status: string; amount: number; date: string }
export type InvoicePdf = { number: string; date: string; customer: string; service: string; location: string; amount: number; status: string }

function money(value: number) { return `INR ${value.toLocaleString('en-IN')}` }
function addBrandHeader(document: jsPDF, eyebrow: string, title: string) {
  document.setFillColor(16, 52, 58)
  document.rect(0, 0, 210, 30, 'F')
  document.setTextColor(255, 255, 255)
  document.setFontSize(9)
  document.text('UT  URBAN TANKER', 16, 13)
  document.setFontSize(7)
  document.text(eyebrow, 16, 22)
  document.setTextColor(16, 52, 58)
  document.setFontSize(20)
  document.text(title, 16, 48)
}
function addFooter(document: jsPDF) {
  const pageHeight = document.internal.pageSize.getHeight()
  document.setDrawColor(220, 233, 232)
  document.line(16, pageHeight - 20, 194, pageHeight - 20)
  document.setFontSize(8)
  document.setTextColor(96, 119, 122)
  document.text('Urban Tanker · Complete Water Solutions Partner', 16, pageHeight - 11)
}

export function downloadReportPdf(title: string, rows: PdfReportRow[], total: number) {
  const document = new jsPDF()
  addBrandHeader(document, 'ADMIN REPORT', title)
  document.setFontSize(10)
  document.text(`Generated ${new Date().toLocaleString()}`, 16, 59)
  document.setFontSize(12)
  document.text(`Total reported value: ${money(total)}`, 16, 72)
  let y = 88
  document.setFillColor(226, 245, 245)
  document.rect(16, y - 7, 178, 12, 'F')
  document.setFontSize(8)
  document.setTextColor(16, 52, 58)
  document.text('REFERENCE', 19, y)
  document.text('DESCRIPTION', 48, y)
  document.text('STATUS', 112, y)
  document.text('AMOUNT', 166, y)
  y += 13
  rows.forEach((row) => {
    if (y > 265) { addFooter(document); document.addPage(); addBrandHeader(document, 'ADMIN REPORT', title); y = 70 }
    document.setFontSize(8)
    document.text(row.reference, 19, y)
    document.text(row.label.slice(0, 32), 48, y)
    document.text(row.status.slice(0, 22), 112, y)
    document.text(money(row.amount), 166, y)
    document.setDrawColor(230, 237, 233)
    document.line(16, y + 4, 194, y + 4)
    y += 12
  })
  addFooter(document)
  document.save(`urban-tanker-${title.toLowerCase().replaceAll(' ', '-')}.pdf`)
}

export function downloadInvoicePdf(invoice: InvoicePdf) {
  const document = new jsPDF()
  addBrandHeader(document, 'CUSTOMER INVOICE', invoice.number)
  document.setFontSize(10)
  document.text(`Invoice date: ${invoice.date}`, 16, 61)
  document.text(`Billed to: ${invoice.customer}`, 16, 72)
  document.setFillColor(248, 251, 250)
  document.roundedRect(16, 86, 178, 62, 4, 4, 'F')
  document.setFontSize(9)
  document.setTextColor(96, 119, 122)
  document.text('SERVICE', 24, 100)
  document.text('DELIVERY LOCATION', 24, 119)
  document.text('STATUS', 24, 138)
  document.setTextColor(16, 52, 58)
  document.setFontSize(11)
  document.text(invoice.service, 82, 100)
  document.text(invoice.location, 82, 119)
  document.text(invoice.status, 82, 138)
  document.setDrawColor(220, 233, 232)
  document.line(16, 170, 194, 170)
  document.setFontSize(11)
  document.text('Total paid', 24, 187)
  document.setFontSize(20)
  document.text(money(invoice.amount), 150, 187)
  addFooter(document)
  document.save(`${invoice.number.toLowerCase()}.pdf`)
}
