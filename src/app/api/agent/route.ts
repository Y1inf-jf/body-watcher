import { createAgentStream, createSummaryStream } from "@/lib/agent";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const mode = new URL(req.url).searchParams.get("mode");

  let stream: ReadableStream<Uint8Array>;
  try {
    stream = mode === "summary" ? await createSummaryStream() : await createAgentStream();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
