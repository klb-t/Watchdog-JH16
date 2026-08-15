import { LocalFileSystemStore } from './object_store';
import * as path from 'node:path';

const STORE_PATH = process.env.STORE_PATH || path.join(process.cwd(), 'data', 'object_store');
export const store = new LocalFileSystemStore(STORE_PATH);
