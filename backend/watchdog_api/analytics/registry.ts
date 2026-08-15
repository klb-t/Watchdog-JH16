import { Analyzer } from './base';
import { JH16Analyzer } from './jh16';

export class AnalyzerRegistry {
  private analyzers = new Map<string, Analyzer>();

  constructor() {
    this.register(new JH16Analyzer());
  }

  register(analyzer: Analyzer) {
    this.analyzers.set(analyzer.analyzer_id, analyzer);
  }

  get(id: string): Analyzer {
    const a = this.analyzers.get(id);
    if (!a) throw new Error(`Analyzer not found: ${id}`);
    return a;
  }
  listAnalyzers() {
    return Array.from(this.analyzers.values()).map(a => ({
      analyzer_id: a.analyzer_id,
      analyzer_version: a.analyzer_version
    }));
  }
}

export const analyzerRegistry = new AnalyzerRegistry();
