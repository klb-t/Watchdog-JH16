import { ExtractionDatasetSchema } from '../../../shared/research_dataset';
import { ResearchRepository } from '../db/repositories/research';
import { WorkbenchRepository,WorkbenchError } from '../db/repositories/workbench';
import { canonicalHash } from '../domain/canonical';
import { copySource } from '../sources/copy_plan';
import { mappedSourceRows } from '../workbench/extraction_data';
import type { SourceCopy } from '../../../shared/source_copy';

export class ExtractionDatasetService {
  constructor(readonly research:ResearchRepository,readonly workbench:WorkbenchRepository){}
  async create(owner:string,trialId:string,input:unknown) {
    const settings=ExtractionDatasetSchema.parse(input),trial=this.research.trial(owner,trialId);
    if(!trial||trial.hash!==settings.expectedTrialHash)throw new WorkbenchError('Owned extraction trial is missing or its review hash changed.',409);
    const candidate=this.research.extractor(owner,trial.candidateId);
    if(trial.body.kind!=='EXECUTION'||!candidate||candidate.approvalState!=='APPROVED'||candidate.hash!==trial.body.candidateHash)throw new WorkbenchError('An execution of an activated owned parser is required.',409);
    const copied=copySource(trial.body.raw,candidate.body.plan);
    if(canonicalHash(copied)!==canonicalHash(trial.body.result))throw new WorkbenchError('Stored execution does not reproduce from its source.',409);
    const sourceCopy:SourceCopy={version:'source-copy-dataset-1',numericPolicy:'decimal-roundtrip-binary64-1',trialId,trialHash:trial.hash,
      candidateId:candidate.id,candidateHash:candidate.hash,plan:candidate.body.plan,raw:trial.body.raw,rawHash:copied.rawHash,
      mappings:settings.columns.map(c=>({key:c.key,sourceField:c.sourceField,emptyAsMissing:c.emptyAsMissing}))};
    const columns=settings.columns.map(({sourceField:_,emptyAsMissing:__,...c})=>c),{rows}=mappedSourceRows(sourceCopy,columns,settings.evidenceTier);
    return this.workbench.importDataset({version:'workbench-dataset-1',key:`copy-${canonicalHash(settings).slice(0,24)}`,name:settings.name,description:settings.description,
      source:{...settings.source,url:settings.source.url||`urn:sha256:${copied.rawHash}`,retrievedAt:trial.createdAt},providerProfileId:'manual-table',
      measure:settings.measure,normalization:settings.normalization,comparisonScope:settings.comparisonScope,languageMeaning:settings.languageMeaning,columns,rows,sourceCopy},owner,trialId);
  }
}
