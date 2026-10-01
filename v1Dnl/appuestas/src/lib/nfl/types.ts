export type NflverseRow = Record<string, string | number | null>;

export type NflverseDataset = {
  url: string;
  etag: string | null;
  lastModified: string | null;
  rowCount: number;
  rows: NflverseRow[];
};

export type NflSnapshotPayload = {
  league: "nfl";
  season: number;
  capturedAt: string;
  source: "nflverse";
  sourceVersion: string;
  schedule: NflverseDataset;
  teamStats: NflverseDataset;
  playerStats: NflverseDataset;
};

export type NflSnapshotRecord = {
  id: string;
  season: number;
  captured_at: string;
  source: "nflverse";
  source_version: string;
  sha256: string;
  data: NflSnapshotPayload;
};
