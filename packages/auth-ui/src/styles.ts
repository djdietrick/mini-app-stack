import type { CSSProperties } from "react";

// Unstyled-but-sensible defaults. Apps can override by passing className
// props to the form components.
export const styles: Record<string, CSSProperties> = {
  card: {
    maxWidth: 360,
    margin: "4rem auto",
    padding: "2rem",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "inherit",
  },
  title: { fontSize: 20, fontWeight: 600, marginBottom: "1.25rem" },
  field: { display: "flex", flexDirection: "column", gap: 6, marginBottom: "0.875rem" },
  label: { fontSize: 12, opacity: 0.7 },
  input: {
    padding: "0.55rem 0.7rem",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "inherit",
    font: "inherit",
  },
  button: {
    width: "100%",
    padding: "0.6rem 0.8rem",
    borderRadius: 6,
    border: 0,
    background: "#f5f5f5",
    color: "#111",
    fontWeight: 600,
    cursor: "pointer",
  },
  error: { color: "#f87171", fontSize: 13, marginTop: "0.5rem" },
  hint: { fontSize: 13, opacity: 0.7, marginTop: "1rem", textAlign: "center" },
  link: { color: "inherit", textDecoration: "underline", cursor: "pointer" },
};
