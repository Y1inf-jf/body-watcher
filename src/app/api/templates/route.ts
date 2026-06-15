import { NextRequest, NextResponse } from "next/server";
import { getTemplates, saveTemplate, deleteTemplate } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ templates: getTemplates() });
}

export async function POST(request: NextRequest) {
  const { name, exercises } = await request.json();
  if (!name || !exercises) return NextResponse.json({ error: "name and exercises required" }, { status: 400 });
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
