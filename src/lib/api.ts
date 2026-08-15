import { Run, Source, Analyzer, RunSubmission, FetchEvent, Manifest } from '../types';

const API_BASE = '/api';

export async function fetchSources(): Promise<Source[]> {
  const res = await fetch(`${API_BASE}/sources`);
  if (!res.ok) throw new Error('Failed to fetch sources');
  const data = await res.json();
  return data.sources;
}

export async function fetchAnalyzers(): Promise<Analyzer[]> {
  const res = await fetch(`${API_BASE}/analyzers`);
  if (!res.ok) throw new Error('Failed to fetch analyzers');
  const data = await res.json();
  return data.analyzers;
}

export async function submitRun(submission: RunSubmission): Promise<{ run_id: string, status: string }> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission)
  });
  if (!res.ok) throw new Error('Failed to submit run');
  return res.json();
}

export async function fetchRuns(): Promise<Run[]> {
  const res = await fetch(`${API_BASE}/runs`);
  if (!res.ok) throw new Error('Failed to fetch runs');
  const data = await res.json();
  return data.runs;
}

export async function fetchRun(id: string): Promise<Run> {
  const res = await fetch(`${API_BASE}/runs/${id}`);
  if (!res.ok) throw new Error('Failed to fetch run');
  const data = await res.json();
  return data.run;
}

export async function fetchRunResults(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/runs/${id}/results`);
  if (!res.ok) throw new Error('Failed to fetch run results');
  return res.json();
}

export async function fetchRunManifest(id: string): Promise<Manifest | null> {
  const res = await fetch(`${API_BASE}/runs/${id}/manifest`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch manifest');
  const data = await res.json();
  return data.manifest;
}

export async function fetchRunEvents(id: string): Promise<FetchEvent[]> {
  const res = await fetch(`${API_BASE}/runs/${id}/fetch-events`);
  if (!res.ok) throw new Error('Failed to fetch events');
  const data = await res.json();
  return data.events;
}
