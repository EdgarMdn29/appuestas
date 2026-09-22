import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SnapshotSlot = "09" | "14" | "17";

function toISODate(dateStr?: string) {
  if (dateStr) {
    return dateStr;
  }

  const d = new Date();

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getCurrentSlot(): SnapshotSlot {
  const now = new Date();

  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City",
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );

  if (hour < 14) {
    return "09";
  }

  if (hour < 17) {
    return "14";
  }

  return "17";
}

function isValidSlot(
  value: string | null
): value is SnapshotSlot {
  return value === "09" || value === "14" || value === "17";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const date = toISODate(
    searchParams.get("date") || undefined
  );

  const requestedSlot =
    searchParams.get("slot");

  const slot: SnapshotSlot = isValidSlot(requestedSlot)
    ? requestedSlot
    : getCurrentSlot();

  try {
    const { data, error } = await supabaseAdmin
      .from("mlb_snapshots")
      .select(
        "id, snapshot_date, snapshot_slot, captured_at, source, data"
      )
      .eq("snapshot_date", date)
      .eq("snapshot_slot", slot)
      .maybeSingle();

    if (error) {
      console.error(
        "Error reading MLB snapshot:",
        error.message
      );

      return NextResponse.json(
        {
          error: "Snapshot database error",
          details: error.message,
        },
        {
          status: 500,
        }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error: "MLB snapshot not available",
          date,
          slot,
          message:
            "No snapshot exists for this date and slot yet.",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json({
      ...data.data,
      source: "snapshot",
      snapshot: {
        id: data.id,
        date: data.snapshot_date,
        slot: data.snapshot_slot,
        capturedAt: data.captured_at,
        source: data.source,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "MLB snapshot error",
        details:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status: 500,
      }
    );
  }
}