import { listComments } from "@/lib/comments";

async function handler(_req: Request, ctx: { params: { id: string } }) {
  return Response.json(await listComments(ctx.params.id));
}

export { handler as GET };
