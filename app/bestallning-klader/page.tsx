"use client";
import { useState } from "react";

export default function BestallningKladerPage() {
  const [title, setTitle] = useState("Beställning kläder");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [dueDate, setDueDate] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );

  // Common sizes
  const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;
  const SIZESPants = [
    "40",
    "42",
    "44",
    "46",
    "48",
    "50",
    "52",
    "54",
    "56",
    "58",
  ] as const;
  type SizeRow = { size: string; selected: boolean };
  type SectionState = {
    key: string;
    title: string;
    rows: SizeRow[];
    qty: number;
  };

  const initialSection = (
    key: string,
    title: string,
    sizes: readonly string[] = SIZES
  ): SectionState => ({
    key,
    title,
    rows: sizes.map((s) => ({ size: s, selected: false })),
    qty: 1,
  });

  const [sections, setSections] = useState<SectionState[]>([
    initialSection("tshirt", "T-shirt"),
    initialSection("tjocktroja", "Tjocktröja"),
    initialSection("byxor", "Byxor", SIZESPants),
    initialSection("shorts", "Shorts", SIZESPants),
    initialSection("jacka", "Jacka"),
    initialSection("vinterjacka", "Vinterjacka"),
  ]);

  function toggleSize(
    sectionIndex: number,
    rowIndex: number,
    selected: boolean
  ) {
    setSections((prev) =>
      prev.map((sec, si) =>
        si === sectionIndex
          ? {
              ...sec,
              rows: sec.rows.map((r, ri) =>
                ri === rowIndex ? { ...r, selected } : r
              ),
            }
          : sec
      )
    );
  }

  function updateSectionQty(sectionIndex: number, qty: number) {
    const n = Number.isFinite(qty) ? Math.max(1, Math.floor(qty)) : 1;
    setSections((prev) =>
      prev.map((sec, si) => (si === sectionIndex ? { ...sec, qty: n } : sec))
    );
  }

  function buildOrderSummary() {
    const lines: string[] = [];
    for (const sec of sections) {
      const picked = sec.rows.filter((r) => r.selected);
      if (!picked.length) continue;
      const sizesLine = picked.map((r) => `${r.size} x${sec.qty}`).join(", ");
      lines.push(`- ${sec.title}: ${sizesLine}`);
    }
    if (!lines.length) return "";
    return `Beställning:\n${lines.join("\n")}`;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const orderSummary = buildOrderSummary();
      const finalDescription = [description?.trim(), orderSummary]
        .filter(Boolean)
        .join("\n\n");
      const res = await fetch("/api/blikk/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: finalDescription,
          dueDate: dueDate || undefined,
          comment: comment || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok)
        throw new Error(json.error || "Misslyckades att skapa uppgift");
      setResult({
        ok: true,
        message: `Uppgift skapad (ID: ${json.createdId}).`,
      });
      setDescription("");
      setSections([
        initialSection("tshirt", "T-shirt"),
        initialSection("tjocktroja", "Tjocktröja"),
        initialSection("byxor", "Byxor", SIZESPants),
        initialSection("shorts", "Shorts", SIZESPants),
        initialSection("jacka", "Jacka"),
        initialSection("vinterjacka", "Vinterjacka"),
      ]);
    } catch (err: any) {
      setResult({ ok: false, message: err?.message || "Något gick fel" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 800, margin: "0 auto" }}>
      <h1>Beställning kläder</h1>
      <p style={{ color: "#6b7280", marginTop: -6, marginBottom: 16 }}>
        Skicka in behov av kläder så skapas en uppgift i Blikk.
      </p>
      <p
        style={{
          color: "#6b7280",
          marginTop: -6,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        Obs: Uppgiften kopplas automatiskt till projekt 230354.
      </p>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Titel</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-field"
            placeholder="Titel"
            required
          />
        </label>

        {sections.map((sec, si) => (
          <section
            key={sec.key}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <h2 style={{ fontSize: 18, margin: 0 }}>{sec.title}</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {sec.rows.map((row, ri) => (
                <label
                  key={`${sec.key}-${row.size}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #e5e7eb",
                    padding: 10,
                    borderRadius: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => toggleSize(si, ri, e.target.checked)}
                  />
                  <span style={{ width: 42 }}>{row.size}</span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 600 }}>Antal per vald storlek</span>
              <input
                type="number"
                min={1}
                value={sec.qty}
                onChange={(e) => updateSectionQty(si, Number(e.target.value))}
                className="text-field"
                style={{ width: 120 }}
                disabled={!sec.rows.some((r) => r.selected)}
              />
              <span>st</span>
            </div>
          </section>
        ))}

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Övrig beskrivning (valfritt)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-area"
            placeholder="Ev. extra detaljer (färg, modell, leveransinfo, mm)"
            rows={5}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontWeight: 600 }}>Namn på beställaren</span>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="text-field"
            placeholder="Tex Jonas Svensson"
            autoComplete="name"
            required
          />
        </label>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Förfallodatum (valfritt)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="text-field"
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" className="primary-btn" disabled={submitting}>
            {submitting ? "Skickar…" : "Skicka beställning"}
          </button>
          {result && (
            <div style={{ color: result.ok ? "#059669" : "#dc2626" }}>
              {result.message}
            </div>
          )}
        </div>
      </form>
    </main>
  );
}
