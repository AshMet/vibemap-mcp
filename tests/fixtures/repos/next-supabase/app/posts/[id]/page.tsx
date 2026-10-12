import { listComments } from "../../../lib/comments";

export default async function Post({ params }: { params: { id: string } }) {
  const comments = await listComments(params.id);
  return <pre>{JSON.stringify(comments)}</pre>;
}
