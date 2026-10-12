import { db } from "./db";

export async function listPosts() {
  return db.from("posts").select("*, profiles(name)");
}
