(function () {
  'use strict';

  var fallback = {
    invoiceNo: 'UT-INV-2026-0928', orderNo: 'UT-260928', customer: 'Maneesh Kumar',
    address: 'Home, Adyar, Chennai - 600020', phone: '+91 98765 43210',
    service: '6 KL Water Tanker', requirement: 'Potable water', region: 'ECR / OMR',
    base: 2400, transport: 650, tax: 153, discount: 200, total: 3003,
    payment: 'Paid / UPI', date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  };

  function currentBill() {
    try { return Object.assign({}, fallback, JSON.parse(localStorage.getItem('ut-latest-invoice') || '{}')); }
    catch (e) { return fallback; }
  }

  function esc(value) { return String(value).replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7E]/g, ''); }
  function money(value) { return 'INR ' + Math.round(Number(value) || 0).toLocaleString('en-IN'); }
  function txt(out, x, y, size, value, bold) { out.push('BT /F' + (bold ? '2' : '1') + ' ' + size + ' Tf ' + x + ' ' + y + ' Td (' + esc(value) + ') Tj ET'); }
  function line(out, x1, y1, x2, y2) { out.push(x1 + ' ' + y1 + ' m ' + x2 + ' ' + y2 + ' l S'); }

  function createPdf(bill) {
    var o = ['q', '0.063 0.204 0.227 RG', '1.2 w', '28 28 539 786 re S'];
    o.push('0.031 0.537 0.620 rg', '505 730 34 34 re f', '1 1 1 rg'); txt(o, 514, 742, 14, 'UT', true);
    o.push('0.063 0.204 0.227 rg'); txt(o, 55, 760, 18, 'URBAN TANKER', true);
    o.push('0.031 0.537 0.620 rg'); txt(o, 55, 746, 7, 'WATER & INFRASTRUCTURE LOGISTICS', true);
    o.push('0.35 0.45 0.47 rg');
    ['Urban Tanker Water & Infrastructure Logistics Pvt. Ltd.', 'No. 48, OMR Service Road, Thoraipakkam, Chennai - 600097', 'billing@urbantanker.in  |  +91 44 4012 7788', 'GSTIN: 33AABCU7421R1ZP'].forEach(function (v, i) { txt(o, 55, 725 - i * 12, 8, v); });
    o.push('0.78 0.86 0.86 RG'); line(o, 55, 668, 540, 668);
    o.push('0.063 0.204 0.227 rg'); txt(o, 55, 646, 10, 'BILL TO', true); txt(o, 340, 646, 10, 'TAX INVOICE', true);
    o.push('0.35 0.45 0.47 rg');
    [bill.customer, bill.address, bill.phone].forEach(function (v, i) { txt(o, 55, 628 - i * 14, 9, v); });
    [['Invoice No.', bill.invoiceNo], ['Order No.', bill.orderNo], ['Issue Date', bill.date], ['Payment', bill.payment]].forEach(function (r, i) { txt(o, 340, 628 - i * 14, 8, r[0]); txt(o, 430, 628 - i * 14, 8, r[1], true); });
    o.push('0.91 0.97 0.97 rg', '55 520 485 25 re f', '0.063 0.204 0.227 rg');
    txt(o, 62, 530, 8, 'DESCRIPTION', true); txt(o, 335, 530, 8, 'QTY', true); txt(o, 390, 530, 8, 'UNIT PRICE', true); txt(o, 490, 530, 8, 'AMOUNT', true);
    o.push('0.78 0.86 0.86 RG'); [520, 492, 464].forEach(function (y) { line(o, 55, y, 540, y); });
    o.push('0.35 0.45 0.47 rg'); txt(o, 62, 503, 9, bill.service + ' - ' + bill.requirement); txt(o, 343, 503, 9, '1'); txt(o, 390, 503, 9, money(bill.base)); txt(o, 480, 503, 9, money(bill.base));
    txt(o, 62, 475, 9, bill.region + ' regional transport'); txt(o, 343, 475, 9, '1'); txt(o, 390, 475, 9, money(bill.transport)); txt(o, 480, 475, 9, money(bill.transport));
    var subtotal = Number(bill.base) + Number(bill.transport);
    [['Subtotal', money(subtotal)], ['GST (5%)', money(bill.tax)], ['Coupon discount', '- ' + money(bill.discount)], ['TOTAL PAID', money(bill.total)]].forEach(function (r, i) { o.push(i === 3 ? '0.063 0.204 0.227 rg' : '0.35 0.45 0.47 rg'); txt(o, 340, 435 - i * 20, i === 3 ? 11 : 9, r[0], i === 3); txt(o, 465, 435 - i * 20, i === 3 ? 11 : 9, r[1], i === 3); });
    o.push('0.78 0.86 0.86 RG'); line(o, 340, 368, 540, 368);
    o.push('0.063 0.204 0.227 rg'); txt(o, 55, 405, 10, 'PAYMENT DETAILS', true);
    o.push('0.35 0.45 0.47 rg'); ['HDFC Bank - Current Account', 'A/C: 50200078421901  |  IFSC: HDFC0001287', 'UPI: urbantanker@hdfcbank', 'Reference: ' + bill.orderNo].forEach(function (v, i) { txt(o, 55, 386 - i * 13, 8, v); });
    o.push('0.063 0.204 0.227 rg'); txt(o, 55, 310, 10, 'TERMS', true);
    o.push('0.35 0.45 0.47 rg'); txt(o, 55, 292, 8, 'Payment received in full. Delivery is subject to safe site access and booked capacity.'); txt(o, 55, 279, 8, 'Share the delivery OTP only after service completion. Computer-generated tax invoice.');
    o.push('0.78 0.86 0.86 RG'); line(o, 395, 260, 525, 260); o.push('0.063 0.204 0.227 rg'); txt(o, 420, 274, 12, 'S. Maneesh'); txt(o, 405, 244, 8, 'AUTHORIZED SIGNATORY', true); txt(o, 437, 231, 8, 'Urban Tanker');
    o.push('0.91 0.97 0.97 rg', '55 70 485 32 re f', '0.031 0.537 0.620 rg'); txt(o, 160, 83, 9, 'Thank you for choosing Urban Tanker - Clear price. Clear ETA.', true); o.push('Q');
    var stream = o.join('\n');
    var objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
    ];
    var pdf = '%PDF-1.4\n', offsets = [0];
    objects.forEach(function (obj, i) { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n'; });
    var xref = pdf.length; pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.slice(1).forEach(function (n) { pdf += String(n).padStart(10, '0') + ' 00000 n \n'; });
    pdf += 'trailer << /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function download() {
    var bill = currentBill(), url = URL.createObjectURL(createPdf(bill)), a = document.createElement('a');
    a.href = url; a.download = 'Urban-Tanker-' + bill.invoiceNo + '.pdf'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-download-invoice]')) download();
    if (event.target.closest('#payNow')) setTimeout(function () {
      var service = document.querySelector('#sumService'), capacity = document.querySelector('#sumCap');
      localStorage.setItem('ut-latest-invoice', JSON.stringify({
        invoiceNo: 'UT-INV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-6),
        orderNo: 'UT-' + String(Date.now()).slice(-6),
        service: ((capacity && capacity.textContent) || '6 KL') + ' ' + ((service && service.textContent) || 'Water tanker'),
        requirement: 'Customer-selected service', region: (document.querySelector('#region option:checked') || {}).textContent || 'Chennai',
        base: 2400, transport: 650, tax: 153, discount: 0, total: Number((document.querySelector('#total') || {}).textContent?.replace(/[^0-9]/g, '')) || 3203,
        payment: 'Paid / Online', date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      }));
    }, 950);
  });
})();
