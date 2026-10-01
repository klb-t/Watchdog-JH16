import * as net from 'node:net';

export interface CapturedMail { from: string; to: string[]; data: string }

/**
 * The smallest SMTP server nodemailer will talk to: enough of RFC 5321 to
 * accept a message over a real socket and hand it to the test. No TLS, no
 * auth — it exists so the mail path is exercised end to end rather than
 * through a stubbed transport function.
 */
export async function startFakeSmtp(): Promise<{ port: number; mails: CapturedMail[]; close(): Promise<void> }> {
  const mails: CapturedMail[] = [];
  const server = net.createServer(socket => {
    let buffer = '';
    let inData = false;
    let current: CapturedMail = { from: '', to: [], data: '' };
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 fake-smtp ready');
    socket.on('data', chunk => {
      buffer += chunk.toString('utf-8');
      while (true) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          current.data = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          mails.push(current);
          current = { from: '', to: [], data: '' };
          inData = false;
          reply('250 queued');
          continue;
        }
        const nl = buffer.indexOf('\r\n');
        if (nl < 0) return;
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') { socket.write('250-fake-smtp\r\n250 8BITMIME\r\n'); }
        else if (verb === 'MAIL') { current.from = line.replace(/^MAIL FROM:\s*/i, ''); reply('250 ok'); }
        else if (verb === 'RCPT') { current.to.push(line.replace(/^RCPT TO:\s*<?([^>\s]+)>?.*$/i, '$1')); reply('250 ok'); }
        else if (verb === 'DATA') { inData = true; reply('354 go ahead'); }
        else if (verb === 'QUIT') { reply('221 bye'); socket.end(); return; }
        else reply('250 ok');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return { port, mails, close: () => new Promise(r => server.close(() => r())) };
}

/** The decoded text body of a captured message: 7bit, quoted-printable or base64. */
export function mailText(m: CapturedMail): string {
  const split = m.data.indexOf('\r\n\r\n');
  const headers = m.data.slice(0, split);
  const body = m.data.slice(split + 4);
  const encoding = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase();
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf-8');
  if (encoding !== 'quoted-printable') return body;
  const soft = body.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    const hex = soft.slice(i + 1, i + 3);
    if (soft[i] === '=' && /^[0-9A-F]{2}$/.test(hex)) { bytes.push(parseInt(hex, 16)); i += 2; }
    else bytes.push(soft.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf-8');
}

/** The decoded Subject header (nodemailer encodes non-ASCII subjects). */
export function mailSubject(m: CapturedMail): string {
  const raw = /^subject:\s*(.*(?:\r\n[ \t].*)*)/im.exec(m.data)?.[1] ?? '';
  // RFC 2047: whitespace between two adjacent encoded words is not part of the text.
  return raw.replace(/\r\n[ \t]/g, ' ').replace(/\?=\s+=\?/g, '?==?').replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, kind: string, text: string) =>
    kind.toLowerCase() === 'b' ? Buffer.from(text, 'base64').toString('utf-8')
      : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_h, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf-8'));
}
