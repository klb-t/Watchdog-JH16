import { eq } from 'drizzle-orm';
import { runs } from '../schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'node:crypto';

export type RunState = 'CREATED' | 'QUEUED' | 'ACQUIRING' | 'NORMALIZING' | 'ANALYZING' | 'SUCCESS' | 'FAILED';

export class RunRepository {
  constructor(private db: BetterSQLite3Database<any>) {}

  createRun(type: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE', config: any): string {
    const id = randomUUID();
    this.db.insert(runs).values({
      id,
      type,
      status: 'CREATED',
      config: JSON.stringify(config),
      created_at: new Date().toISOString()
    }).run();
    return id;
  }

  updateStatus(id: string, status: RunState, errorCode?: string) {
    const updateData: any = { status };
    if (errorCode) updateData.error_code = errorCode;
    if (status === 'SUCCESS' || status === 'FAILED') {
      updateData.completed_at = new Date().toISOString();
    }
    
    this.db.update(runs).set(updateData).where(eq(runs.id, id)).run();
  }

  getRun(id: string) {
    return this.db.select().from(runs).where(eq(runs.id, id)).get();
  }

  getRuns(limit: number = 50) {
    // Ordering manually since sqlite created_at is ISO string
    const all = this.db.select().from(runs).all();
    return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, limit);
  }
}
