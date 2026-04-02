interface ExplorerBlockProps {
  blockId: string;
  visible: boolean;
  remotePath?: string;
}

export default function ExplorerBlock({ visible }: ExplorerBlockProps) {
  if (!visible) return null;
  return (
    <div className="flex items-center justify-center h-full bg-[#141a14] text-base-muted">
      <div className="text-center">
        <span className="text-2xl">📁</span>
        <p className="text-sm mt-2">File explorer — coming soon</p>
      </div>
    </div>
  );
}
