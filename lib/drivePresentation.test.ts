import { describe, expect, it } from "vitest";
import { driveDisplayName, driveShotLabel, sortDriveFiles } from "./drivePresentation";
import type { DriveFile } from "./googleDrive";

const file = (id: string, options: Partial<DriveFile> = {}): DriveFile => ({
  id, name: `${id}.mp4`, mimeType: "video/mp4", thumbnailUrl: null, webViewLink: null, ...options,
});

describe("Drive metadata presentation", () => {
  it("prefers the original iPhone filename and hides opaque upload names", () => {
    expect(driveDisplayName(file("1", { name: "0144413a1ccc6b8030904bd39c1f3e3e32a62a1cfa.mp4", originalFilename: "IMG_0274.MOV" }), "Vídeo 1")).toBe("IMG_0274.MOV");
    expect(driveDisplayName(file("1", { name: "0144413a1ccc6b8030904bd39c1f3e3e32a62a1cfa.mp4" }), "Vídeo 1")).toBe("Vídeo 1");
  });

  it("orders by EXIF capture time, then Drive creation time for videos", () => {
    const early = file("early", { captureTime: "2026:09:18 14:30:00", createdTime: "2026-09-19T11:00:00Z" });
    const middle = file("middle", { createdTime: "2026-09-18T17:35:00Z" });
    const late = file("late", { captureTime: "2026:09:18 14:40:00", createdTime: "2026-09-18T16:00:00Z" });
    expect(sortDriveFiles([late, middle, early]).map((item) => item.id)).toEqual(["early", "middle", "late"]);
    expect(sortDriveFiles([late, middle, early], "newest").map((item) => item.id)).toEqual(["late", "middle", "early"]);
    expect(driveShotLabel(middle)).toBe("No Drive 18/09 · 14:35");
  });
});
