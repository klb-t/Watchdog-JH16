import { ResearchRepository } from '../db/repositories/research';
import { AssistantService } from './assistant';
import { AutomationError } from '../db/repositories/automation';
import { CopyPlanSchema } from '../../../shared/research';
import { copySource, sourceStructure } from '../sources/copy_plan';
import { canonicalHash } from '../domain/canonical';

export class ExtractionWorkshop {
  constructor(readonly repo: ResearchRepository, readonly assistant: AssistantService) {}
  async propose(owner: string, input: string, format: 'json' | 'csv', goal: string) {
    const structure = sourceStructure(input, format);
    const generated = await this.assistant.propose(owner, 'extraction_plan', `Return JSON only: {"version":"copy-plan-1","name":"descriptive name","format":"${format}","rowsPointer":"JSON pointer to record array, empty for CSV","fields":[{"name":"output_field","selector":"relative JSON pointer or exact CSV column header","required":true}]}.\nOnly select scalar source fields. No constants, generated values, transformations or executable code. The source below contains structure only, never cell values. Goal: ${goal}\nSTRUCTURE:\n${JSON.stringify(structure)}`);
    const plan = CopyPlanSchema.parse(JSON.parse(generated.text.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')));
    if (plan.format !== format) throw new AutomationError('Proposed parser changed the source format');
    return this.repo.saveExtractor(owner, plan, { provider: generated.providerKey, model: generated.model, reservationId: generated.reservationId,
      structureHash: canonicalHash(structure), valuesSentToModel: false, proposalState: 'PROPOSED' });
  }
  test(owner: string, id: string, raw: string, expected: Record<string,string|null>[]) {
    const c = this.repo.extractor(owner, id); if (!c) throw new AutomationError('Extractor not found', 404);
    try {
      const result = copySource(raw, c.body.plan), passed = expected.length > 0 && canonicalHash(result.records) === canonicalHash(expected);
      return this.repo.saveTrial(owner, id, { candidateHash: c.hash, passed, raw, expected, result,
        validationScope: 'Exact outputs on this fixture only; not universal source compatibility' });
    } catch (e) { return this.repo.saveTrial(owner, id, { candidateHash: c.hash, passed: false, raw, expected, error: (e as Error).message }); }
  }
  run(owner: string, id: string, raw: string) {
    const c = this.repo.extractor(owner, id); if (!c || c.approvalState !== 'APPROVED') throw new AutomationError('Test and activate this exact extractor version first');
    const result = copySource(raw, c.body.plan);
    return this.repo.saveTrial(owner, id, { candidateHash: c.hash, kind: 'EXECUTION', raw, result, deterministic: true, llmCalls: 0 });
  }
}
