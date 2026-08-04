import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionCode: string; language: string }> },
) {
  const { sessionCode, language } = await params;
  const filePath = join(process.cwd(), 'logs', `${sessionCode}-${language}.wav`);

  if (!existsSync(filePath)) {
    return Response.json({ error: 'Audio not found' }, { status: 404 });
  }

  const data = readFileSync(filePath);

  return new Response(data, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Disposition': `attachment; filename="${sessionCode}-${language}.wav"`,
    },
  });
}
