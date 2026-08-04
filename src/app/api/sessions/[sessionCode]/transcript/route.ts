import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionCode: string }> },
) {
  const { sessionCode } = await params;
  const filePath = join(process.cwd(), 'logs', `${sessionCode}.json`);

  if (!existsSync(filePath)) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const data = readFileSync(filePath, 'utf-8');

  return new Response(data, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${sessionCode}-transcript.json"`,
    },
  });
}
