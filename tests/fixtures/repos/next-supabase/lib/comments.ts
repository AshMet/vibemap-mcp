import { db } from "@/lib/db";

export async function listComments(postId: string) {
  return db.from("comments").select("*").eq("post_id", postId);
}
