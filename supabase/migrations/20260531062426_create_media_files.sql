/*
  # Create media_files table

  1. New Tables
    - `media_files`
      - `id` (uuid, primary key)
      - `product_asset_id` (uuid) — nullable FK to product_assets
      - `product_index` (integer) — which product slot (1-based)
      - `file_type` (text) — 'image' | 'video'
      - `source_url` (text) — original remote URL
      - `local_path` (text) — absolute local file system path
      - `file_hash` (text) — SHA-256 of file contents for deduplication
      - `file_size_bytes` (bigint) — bytes on disk after optimization
      - `original_size_bytes` (bigint) — bytes before optimization
      - `width` (integer) — pixel width (images only)
      - `height` (integer) — pixel height (images only)
      - `optimized` (boolean) — whether sharp optimization was applied
      - `created_at` (timestamptz)

  2. Indexes
    - `file_hash` index for fast deduplication lookups
    - `product_index` index for fast per-product queries

  3. Security
    - Enable RLS
    - Allow anon reads and writes (desktop app, no auth)
*/

CREATE TABLE IF NOT EXISTS media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_asset_id uuid REFERENCES product_assets(id) ON DELETE SET NULL,
  product_index integer NOT NULL DEFAULT 1,
  file_type text NOT NULL DEFAULT 'image',
  source_url text NOT NULL DEFAULT '',
  local_path text NOT NULL DEFAULT '',
  file_hash text NOT NULL DEFAULT '',
  file_size_bytes bigint NOT NULL DEFAULT 0,
  original_size_bytes bigint NOT NULL DEFAULT 0,
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  optimized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_files_hash_idx ON media_files(file_hash);
CREATE INDEX IF NOT EXISTS media_files_product_idx ON media_files(product_index);

ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert on media_files"
  ON media_files FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select on media_files"
  ON media_files FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous update on media_files"
  ON media_files FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anonymous delete on media_files"
  ON media_files FOR DELETE
  TO anon
  USING (true);
