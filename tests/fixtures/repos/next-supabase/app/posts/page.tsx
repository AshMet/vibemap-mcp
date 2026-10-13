import { PostCard } from "@/components/PostCard";
import { listPosts } from "@/lib/posts";

export default async function Posts() {
  const posts = await listPosts();
  return <PostCard post={posts} />;
}
