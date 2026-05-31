/*
  # Create product_assets table

  1. New Tables
    - `product_assets`
      - `id` (uuid, primary key)
      - `project_id` (uuid) — references video_projects.id, nullable (can exist standalone)
      - `product_index` (int) — which Product N: slot this belongs to (1-based)
      - `source_url` (text) — the original Amazon URL
      - `asin` (text) — extracted Amazon ASIN, may be empty if extraction failed
      - `title` (text) — product title from PAAPI or scraping
      - `images` (jsonb) — array of { url, localPath, width, height }
      - `videos` (jsonb) — array of { url, localPath }
      - `fetch_source` (text) — 'paapi' | 'scraping' | 'failed'
      - `fetch_error` (text) — error message if fetch failed
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Allow anon reads and writes (desktop app, no auth)
*/

CREATE TABLE IF NOT EXISTS product_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES video_projects(id) ON DELETE SET NULL,
  product_index integer NOT NULL DEFAULT 1,
  source_url text NOT NULL DEFAULT '',
  asin text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetch_source text NOT NULL DEFAULT 'pending',
  fetch_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_assets_project_id_idx ON product_assets(project_id);
CREATE INDEX IF NOT EXISTS product_assets_asin_idx ON product_assets(asin);

ALTER TABLE product_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert on product_assets"
  ON product_assets FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous select on product_assets"
  ON product_assets FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous update on product_assets"
  ON product_assets FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
