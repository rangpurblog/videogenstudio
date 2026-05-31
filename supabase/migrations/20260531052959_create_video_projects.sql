/*
  # Create video_projects table

  1. New Tables
    - `video_projects`
      - `id` (uuid, primary key)
      - `script` (text) — full raw script input
      - `video_style` (text) — cinematic / product / social / documentary
      - `video_length` (text) — 30s / 60s / 90s / 2m
      - `mappings` (jsonb) — parsed array of { productIndex, script, link }
      - `status` (text) — idle / processing / completed / error
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Allow anonymous reads and inserts (no auth required for this desktop tool)
*/

CREATE TABLE IF NOT EXISTS video_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script text NOT NULL DEFAULT '',
  video_style text NOT NULL DEFAULT 'product',
  video_length text NOT NULL DEFAULT '60s',
  mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'idle',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE video_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert"
  ON video_projects FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select"
  ON video_projects FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous update"
  ON video_projects FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
