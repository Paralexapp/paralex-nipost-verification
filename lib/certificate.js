'use strict';
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fonts = require('./fonts');
const logo = require('./logo'); // base64 PNG/JPG, or null

const COMPANY = 'Paralex Logistics Limited';
const SERVICE = 'NIPOST VERIFICATION';
const PLUM = '#4C1450', PINK = '#CD2363', INK = '#1A1230', MUTED = '#6B6478', LINE = '#D9D4E0';
const fmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

async function buildCertificate(u) {
  // The QR code contains only the user's unique ID.
  const qr = await QRCode.toBuffer(u.id, { errorCorrectionLevel: 'H', margin: 1, width: 500, color: { dark: INK, light: '#FFFFFF' } });
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Certificate ${u.id}`, Author: COMPANY } });
  doc.registerFont('R', Buffer.from(fonts.regular, 'base64'));
  doc.registerFont('B', Buffer.from(fonts.bold, 'base64'));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const W = doc.page.width, H = doc.page.height, M = 48;
  const active = u.daysLeft > 0;
  const logoBuf = logo ? Buffer.from(logo, 'base64') : null;
  const label = (t, x, y, color = MUTED, w = 220) => doc.font('B').fontSize(7.5).fillColor(color).text(t, x, y, { width: w, characterSpacing: 1.2, lineBreak: false });
  const value = (t, x, y, size = 16, w = 230) => doc.font('B').fontSize(size).fillColor(INK).text(String(t || '—'), x, y, { width: w, height: size + 6, ellipsis: true });

  // Faint watermark, then top colour bars
  if (logoBuf) {
    doc.save();
    doc.opacity(0.05);
    doc.image(logoBuf, W / 2 - 230, 330, { fit: [460, 230], align: 'center', valign: 'center' });
    doc.restore();
  }
  doc.rect(0, 0, W, 10).fill(PLUM);
  doc.rect(0, 10, W, 3).fill(PINK);

  // Header: logo, company, status tag
  if (logoBuf) doc.image(logoBuf, M, 40, { fit: [180, 62], align: 'left', valign: 'center' });
  else doc.font('B').fontSize(24).fillColor(PLUM).text('PARALEX', M, 56, { characterSpacing: 3 });
  doc.font('B').fontSize(11).fillColor(INK).text(COMPANY.toUpperCase(), 250, 56, { width: 200, lineBreak: false });
  doc.font('B').fontSize(8).fillColor(PINK).text(SERVICE, 250, 74, { width: 200, characterSpacing: 1.5, lineBreak: false });

  const tag = active ? 'VERIFIED' : 'EXPIRED';
  const tw = 96;
  doc.roundedRect(W - M - tw, 46, tw, 20, 3).fill(active ? PINK : '#B3261E');
  doc.font('B').fontSize(8).fillColor('#FFFFFF').text(tag, W - M - tw, 52, { width: tw, align: 'center', characterSpacing: 1.5, lineBreak: false });
  doc.font('R').fontSize(7.5).fillColor(MUTED).text(`CERT NO: ${u.id}`, W - M - 160, 72, { width: 160, align: 'right', lineBreak: false });
  doc.lineWidth(0.8).strokeColor(LINE).moveTo(M, 122).lineTo(W - M, 122).stroke();

  // Holder name
  label('CERTIFICATE HOLDER', M, 156);
  const name = String(u.name).toUpperCase();
  let fs = 30;
  doc.font('B');
  while (fs > 14 && doc.fontSize(fs).widthOfString(name) > W - 2 * M) fs -= 2;
  doc.font('B').fontSize(fs).fillColor(INK).text(name, M, 172, { width: W - 2 * M, lineBreak: false });

  // Details (left) and QR (right)
  label('VEHICLE PLATE NO.', M, 246, PINK);   value(u.plate, M, 260, 22);
  label('SYSTEM IDENTIFIER', M, 318, PINK);   value(u.id, M, 332, 22);
  label('PHONE', M, 390, PINK);               value(u.phone, M, 404, 15);

  const qs = 150, qx = W - M - qs;
  doc.lineWidth(0.8).strokeColor(LINE).roundedRect(qx - 8, 238, qs + 16, qs + 16, 8).stroke();
  doc.image(qr, qx, 246, { width: qs });
  doc.font('B').fontSize(7).fillColor(MUTED).text('DIGITAL VERIFICATION KEY', qx - 8, 246 + qs + 18, { width: qs + 16, align: 'center', characterSpacing: 1, lineBreak: false });
  doc.font('R').fontSize(8).fillColor(MUTED).text(u.id, qx - 8, 246 + qs + 31, { width: qs + 16, align: 'center', lineBreak: false });

  // Dark bar: dates and status
  const by = 478, bh = 92, bw = W - 2 * M;
  doc.roundedRect(M, by, bw, bh, 16).fill(PLUM);
  const colW = bw / 3;
  const cell = (i, lab, val, color = '#FFFFFF') => {
    const x = M + 26 + i * colW;
    doc.font('B').fontSize(7.5).fillColor('#F2A0BF').text(lab, x, by + 26, { width: colW - 30, characterSpacing: 1.2, lineBreak: false });
    doc.font('B').fontSize(15).fillColor(color).text(val, x, by + 44, { width: colW - 8, lineBreak: false });
  };
  cell(0, 'REGISTRATION DATE', fmt(u.registeredAt));
  cell(1, 'VALID UNTIL', fmt(u.expiresAt));
  cell(2, 'STATUS', active ? 'ACTIVE' : 'EXPIRED', active ? '#7CE0A6' : '#FF9A92');

  // Issue date and signatures
  doc.font('R').fontSize(9).fillColor(MUTED).text(`Date issued: ${fmt(new Date())}`, M, 594, { lineBreak: false });
  const sy = 690, sw = 200;
  doc.lineWidth(0.9).strokeColor(INK).moveTo(M, sy).lineTo(M + sw, sy).stroke();
  doc.lineWidth(0.9).strokeColor(INK).moveTo(W - M - sw, sy).lineTo(W - M, sy).stroke();
  label('AUTHORISED SIGNATORY', M, sy + 7, MUTED, sw);
  doc.font('R').fontSize(8).fillColor(MUTED).text(`For ${COMPANY}`, M, sy + 19, { width: sw, lineBreak: false });
  label('COMPLIANCE OFFICER', W - M - sw, sy + 7, MUTED, sw);

  // Footer and seal
  doc.font('R').fontSize(7).fillColor(MUTED).text(
    `THIS DOCUMENT IS THE PROPERTY OF ${COMPANY.toUpperCase()}. THE HOLDER IS SUBJECT TO ALL APPLICABLE REGULATORY PROTOCOLS. VALIDITY CAN BE REVOKED WITHOUT PRIOR NOTICE IF ANY AGREEMENT IS BREACHED. TO VERIFY, SCAN THE QR CODE OR ENTER THE ID ON THE ${COMPANY.split(' ')[0].toUpperCase()} NIPOST VERIFICATION PAGE.`,
    M, 758, { width: W - 2 * M - 90, lineGap: 2 });
  if (active) {
    const cx = W - M - 32, cy = 778;
    doc.lineWidth(3).strokeColor(PLUM).circle(cx, cy, 30).stroke();
    doc.circle(cx, cy, 23).fill(PINK);
    doc.lineWidth(3.5).lineCap('round').lineJoin('round').strokeColor('#FFFFFF').moveTo(cx - 10, cy).lineTo(cx - 3, cy + 8).lineTo(cx + 11, cy - 8).stroke();
  }
  doc.rect(0, H - 6, W, 6).fill(PINK);

  doc.end();
  return done;
}

module.exports = { buildCertificate };
