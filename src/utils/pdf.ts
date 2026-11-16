import { jsPDF } from 'jspdf'

export type PdfReportRow = { reference: string; label: string; category: string; status: string; amount: number; date: string }
export type InvoicePdfLine = { description: string; quantity: number; subtotalPaise: number; taxPaise: number; taxRate: number; discountPaise: number; totalPaise: number }
export type InvoicePdf = {
  number: string
  date: string
  customer: string
  service: string
  location: string
  amount: number
  status: string
  lineItems?: InvoicePdfLine[]
  subtotalPaise?: number
  taxPaise?: number
  discountPaise?: number
}

function money(value: number) { return `INR ${value.toLocaleString('en-IN')}` }
function moneyPaise(value: number) { return money(value / 100) }
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
  document.setFontSize(9)
  document.text(`Delivery location: ${invoice.location}`, 16, 83)
  document.text(`Payment status: ${invoice.status}`, 16, 91)
  const lines = invoice.lineItems ?? []
  if (lines.length) {
    let y = 105
    document.setFillColor(226, 245, 245)
    document.rect(16, y - 6, 178, 10, 'F')
    document.setFontSize(8)
    document.setTextColor(16, 52, 58)
    document.text('SERVICE', 19, y)
    document.text('QTY', 145, y)
    document.text('AMOUNT', 166, y)
    y += 14
    for (const line of lines) {
      const description = document.splitTextToSize(line.description, 112) as string[]
      const rowHeight = Math.max(10, description.length * 4 + 4)
      if (y + rowHeight > 268) {
        addFooter(document)
        document.addPage()
        addBrandHeader(document, 'CUSTOMER INVOICE', invoice.number)
        y = 64
      }
      document.setFontSize(8)
      document.setTextColor(16, 52, 58)
      document.text(description, 19, y)
      document.text(String(line.quantity), 145, y)
      document.text(moneyPaise(line.totalPaise), 166, y)
      document.setDrawColor(230, 237, 233)
      document.line(16, y + rowHeight - 2, 194, y + rowHeight - 2)
      y += rowHeight
    }
    y += 8
    document.setFontSize(9)
    if (invoice.subtotalPaise !== undefined) {
      document.text('Subtotal', 120, y)
      document.text(moneyPaise(invoice.subtotalPaise), 166, y)
      y += 7
    }
    if (invoice.taxPaise) {
      document.text('GST', 120, y)
      document.text(moneyPaise(invoice.taxPaise), 166, y)
      y += 7
    }
    if (invoice.discountPaise) {
      document.text('Discount', 120, y)
      document.text(`-${moneyPaise(invoice.discountPaise)}`, 166, y)
      y += 7
    }
    document.setDrawColor(220, 233, 232)
    document.line(118, y + 2, 194, y + 2)
    document.setFontSize(11)
    document.text('Invoice total', 120, y + 12)
    document.text(money(invoice.amount), 166, y + 12)
  } else {
    document.setFillColor(248, 251, 250)
    document.roundedRect(16, 104, 178, 46, 4, 4, 'F')
    document.setFontSize(9)
    document.setTextColor(96, 119, 122)
    document.text('SERVICE', 24, 118)
    document.text('STATUS', 24, 138)
    document.setTextColor(16, 52, 58)
    document.setFontSize(11)
    document.text(invoice.service, 82, 118)
    document.text(invoice.status, 82, 138)
    document.setDrawColor(220, 233, 232)
    document.line(16, 170, 194, 170)
    document.setFontSize(11)
    document.text('Invoice total', 24, 187)
    document.setFontSize(20)
    document.text(money(invoice.amount), 150, 187)
  }
  addFooter(document)
  document.save(`${invoice.number.toLowerCase()}.pdf`)
}
