import { createClient } from '@supabase/supabase-js';
import type { ProductMapping } from './scriptParser';
import type { FetchProductResult, ProductImage, ProductVideo } from '../electron.d';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://placeholder.supabase.co';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface VideoProject {
  id: string;
  script: string;
  video_style: string;
  video_length: string;
  mappings: ProductMapping[];
  status: string;
  created_at: string;
}

export async function saveVideoProject(payload: {
  script: string;
  videoStyle: string;
  mappings: ProductMapping[];
}): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('video_projects')
    .insert({
      script: payload.script,
      video_style: payload.videoStyle,
      video_length: '',
      mappings: payload.mappings,
      status: 'processing',
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to save project:', error.message);
    return null;
  }
  return data;
}

export async function updateProjectStatus(id: string, status: string) {
  await supabase.from('video_projects').update({ status }).eq('id', id);
}

export async function fetchRecentProjects(limit = 20): Promise<VideoProject[]> {
  const { data } = await supabase
    .from('video_projects')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data as VideoProject[]) ?? [];
}

export async function saveProductAsset({
  projectId,
  productIndex,
  sourceUrl,
  result,
}: {
  projectId?: string;
  productIndex: number;
  sourceUrl: string;
  result: FetchProductResult;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('product_assets')
    .insert({
      project_id: projectId ?? null,
      product_index: productIndex,
      source_url: sourceUrl,
      asin: '',
      title: result.title,
      images: result.images,
      videos: result.videos,
      fetch_source: result.source,
      fetch_error: result.error ?? '',
    })
    .select('id')
    .maybeSingle();

  if (error) { console.error('Failed to save product asset:', error.message); return null; }
  return data;
}

export interface MediaFileRecord {
  id?: string;
  product_asset_id?: string | null;
  product_index: number;
  file_type: 'image' | 'video';
  source_url: string;
  local_path: string;
  file_hash: string;
  file_size_bytes: number;
  original_size_bytes: number;
  width: number;
  height: number;
  optimized: boolean;
}

export async function saveMediaFiles(files: MediaFileRecord[]): Promise<void> {
  if (!files.length) return;
  const { error } = await supabase.from('media_files').insert(files);
  if (error) console.error('Failed to save media files:', error.message);
}

export async function fetchMediaFilesByProduct(productIndex: number): Promise<MediaFileRecord[]> {
  const { data } = await supabase
    .from('media_files')
    .select('*')
    .eq('product_index', productIndex)
    .order('created_at', { ascending: true });
  return (data as MediaFileRecord[]) ?? [];
}

export async function deleteMediaFilesByProduct(productIndex: number): Promise<void> {
  await supabase.from('media_files').delete().eq('product_index', productIndex);
}

// ── Audio tracks ────────────────────────────────────────────────────────────

export interface AudioTrackRecord {
  id?: string;
  project_id?: string | null;
  mode: 'single' | 'multi';
  product_index: number | null;
  file_name: string;
  local_path: string;
  duration_seconds: number;
  file_size_bytes: number;
  mime_type: string;
  created_at?: string;
}

export async function saveAudioTrack(track: AudioTrackRecord): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('audio_tracks')
    .insert({
      project_id: track.project_id ?? null,
      mode: track.mode,
      product_index: track.product_index,
      file_name: track.file_name,
      local_path: track.local_path,
      duration_seconds: track.duration_seconds,
      file_size_bytes: track.file_size_bytes,
      mime_type: track.mime_type,
    })
    .select('id')
    .maybeSingle();

  if (error) { console.error('Failed to save audio track:', error.message); return null; }
  return data;
}

export async function fetchAudioTracks(mode?: 'single' | 'multi'): Promise<AudioTrackRecord[]> {
  let query = supabase
    .from('audio_tracks')
    .select('*')
    .order('created_at', { ascending: false });

  if (mode) query = query.eq('mode', mode);

  const { data } = await query;
  return (data as AudioTrackRecord[]) ?? [];
}

export async function deleteAudioTrack(id: string): Promise<void> {
  await supabase.from('audio_tracks').delete().eq('id', id);
}

export async function upsertAudioTrack(track: AudioTrackRecord & { id?: string }): Promise<{ id: string } | null> {
  if (track.id) {
    await supabase.from('audio_tracks').delete().eq('id', track.id);
  }
  return saveAudioTrack(track);
}

// ── Audio timeline ──────────────────────────────────────────────────────────

export interface TimelineSegment {
  productIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  audioPath: string;
}

export interface AudioTimelineRecord {
  id?: string;
  audio_track_id: string | null;
  mode: 'single' | 'multi';
  sync_mode: 'auto' | 'manual';
  product_count: number;
  timeline: TimelineSegment[];
  created_at?: string;
  updated_at?: string;
}

export async function saveTimeline(record: AudioTimelineRecord): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('audio_timeline')
    .insert({
      audio_track_id: record.audio_track_id,
      mode: record.mode,
      sync_mode: record.sync_mode,
      product_count: record.product_count,
      timeline: record.timeline,
    })
    .select('id')
    .maybeSingle();

  if (error) { console.error('Failed to save timeline:', error.message); return null; }
  return data;
}

export async function updateTimeline(id: string, record: Partial<AudioTimelineRecord>): Promise<void> {
  await supabase
    .from('audio_timeline')
    .update({ ...record, updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function fetchLatestTimeline(audioTrackId?: string): Promise<AudioTimelineRecord | null> {
  let query = supabase
    .from('audio_timeline')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (audioTrackId) query = query.eq('audio_track_id', audioTrackId);

  const { data } = await query;
  return (data?.[0] as AudioTimelineRecord) ?? null;
}

export async function deleteTimeline(id: string): Promise<void> {
  await supabase.from('audio_timeline').delete().eq('id', id);
}

// ── Video render jobs ────────────────────────────────────────────────────────

export interface VideoRenderJobRecord {
  id?: string;
  project_id?: string | null;
  timeline_id?: string | null;
  style: string;
  quality: string;
  audio_mode: string;
  total_duration: number;
  product_count: number;
  render_plan?: object | null;
  output_path?: string;
  plan_path?: string;
  plan_only?: boolean;
  status: string;
  error_message?: string;
  created_at?: string;
  updated_at?: string;
}

export async function saveRenderJob(record: VideoRenderJobRecord): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('video_render_jobs')
    .insert({
      project_id: record.project_id ?? null,
      timeline_id: record.timeline_id ?? null,
      style: record.style,
      quality: record.quality,
      audio_mode: record.audio_mode,
      total_duration: record.total_duration,
      product_count: record.product_count,
      render_plan: record.render_plan ?? null,
      output_path: record.output_path ?? '',
      plan_path: record.plan_path ?? '',
      plan_only: record.plan_only ?? false,
      status: record.status,
      error_message: record.error_message ?? '',
    })
    .select('id')
    .maybeSingle();

  if (error) { console.error('Failed to save render job:', error.message); return null; }
  return data;
}

export async function updateRenderJob(id: string, patch: Partial<VideoRenderJobRecord>): Promise<void> {
  await supabase
    .from('video_render_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function fetchRenderJobs(limit = 20): Promise<VideoRenderJobRecord[]> {
  const { data } = await supabase
    .from('video_render_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as VideoRenderJobRecord[]) ?? [];
}

// ── Timeline edits ────────────────────────────────────────────────────────────

export interface ClipOverride {
  productIndex: number;
  clipIndex: number;
  duration?: number;
  motion?: string;
  path?: string;
}

export interface TrackOverride {
  productIndex: number;
  clips: ClipOverride[];
}

export interface TimelineEditRecord {
  id?: string;
  audio_timeline_id?: string | null;
  style: string;
  edits: TrackOverride[];
  created_at?: string;
  updated_at?: string;
}

export async function saveTimelineEdit(record: TimelineEditRecord): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('timeline_edits')
    .insert({
      audio_timeline_id: record.audio_timeline_id ?? null,
      style: record.style,
      edits: record.edits,
    })
    .select('id')
    .maybeSingle();

  if (error) { console.error('Failed to save timeline edit:', error.message); return null; }
  return data;
}

export async function updateTimelineEdit(id: string, edits: TrackOverride[]): Promise<void> {
  await supabase
    .from('timeline_edits')
    .update({ edits, updated_at: new Date().toISOString() })
    .eq('id', id);
}

export async function fetchLatestTimelineEdit(audioTimelineId?: string): Promise<TimelineEditRecord | null> {
  let query = supabase
    .from('timeline_edits')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (audioTimelineId) query = query.eq('audio_timeline_id', audioTimelineId);

  const { data } = await query;
  return (data?.[0] as TimelineEditRecord) ?? null;
}
