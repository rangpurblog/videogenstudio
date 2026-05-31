/*
  # Create timeline_edits table

  Stores manual overrides from the timeline editor. Each row represents
  a user's saved manual edit for a specific render plan / audio timeline.
  The `edits` column is a jsonb array of per-track overrides.

  1. New Tables
    - `timeline_edits`
      - `id` (uuid, primary key)
      - `audio_timeline_id` (uuid, FK → audio_timeline, nullable)
      - `style` (text) — which style these edits were made against
      - `edits` (jsonb) — array of TrackEdit objects
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Authenticated users can insert / select / update
*/

CREATE TABLE IF NOT EXISTS timeline_edits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_timeline_id  uuid REFERENCES audio_timeline(id) ON DELETE SET NULL,
  style              text NOT NULL DEFAULT 'product',
  edits              jsonb NOT NULL DEFAULT '[]',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE timeline_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert timeline edits"
  ON timeline_edits FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can read timeline edits"
  ON timeline_edits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update timeline edits"
  ON timeline_edits FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_timeline_edits_audio ON timeline_edits(audio_timeline_id);
CREATE INDEX IF NOT EXISTS idx_timeline_edits_created ON timeline_edits(created_at DESC);
