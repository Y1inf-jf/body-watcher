import { NextRequest, NextResponse } from "next/server";
import { getTemplates, saveTemplate, deleteTemplate } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ templates: getTemplates() });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60 || body.exercises == null) {
    return NextResponse.json({ error: "name (1-60 chars) and exercises required" }, { status: 400 });
  }
  const exercises = body.exercises;
  saveTemplate({ name, exercises: typeof exercises === "string" ? exercises : JSON.stringify(exercises) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") || "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteTemplate(id);
  return NextResponse.json({ ok: true });
}
