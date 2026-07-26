import SubtitleViewer from '@/components/viewer/SubtitleViewer';

export default async function WatchPage({
  params,
}: {
  params: Promise<{ sessionCode: string }>;
}) {
  const { sessionCode } = await params;

  return <SubtitleViewer sessionCode={sessionCode} />;
}
