import type { EvidenceSource } from '@/types/chat';
import type { HrCoverage, HrMatch, HrRequirement } from '@/types/hr';
import { AppError, ERROR_BAD_RESPONSE, getJson, isRecord, postJson } from './client';
import { toSource } from './conversations';

const bad = () => new AppError({ code: ERROR_BAD_RESPONSE, message: 'Unexpected response from the backend' });
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function sources(value: unknown): EvidenceSource[] {
  return list(value).flatMap((item) => {
    try {
      return [toSource(item)];
    } catch {
      return [];
    }
  });
}

const toCoverage = (value: unknown): HrCoverage => {
  const record = isRecord(value) ? value : {};
  const count = (item: unknown) => (typeof item === 'number' ? item : 0);
  return { confirmed: count(record.confirmed), partial: count(record.partial), notFound: count(record.notFound) };
};

/** "Confirmed" needs a quote from the resume. Without one the requirement is shown as not found, whatever was sent. */
function toRequirement(value: unknown): HrRequirement[] {
  if (!isRecord(value) || typeof value.requirement !== 'string') return [];
  const evidence = sources(value.evidence);
  const status = value.status === 'confirmed' || value.status === 'partial' ? value.status : 'not_found';
  return [{
    requirement: value.requirement,
    kind: value.kind === 'nice' ? 'nice' : 'must',
    status: evidence.length ? status : 'not_found',
    explanation: typeof value.explanation === 'string' ? value.explanation : '',
    evidence,
    vacancySource: sources([value.vacancySource])[0] ?? null,
  }];
}

export function toHrMatch(value: unknown): HrMatch {
  if (!isRecord(value) || typeof value.id !== 'string') throw bad();
  const coverage = isRecord(value.coverage) ? value.coverage : {};
  return {
    id: value.id,
    status: value.status === 'ready' || value.status === 'processing' ? value.status : 'failed',
    errorCode: isRecord(value.error) && typeof value.error.code === 'string' ? value.error.code : null,
    requirements: list(value.requirements).flatMap(toRequirement),
    skills: list(value.skills).flatMap((skill) => (isRecord(skill) && typeof skill.name === 'string' ? [{ name: skill.name, evidence: sources(skill.evidence) }] : [])).filter((skill) => skill.evidence.length > 0),
    coverage: { must: toCoverage(coverage.must), nice: toCoverage(coverage.nice) },
    notice: typeof value.notice === 'string' ? value.notice : null,
  };
}

export async function startHrMatch(resumeDocumentId: string, vacancyDocumentId: string, language: string): Promise<HrMatch> {
  const response = await postJson('/hr/matches', { resumeDocumentId, vacancyDocumentId, language });
  return toHrMatch(await response.json());
}

export async function getHrMatch(id: string, signal?: AbortSignal): Promise<HrMatch> {
  return toHrMatch(await getJson(`/hr/matches/${encodeURIComponent(id)}`, signal));
}
