// Domain types for the körjournal (mileage / trip log) feature.

// Client-facing trip shape (camelCase).
export type Trip = {
  id: string;
  date: string; // YYYY-MM-DD
  startAddress: string;
  endAddress: string;
  startKm: number | null;
  endKm: number | null;
  note?: string;
};

// Raw DB row from korjournal_trips (snake_case).
export type TripRow = {
  id: string;
  created_at?: string;
  user_id?: string | null;
  date: string;
  start_address: string | null;
  end_address: string | null;
  start_km: number | null;
  end_km: number | null;
  note: string | null;
  sales_person?: string | null;
};

// Per-browser address frequency stats backing the favourites / autocomplete.
export type UsageStats = {
  startCounts: Record<string, number>;
  endCounts: Record<string, number>;
  pairCounts: Record<string, number>;
};

// Map a DB row to the client Trip shape.
export function mapTripRow(row: TripRow): Trip {
  return {
    id: row.id,
    date: row.date,
    startAddress: row.start_address ?? '',
    endAddress: row.end_address ?? '',
    startKm: row.start_km,
    endKm: row.end_km,
    note: row.note || undefined,
  };
}
