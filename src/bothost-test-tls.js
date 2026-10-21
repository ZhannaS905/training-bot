const fs = require('node:fs');
const { X509Certificate } = require('node:crypto');
const { CA_PATH } = require('./bothost-test-config');
const FINGERPRINT = 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31';
function validateCertificate(pem = fs.readFileSync(CA_PATH, 'utf8'), now = Date.now()) {
  const cert = new X509Certificate(pem);
  if ((pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length !== 1 || pem.includes('PRIVATE KEY') ||
      cert.fingerprint256 !== FINGERPRINT || !cert.ca || cert.subject !== cert.issuer || !cert.verify(cert.publicKey) ||
      now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) throw Error('CA_REFUSED');
}
module.exports = { validateCertificate, FINGERPRINT };
