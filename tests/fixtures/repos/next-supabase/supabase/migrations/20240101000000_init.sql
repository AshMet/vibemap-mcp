-- Initial schema
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comments (
  id bigint GENERATED ALWAYS AS IDENTITY,
  post_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT comments_post_fk FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT comments_author_fk FOREIGN KEY (author_id) REFERENCES profiles(id)
);

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published posts" ON posts
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "Authors manage their posts" ON posts
  FOR ALL TO authenticated
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

CREATE POLICY "Temporary policy" ON comments FOR SELECT USING (true);

-- A function body full of semicolons must not split the file.
CREATE OR REPLACE FUNCTION public.touch_post() RETURNS trigger AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_touch_post BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION public.touch_post();
CREATE INDEX idx_posts_author ON posts(author_id);
