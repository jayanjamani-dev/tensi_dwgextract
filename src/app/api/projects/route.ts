import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { drawings: true } },
      drawings: {
        select: { extractionStatus: true },
      },
    },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, description } = body;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const project = await prisma.project.create({ data: { name, description } });
  return NextResponse.json(project, { status: 201 });
}
