import { listUsers } from "../../../lib/users";

export default async function handler(_req: any, res: any) {
  res.json(await listUsers());
}
