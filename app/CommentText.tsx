import { Fragment } from "react";
import { splitCommentText } from "@/lib/comments";
import { parseGoogleDriveUrl } from "@/lib/googleDrive";
import GoogleDrivePreview from "@/app/GoogleDrivePreview";

// Renders comment body text with any pasted URL as a clickable link — the one
// place this is done, shared by the admin comment threads and the client
// portal so a link posted by either side works for both. Kept out of
// lib/comments.ts (JSX-free) so that module stays importable by vitest specs
// that don't go through Next's JSX pipeline.
//
// onLinkClick is optional and opt-in per caller (e.g. TaskModal wires it to
// open a document's preview modal in place, for a URL that matches a known
// attachment) — returning true means "handled", which suppresses the default
// navigate-away-in-a-new-tab behavior. Callers that don't pass it (client
// portal, etc.) keep the plain-link behavior unchanged.
//
// showLinkPreview is opt-in too: when on, a link recognized as Google
// Drive/Docs/Sheets/Slides also renders an inline preview right after it.
// Off by default so call sites outside the task card (client portal,
// TaskDetailPanel, ...) render exactly as before.
export default function CommentText({ text, onLinkClick, showLinkPreview = false }: { text: string; onLinkClick?: (url: string) => boolean; showLinkPreview?: boolean }) {
  return (
    <>
      {splitCommentText(text).map((part, i) => {
        if (!("url" in part)) return <span key={i}>{part.text}</span>;
        const drive = showLinkPreview ? parseGoogleDriveUrl(part.url) : null;
        return (
          <Fragment key={i}>
            <a
              href={part.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { if (onLinkClick?.(part.url)) e.preventDefault(); }}
            >
              {part.label ?? part.url}
            </a>
            {drive ? <GoogleDrivePreview link={drive} /> : null}
          </Fragment>
        );
      })}
    </>
  );
}
