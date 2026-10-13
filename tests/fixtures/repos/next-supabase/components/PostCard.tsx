import type { listPosts } from "@/lib/posts";

export function PostCard(props: { post: Awaited<ReturnType<typeof listPosts>> }) {
  return <article>{JSON.stringify(props.post)}</article>;
}
