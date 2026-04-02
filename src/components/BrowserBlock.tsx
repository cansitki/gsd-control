interface BrowserBlockProps {
  blockId: string;
  visible: boolean;
  url?: string;
}

export default function BrowserBlock({ visible }: BrowserBlockProps) {
  if (!visible) return null;
  return (
    <div className="flex items-center justify-center h-full bg-[#141a14] text-base-muted">
      <div className="text-center">
        <span className="text-2xl">🌐</span>
        <p className="text-sm mt-2">Browser block — coming soon</p>
      </div>
    </div>
  );
}
