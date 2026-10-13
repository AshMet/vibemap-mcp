import { createClient } from "@supabase/supabase-js";

export const db = createClient("http://localhost", "anon");
