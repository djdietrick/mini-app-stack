import type { DigestResult } from "./buildDigest.js";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderDigestEmail(digest: DigestResult, runDate: Date): RenderedEmail {
  const totalVideos = digest.channels.reduce((n, c) => n + c.videos.length, 0);
  const dateLabel = runDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const subject = `YouTube digest — ${totalVideos} new video${totalVideos === 1 ? "" : "s"} (${dateLabel})`;

  const channelHtml = digest.channels
    .map((group) => {
      const videoRows = group.videos
        .map((v) => {
          const reason = v.reasons.length ? escapeHtml(v.reasons.join("; ")) : "";
          const thumb = v.thumbnailUrl
            ? `<img src="${escapeHtml(v.thumbnailUrl)}" width="120" style="border-radius:6px;display:block" />`
            : "";
          return `
            <tr>
              <td style="padding:8px 12px 8px 0;vertical-align:top">${thumb}</td>
              <td style="padding:8px 0;vertical-align:top">
                <a href="https://www.youtube.com/watch?v=${escapeHtml(v.videoId)}" style="font-weight:600;color:#1a1a1a;text-decoration:none">${escapeHtml(v.title)}</a>
                <div style="color:#666;font-size:13px;margin-top:4px">${v.viewCount.toLocaleString()} views${reason ? " · " + reason : ""}</div>
              </td>
            </tr>`;
        })
        .join("");
      return `
        <h2 style="font-size:16px;margin:24px 0 8px">${escapeHtml(group.channelTitle)}</h2>
        <table style="width:100%;border-collapse:collapse">${videoRows}</table>`;
    })
    .join("");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto">
      <h1 style="font-size:20px">Your YouTube digest</h1>
      <p style="color:#666">${dateLabel} · ${totalVideos} new video${totalVideos === 1 ? "" : "s"}</p>
      ${channelHtml}
    </div>`;

  const text = digest.channels
    .map(
      (g) =>
        `${g.channelTitle}\n` +
        g.videos
          .map((v) => `- ${v.title} (${v.viewCount.toLocaleString()} views) https://www.youtube.com/watch?v=${v.videoId}`)
          .join("\n"),
    )
    .join("\n\n");

  return { subject, html, text };
}
