import { useEffect, useState } from "react";
import { onShortcutsHelpToggle, hideShortcutsHelp } from "../hooks/useKeyboardShortcuts";

interface Shortcut {
  keys: string;
  description: string;
}

const SECTIONS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "\u2318 1", description: "Dashboard" },
      { keys: "\u2318 2", description: "Terminal" },
      { keys: "\u2318 3", description: "Logs" },
      { keys: "\u2318 4", description: "Settings" },
    ],
  },
  {
    title: "Terminal",
    shortcuts: [
      { keys: "\u2318 T", description: "New terminal tab" },
      { keys: "\u2318 W", description: "Close current tab" },
      { keys: "\u2318 [", description: "Previous tab" },
      { keys: "\u2318 ]", description: "Next tab" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { keys: "\u2318 R", description: "Refresh data" },
      { keys: "\u2318 K", description: "Clear search / filter" },
      { keys: "\u2318 /", description: "Toggle this help" },
    ],
  },
];

export default function KeyboardShortcutsHelp() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = onShortcutsHelpToggle(setVisible);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!visible) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        hideShortcutsHelp();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={() => hideShortcutsHelp()}
    >
      <div
        style={{
          backgroundColor: "#131722",
          border: "1px solid #1e2433",
          borderRadius: 12,
          padding: "24px 32px",
          maxWidth: 520,
          width: "90%",
          color: "#c8cdd8",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 600,
              color: "#f97316",
            }}
          >
            Keyboard Shortcuts
          </h2>
          <button
            onClick={() => hideShortcutsHelp()}
            style={{
              background: "none",
              border: "none",
              color: "#6b7280",
              cursor: "pointer",
              fontSize: 18,
              padding: "2px 6px",
              lineHeight: 1,
            }}
          >
            Esc
          </button>
        </div>

        {SECTIONS.map((section) => (
          <div key={section.title} style={{ marginBottom: 16 }}>
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#6b7280",
              }}
            >
              {section.title}
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "6px 16px",
                alignItems: "center",
              }}
            >
              {section.shortcuts.map((sc) => (
                <>
                  <kbd
                    key={`k-${sc.keys}`}
                    style={{
                      display: "inline-block",
                      backgroundColor: "#1e2433",
                      border: "1px solid #2a3040",
                      borderRadius: 6,
                      padding: "2px 8px",
                      fontSize: 12,
                      fontFamily: "inherit",
                      color: "#e5e7eb",
                      textAlign: "center",
                      minWidth: 48,
                    }}
                  >
                    {sc.keys}
                  </kbd>
                  <span
                    key={`d-${sc.keys}`}
                    style={{ fontSize: 13, color: "#c8cdd8" }}
                  >
                    {sc.description}
                  </span>
                </>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
