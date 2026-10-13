export const EMAIL_FOOTER = "RentNerd · private landlord tools";

export interface EmailContent {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
}

export interface RenderedEmail {
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Shared email layout (SPEC §10): a plain-text part and a simple HTML part, both ending with the footer. */
export function renderEmail({ heading, paragraphs, action }: EmailContent): RenderedEmail {
  const text = [
    heading,
    ...paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    "--",
    EMAIL_FOOTER,
  ].join("\n\n");
  const html = [
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.5;max-width:600px;margin:0 auto;padding:16px">',
    `<h1 style="font-size:20px">${escapeHtml(heading)}</h1>`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    ...(action
      ? [`<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:4px">${escapeHtml(action.label)}</a></p>`]
      : []),
    `<hr style="border:none;border-top:1px solid #d2d6dc"><p style="font-size:12px;color:#52606d">${escapeHtml(EMAIL_FOOTER)}</p>`,
    "</body></html>",
  ].join("");
  return { text, html };
}
