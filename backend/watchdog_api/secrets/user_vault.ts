import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SettingsRepository } from '../db/repositories/settings';
import { AutomationError } from '../db/repositories/automation';
import { registerSecretValue } from '../utils/redaction';
import { SecretHandle } from './index';

/** Credentials are personal envelopes, not global provider environment variables.
 * The encryption key lives outside the DB and object store, never in an export.
 * Cloud deployments can inject WATCHDOG_VAULT_KEY from their managed secret store. */
export class UserVault {
  constructor(private readonly repo: SettingsRepository, private readonly keyFile: string, private readonly env: NodeJS.ProcessEnv = process.env) {}
  private key(create: boolean): Buffer {
    if (this.env.WATCHDOG_VAULT_KEY) {
      registerSecretValue(this.env.WATCHDOG_VAULT_KEY);
      const key = Buffer.from(this.env.WATCHDOG_VAULT_KEY, 'base64');
      if (key.length !== 32 || key.toString('base64') !== this.env.WATCHDOG_VAULT_KEY) throw new AutomationError('Vault master key must encode exactly 32 bytes');
      return key;
    }
    if (!existsSync(this.keyFile)) {
      if (!create) throw new AutomationError('Vault key is missing; restore its protected backup');
      mkdirSync(path.dirname(this.keyFile), { recursive: true, mode: 0o700 });
      try {
        const fd = openSync(this.keyFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(fd, randomBytes(32)); } finally { closeSync(fd); }
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new AutomationError('Cannot create the protected vault key file'); }
    }
    const fd = openSync(this.keyFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.mode & 0o077 || info.size !== 32) throw new AutomationError('Vault key file must contain 32 bytes and have private permissions (0600)');
      return readFileSync(fd);
    } finally { closeSync(fd); }
  }
  save(owner: string, provider: string, value: unknown) {
    if (typeof value === 'string') registerSecretValue(value);
    if (typeof value !== 'string' || value.trim().length < 16 || value.length > 4096 || /[\s\u0000-\u001f]/.test(value.trim())) throw new AutomationError('Enter a complete API key without whitespace', 400);
    const id = randomUUID(), key = this.key(true), iv = randomBytes(12);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(`${id}:${provider}`));
      const ciphertext = Buffer.concat([cipher.update(value.trim(), 'utf8'), cipher.final()]);
      this.repo.writeEnvelope(owner, provider, id, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
    } finally { key.fill(0); }
    return { provider, status: 'stored', authenticationVerified: false };
  }
  resolve(owner: string, provider: string): SecretHandle {
    const row = this.repo.envelope(owner, provider), ref = row ? `user-vault:${row.id}` : 'user-vault:absent';
    if (!row) return new SecretHandle(ref, 'absent', 'Add your own provider key in Setup.', null);
    let key: Buffer | null = null;
    try {
      key = this.key(false); const envelope = JSON.parse(row.envelope);
      if (envelope.version !== 1) throw new Error('Unknown envelope');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(`${row.id}:${provider}`)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const value = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
      registerSecretValue(value); return new SecretHandle(ref, 'present', 'Stored for this account; provider acceptance is checked when used.', value);
    } catch { return new SecretHandle(ref, 'invalid', 'Cannot unlock the credential. Restore the vault key or replace your saved API key.', null); }
    finally { key?.fill(0); }
  }
  status(owner: string, provider: string) { const handle = this.resolve(owner, provider); return { provider, status: handle.status, detail: handle.detail, authenticationVerified: false }; }
  remove(owner: string, provider: string) { this.repo.deleteEnvelope(owner, provider); return { provider, status: 'absent' }; }
}
