import { modelName } from "@/lib/claude";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    needsPassword: !!process.env.APP_PASSWORD,
    model: modelName(),
  });
}
