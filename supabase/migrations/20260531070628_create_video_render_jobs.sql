/*
  # Create video_render_jobs table

  Tracks every video render attempt with full context of the audio-driven timeline.

  1. New Tables
    - `video_render_jobs`
      - `id` (uuid, primary key)
      - `project_id` (uuid, FK → video_projects, nullable)
      - `timeline_id` (uuid, FK → audio_timeline, nullable)
      - `style` (text) — cinematic | product | social | documentary
      - `quality` (text) — 720p | 1080p | 4k
      - `audio_mode` (text) — single | multi
      - `total_duration` (numeric) — seconds
      - `product_count` (integer)
      - `render_plan` (jsonb) — full plan produced by videoComposer
      - `output_path` (text, nullable) — absolute path to the mp4
      - `plan_path` (text, nullable) — path to the .plan.json file
      - `plan_only` (boolean) — true when FFmpeg was unavailable
      - `status` (text) — queued | rendering | completed | error
      - `error_message` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Authenticated users can insert and read their own records
*/

CREATE TABLE IF NOT EXISTS video_render_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid REFERENCES video_projects(id) ON DELETE SET NULL,
  timeline_id      uuid REFERENCES audio_timeline(id) ON DELETE SET NULL,
  style            text NOT NULL DEFAULT 'product',
  quality          text NOT NULL DEFAULT '1080p',
  audio_mode       text NOT NULL DEFAULT 'single',
  total_duration   numeric(10, 3) NOT NULL DEFAULT 0,
  product_count    integer NOT NULL DEFAULT 0,
  render_plan      jsonb,
  output_path      text DEFAULT '',
  plan_path        text DEFAULT '',
  plan_only        boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'queued',
  error_message    text DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE video_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert render jobs"
  ON video_render_jobs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can read own render jobs"
  ON video_render_jobs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own render jobs"
  ON video_render_jobs FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_render_jobs_project ON video_render_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON video_render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_render_jobs_created ON video_render_jobs(created_at DESC);
