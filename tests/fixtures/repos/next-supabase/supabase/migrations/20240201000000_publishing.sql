ALTER TABLE posts ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE posts ALTER COLUMN body SET NOT NULL;
ALTER TABLE profiles RENAME COLUMN display_name TO name;

DROP POLICY IF EXISTS "Temporary policy" ON comments;
CREATE POLICY "Comment authors insert" ON comments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id);
