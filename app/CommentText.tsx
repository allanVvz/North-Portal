import { splitCommentText } from "@/lib/comments";

// Renders comment body text with any pasted URL as a clickable link — the one
// place this is done, shared by the admin comment threads and the client
// portal so a link posted by either side works for both. Kept out of
// lib/comments.ts (JSX-free) so that module stays importable by vitest specs
// that don't go through Next's JSX pipeline.
export default function CommentText({ text }: { text: string }) {
  return (
    <>
      {splitCommentText(text).map((part, i) =>
        "url" in part ? (
          <a key={i} href={part.url} target="_blank" rel="noopener noreferrer">{part.url}</a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
