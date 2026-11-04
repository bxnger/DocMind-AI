// Builds public/demo/sample-agreement.pdf: a fictional contract used as the labelled
// sample document. Written by hand so the repository needs no PDF-writing dependency.
import { writeFileSync } from 'node:fs';

const PAGE = { width: 612, height: 792, marginX: 72, top: 720, bottom: 84 };
const BODY = { size: 10.5, leading: 16, chars: 92 };

const content = [
  ['title', 'Master Service Agreement'],
  ['subtitle', 'Northwind Logistics LLP and Halcyon Cloud Systems Ltd'],
  ['note', 'SAMPLE DOCUMENT. The parties and terms are fictional. Created to demonstrate DOCMIND AI.'],
  ['h', '1. Parties and Purpose'],
  ['p', '1.1 This Master Service Agreement is made between Northwind Logistics LLP, the Customer, and Halcyon Cloud Systems Ltd, the Provider. It takes effect on 1 March 2026, the Effective Date.'],
  ['p', '1.2 The Provider will supply the fleet tracking platform described in this Agreement. The platform collects vehicle location data and delivers route reports to the Customer through a web dashboard.'],
  ['h', '2. Definitions'],
  ['p', '2.1 Service means the hosted fleet tracking platform, including its web dashboard, reporting tools, and programming interfaces.'],
  ['p', '2.2 Customer Data means all vehicle, driver, and route information that the Customer or its authorised users submit to the Service.'],
  ['p', '2.3 Business Day means any day other than a Saturday, a Sunday, or a public holiday in the Republic of Kazakhstan.'],
  ['p', '2.4 Confidential Information means any non-public business, technical, or financial information that one party discloses to the other in connection with this Agreement.'],
  ['h', '3. Services and Support'],
  ['p', '3.1 The Provider will make the Service available to up to 450 vehicles registered by the Customer. Additional vehicles may be added by a signed order form.'],
  ['p', '3.2 The Provider will give the Customer technical support by email and telephone from 09:00 to 18:00 Astana time on every Business Day.'],
  ['p', '3.3 The Provider will respond to a critical incident within 2 hours of receiving a report from the Customer. All other support requests receive a first response within 1 Business Day.'],
  ['p', '3.4 The Customer is responsible for the accuracy of Customer Data and for keeping the login credentials of its authorised users secure.'],
  ['h', '4. Fees and Payment'],
  ['p', '4.1 The Customer will pay a monthly subscription fee of 1,250 US dollars for the Service. The Provider will send an invoice on the first Business Day of each calendar month.'],
  ['p', '4.2 Each invoice is payable within 30 days of the invoice date. Payments are made by bank transfer to the account stated on the invoice.'],
  ['p', '4.3 Overdue amounts accrue late payment interest of 1.5 percent per month from the due date until the date of payment.'],
  ['p', '4.4 If an undisputed invoice remains unpaid 45 days after the due date, the Provider may suspend the Service after giving 10 days of written warning.'],
  ['p', '4.5 The Provider may increase the subscription fee once in each contract year by no more than 5 percent, by giving the Customer at least 90 days of written notice.'],
  ['h', '5. Service Levels'],
  ['p', '5.1 The Provider will keep the Service available for at least 99.5 percent of each calendar month, excluding scheduled maintenance.'],
  ['p', '5.2 Scheduled maintenance takes place on Sundays between 01:00 and 05:00 Astana time. The Provider will announce it at least 3 Business Days in advance.'],
  ['p', '5.3 If availability falls below the agreed level in a month, the Customer receives a service credit of 5 percent of that monthly fee for each full percentage point of shortfall, up to a maximum credit of 25 percent.'],
  ['p', '5.4 Service credits are the sole financial remedy for missed availability targets and are applied to the next invoice.'],
  ['h', '6. Confidentiality'],
  ['p', '6.1 Each party will keep Confidential Information of the other party secret and will use it only to perform this Agreement.'],
  ['p', '6.2 A party may disclose Confidential Information to employees and professional advisers who need to know it and who are bound by equivalent duties of confidentiality.'],
  ['p', '6.3 The obligations in this section continue for 5 years after this Agreement ends.'],
  ['h', '7. Data Protection and Security'],
  ['p', '7.1 The Customer remains the owner of all Customer Data. The Provider processes Customer Data only on the documented instructions of the Customer.'],
  ['p', '7.2 All Customer Data will be stored in data centres located in the Republic of Kazakhstan and encrypted both in transit and at rest.'],
  ['p', '7.3 The Provider will notify the Customer of any personal data breach within 72 hours of becoming aware of it, and will describe the affected data and the steps taken in response.'],
  ['p', '7.4 The Provider will create encrypted backups of Customer Data every 24 hours and will keep each backup for 30 days.'],
  ['p', '7.5 Within 30 days after this Agreement ends, the Provider will return Customer Data in a machine-readable format and then delete all remaining copies.'],
  ['h', '8. Intellectual Property'],
  ['p', '8.1 The Provider retains all intellectual property rights in the Service. The Customer receives a non-exclusive, non-transferable right to use the Service during the term of this Agreement.'],
  ['p', '8.2 The Customer may not resell the Service, reverse engineer its software, or use it to build a competing product.'],
  ['h', '9. Limitation of Liability'],
  ['p', '9.1 The total liability of each party under this Agreement in any contract year is capped at the total fees paid or payable in the 12 months before the event that gave rise to the claim.'],
  ['p', '9.2 Neither party is liable for loss of profit, loss of revenue, or any indirect or consequential loss.'],
  ['p', '9.3 The limits in this section do not apply to fraud, to breach of confidentiality, or to any liability that cannot be limited by law.'],
  ['h', '10. Term and Termination'],
  ['p', '10.1 This Agreement has an initial term of 24 months from the Effective Date and renews automatically for periods of 12 months unless terminated under this section.'],
  ['p', '10.2 Either party may terminate this Agreement for convenience by giving the other party at least 60 days of written notice.'],
  ['p', '10.3 Either party may terminate this Agreement immediately if the other party commits a material breach and fails to remedy it within 30 days of receiving written notice of the breach.'],
  ['p', '10.4 On termination, the Customer will pay all fees due up to the termination date, and the Provider will refund any prepaid fees for the period after that date.'],
  ['h', '11. Governing Law and Disputes'],
  ['p', '11.1 This Agreement is governed by the laws of the Republic of Kazakhstan.'],
  ['p', '11.2 The parties will first try to resolve any dispute through good faith negotiation between senior managers for a period of 20 Business Days.'],
  ['p', '11.3 Any dispute that is not resolved by negotiation will be settled by arbitration at the Astana International Arbitration Centre, held in English.'],
  ['h', '12. General Terms'],
  ['p', '12.1 Notices under this Agreement must be in writing and sent by courier or by email with confirmation of receipt to the addresses listed in the signed order form.'],
  ['p', '12.2 Neither party may assign this Agreement without the prior written consent of the other party, except to a successor that acquires substantially all of its business.'],
  ['p', '12.3 Neither party is liable for a delay caused by events beyond its reasonable control, including natural disasters, war, or the failure of public networks.'],
  ['p', '12.4 This Agreement is the entire agreement between the parties on its subject matter and may only be changed by a written amendment signed by both parties.'],
];

function wrap(text, limit) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > limit) { lines.push(line); line = word; }
    else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const text = (x, y, font, size, value, rgb = '0.09 0.10 0.13') =>
  `${rgb} rg BT /${font} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET\n`;

const pages = [];
let stream = '';
let y = PAGE.top;
const newPage = () => { if (stream) pages.push(stream); stream = ''; y = PAGE.top; };
const need = (h) => { if (y - h < PAGE.bottom) newPage(); };

for (const [kind, value] of content) {
  if (kind === 'title') { stream += text(PAGE.marginX, y, 'F2', 22, value); y -= 28; }
  else if (kind === 'subtitle') { stream += text(PAGE.marginX, y, 'F1', 12, value, '0.30 0.33 0.40'); y -= 26; }
  else if (kind === 'note') {
    stream += `0.93 0.94 0.98 rg ${PAGE.marginX} ${y - 8} 468 26 re f\n`;
    stream += text(PAGE.marginX + 10, y, 'F1', 9, value, '0.25 0.22 0.55');
    y -= 40;
  } else if (kind === 'h') { need(50); y -= 8; stream += text(PAGE.marginX, y, 'F2', 12.5, value); y -= 20; }
  else {
    const lines = wrap(value, BODY.chars);
    need(lines.length * BODY.leading + 8);
    for (const l of lines) { stream += text(PAGE.marginX, y, 'F1', BODY.size, l); y -= BODY.leading; }
    y -= 7;
  }
}
pages.push(stream);

const objects = [];
const add = (body) => { objects.push(body); return objects.length; };
const catalog = add('');
const pagesObj = add('');
const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
const kids = pages.map((body, i) => {
  const footer =
    text(PAGE.marginX, 48, 'F1', 8.5, 'Sample Master Service Agreement. Fictional parties.', '0.45 0.48 0.54') +
    text(PAGE.width - PAGE.marginX - 40, 48, 'F1', 8.5, `Page ${i + 1} of ${pages.length}`, '0.45 0.48 0.54');
  const data = body + footer;
  const c = add(`<< /Length ${Buffer.byteLength(data, 'latin1')} >>\nstream\n${data}endstream`);
  return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
});
objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
const info = add('<< /Title (Sample Master Service Agreement) /Producer (DOCMIND AI sample generator) >>');

let pdf = '%PDF-1.4\n';
const offsets = objects.map((body, i) => {
  const offset = Buffer.byteLength(pdf, 'latin1');
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  return offset;
});
const xref = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync('public/demo/sample-agreement.pdf', pdf, 'latin1');
console.log(`Wrote ${pages.length} pages`);
