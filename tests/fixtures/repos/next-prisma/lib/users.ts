import { prisma } from "./prisma";

export function listUsers() {
  return prisma.user.findMany({ include: { posts: true } });
}

export function getUser(id: string) {
  return prisma.user.findUnique({ where: { id } });
}
