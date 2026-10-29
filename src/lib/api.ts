import { clientError } from './api_error';
import { Run, Source, Analyzer, RunSubmission, FetchEvent, Manifest } from '../types';

const API_BASE = '/api';

export async function fetchSources(): Promise<Source[]> {
  const res = await fetch(`${API_BASE}/sources`);
  if (!res.ok) throw clientError('client_fetch_sources', 'Failed to fetch sources', { status: res.status });
  const data = await res.json();
  return data.sources;
}

export async function fetchAnalyzers(): Promise<Analyzer[]> {
  const res = await fetch(`${API_BASE}/analyzers`);
  if (!res.ok) throw clientError('client_fetch_analyzers', 'Failed to fetch analyzers', { status: res.status });
  const data = await res.json();
  return data.analyzers;
}

export async function submitRun(submission: RunSubmission): Promise<{ run_id: string, status: string }> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission)
  });
  if (!res.ok) throw clientError('client_submit_run', 'Failed to submit run', { status: res.status });
  return res.json();
}

export async function fetchRuns(): Promise<Run[]> {
  const res = await fetch(`${API_BASE}/runs`);
  if (!res.ok) throw clientError('client_fetch_runs', 'Failed to fetch runs', { status: res.status });
  const data = await res.json();
  return data.runs;
}

export async function fetchRun(id: string): Promise<Run> {
  const res = await fetch(`${API_BASE}/runs/${id}`);
  if (!res.ok) throw clientError('client_fetch_run', 'Failed to fetch run', { status: res.status });
  const data = await res.json();
  return data.run;
}

export async function fetchRunResults(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/runs/${id}/results`);
  if (!res.ok) throw clientError('client_fetch_run_results', 'Failed to fetch run results', { status: res.status });
  return res.json();
}

export async function fetchRunManifest(id: string): Promise<Manifest | null> {
  const res = await fetch(`${API_BASE}/runs/${id}/manifest`);
  if (res.status === 404) return null;
  if (!res.ok) throw clientError('client_fetch_manifest', 'Failed to fetch manifest', { status: res.status });
  const data = await res.json();
  return data.manifest;
}

export async function fetchRunEvents(id: string): Promise<FetchEvent[]> {
  const res = await fetch(`${API_BASE}/runs/${id}/fetch-events`);
  if (!res.ok) throw clientError('client_fetch_events', 'Failed to fetch events', { status: res.status });
  const data = await res.json();
  return data.events;
}
