import { describe, expect, it } from "vitest";
import { youtubeIdFromUrl } from "./youtube";

describe("youtubeIdFromUrl", () => {
  const ID = "dQw4w9WgXcQ";

  it("aceita as formas de URL que as pessoas colam", () => {
    expect(youtubeIdFromUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://youtu.be/${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://youtu.be/${ID}?si=abc`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeIdFromUrl(`  https://m.youtube.com/watch?v=${ID}  `)).toBe(ID);
    expect(youtubeIdFromUrl(ID)).toBe(ID);
  });

  it("devolve null para o que não é vídeo do YouTube", () => {
    expect(youtubeIdFromUrl("")).toBeNull();
    expect(youtubeIdFromUrl("https://vimeo.com/123456")).toBeNull();
    expect(youtubeIdFromUrl("https://www.youtube.com/channel/UCabc")).toBeNull();
    expect(youtubeIdFromUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeIdFromUrl("não é url")).toBeNull();
  });
});
