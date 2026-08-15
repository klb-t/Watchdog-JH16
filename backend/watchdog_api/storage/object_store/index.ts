import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ObjectStore {
  put(key: string, data: Buffer): Promise<string>;
  get(uri: string): Promise<Buffer>;
}

export class LocalFileSystemStore implements ObjectStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    fs.mkdirSync(this.basePath, { recursive: true });
  }

  async put(key: string, data: Buffer): Promise<string> {
    const filePath = path.join(this.basePath, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    
    // WORM compliance in the abstraction layer
    if (fs.existsSync(filePath)) {
      throw new Error("WORM Violation: Object already exists in store and cannot be overwritten.");
    }
    
    fs.writeFileSync(filePath, data);
    return `file://${filePath}`;
  }

  async get(uri: string): Promise<Buffer> {
    if (!uri.startsWith('file://')) throw new Error('Unsupported URI scheme');
    const filePath = uri.replace('file://', '');
    return fs.readFileSync(filePath);
  }
}
