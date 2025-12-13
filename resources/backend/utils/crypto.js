const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
// Ensure key is 32 bytes. If provided key is shorter/longer, we might hash it or expect correct length.
// For simplicity, we'll hash the env var to get 32 bytes.
const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || 'default-secret-key-CHANGE-ME').digest();

function encrypt(text) {
    if (typeof text !== 'string') text = JSON.stringify(text);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return {
        iv: iv.toString('hex'),
        encryptedData: encrypted.toString('hex')
    };
}

function decrypt(text, iv) {
    const ivBuffer = Buffer.from(iv, 'hex');
    const encryptedText = Buffer.from(text, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), ivBuffer);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString());
}

module.exports = { encrypt, decrypt };
