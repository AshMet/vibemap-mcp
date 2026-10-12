import { listPosts } from "@/lib/posts";

export async function GET() {
  return Response.json(await listPosts());
}

export const POST = async () => Response.json({ ok: true });
