/*
  # Create audio_tracks table

  1. New Tables
    - `audio_tracks`
      - `id` (uuid, primary key)
      - `project_id` (uuid, nullable FK to video_projects)
      - `mode` (text) — 'single' | 'multi'
      - `product_index` (integer, nullable) — null for single mode, 1-based for multi
      - `file_name` (text) — original or saved file name
      - `local_path` (text) — absolute local file path after copy
      - `duration_seconds` (numeric 10,3) — detected audio duration
      - `file_size_bytes` (bigint)
      - `mime_type` (text) — e.g. 'audio/mpeg' | 'audio/wav'
      - `created_at` (timestamptz)

  2. Indexes
    - `project_id` for fast project-scoped lookups
    - `product_index` for multi-mode slot lookups

  3. Security
    - Enable RLS
    - Anon read/write (desktop app, no auth)
*/

CREATE TABLE IF NOT EXISTS audio_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'single',
  product_index integer,
  file_name text NOT NULL DEFAULT '',
  local_path text NOT NULL DEFAULT '',
  duration_seconds numeric(10, 3) NOT NULL DEFAULT 0,
  file_size_bytes bigint NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'audio/mpeg',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audio_tracks_project_idx ON audio_tracks(project_id);
CREATE INDEX IF NOT EXISTS audio_tracks_product_idx ON audio_tracks(product_index);

ALTER TABLE audio_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert on audio_tracks"
  ON audio_tracks FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select on audio_tracks"
  ON audio_tracks FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous update on audio_tracks"
  ON audio_tracks FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anonymous delete on audio_tracks"
  ON audio_tracks FOR DELETE
  TO anon
  USING (true);
