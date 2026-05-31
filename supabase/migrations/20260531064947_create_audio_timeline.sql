/*
  # Create audio_timeline table

  Stores the structured synchronization timeline derived from uploaded audio
  tracks. In single-audio mode, one timeline row maps the full narration to
  time-bounded product segments. In multi-audio mode, the mapping is direct
  (each track is already a product segment).

  1. New Tables
    - `audio_timeline`
      - `id` (uuid, primary key)
      - `audio_track_id` (uuid, nullable FK to audio_tracks) — the source track
      - `mode` (text) — 'single' | 'multi'
      - `sync_mode` (text) — 'auto' | 'manual' (how markers were set)
      - `product_count` (integer) — number of segments in this timeline
      - `timeline` (jsonb) — array of TimelineSegment objects:
          [{ productIndex, startTime, endTime, duration, audioPath }]
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Allow anon read/write (desktop app, no auth)
*/

CREATE TABLE IF NOT EXISTS audio_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_track_id uuid REFERENCES audio_tracks(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'single',
  sync_mode text NOT NULL DEFAULT 'manual',
  product_count integer NOT NULL DEFAULT 1,
  timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audio_timeline_track_idx ON audio_timeline(audio_track_id);

ALTER TABLE audio_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert on audio_timeline"
  ON audio_timeline FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select on audio_timeline"
  ON audio_timeline FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous update on audio_timeline"
  ON audio_timeline FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anonymous delete on audio_timeline"
  ON audio_timeline FOR DELETE
  TO anon
  USING (true);
