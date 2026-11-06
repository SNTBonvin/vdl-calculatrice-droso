// Fonction Netlify : stockage des comptages (un blob par saisie, pas de conflit d'écriture).
// Clé enseignant : variable d'environnement TEACHER_KEY (jamais dans le code).
import { getStore } from "@netlify/blobs";

const ORGS = ["pois", "droso"];
const ITEMS = {
  pois: Array.from({ length: 14 }, (_, i) => "B" + (i + 1)),
  droso: [
    "L1", "L2", "L3", "L4", "L5", "L6",
    "AABH", "AABI", "AABJ", "AABK", "AABL", "AABM", "AABN", "AABO",
  ],
};
const MAX_ENTRIES = 400;
const ID_RE = /^[a-f0-9-]{8,40}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export function makeHandler(getS, env = () => process.env) {
  return async (req) => {
    const store = getS();
    const url = new URL(req.url);
    const key = env().TEACHER_KEY;
    const isProf = !!key && req.headers.get("x-teacher-key") === key;

    const all = async (org) => {
      const { blobs } = await store.list({ prefix: org + "/" });
      const rows = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
      return rows.filter(Boolean);
    };

    if (req.method === "GET") {
      if (url.searchParams.get("check") === "1") return json({ prof: isProf });
      const out = [];
      for (const org of ORGS) out.push(...(await all(org)));
      out.sort((a, b) => a.ts - b.ts);
      // Les identifiants ne sont révélés qu'à l'enseignant : seul l'auteur peut corriger sa saisie.
      return json({ entries: out.map((e) => (isProf ? e : { ...e, id: undefined })) });
    }

    if (req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }
      const { id, org, item, counts } = b || {};
      const group = String(b?.group ?? "").trim().slice(0, 24);
      if (!ID_RE.test(String(id))) return json({ error: "Identifiant invalide" }, 400);
      if (!ORGS.includes(org)) return json({ error: "Onglet inconnu" }, 400);
      if (!ITEMS[org].includes(item)) return json({ error: "Échantillon inconnu" }, 400);
      if (!group) return json({ error: "Indique ton groupe" }, 400);
      if (!Array.isArray(counts) || counts.length !== 4 ||
          !counts.every((n) => Number.isInteger(n) && n >= 0 && n <= 999))
        return json({ error: "Les 4 effectifs doivent être des entiers de 0 à 999" }, 400);
      const k = `${org}/${id}`;
      if (!(await store.get(k)) && (await all(org)).length >= MAX_ENTRIES)
        return json({ error: "Trop de saisies" }, 429);
      await store.setJSON(k, { id, org, item, group, counts, ts: Date.now() });
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      if (url.searchParams.get("all") === "1") {
        if (!isProf) return json({ error: "Réservé à l'enseignant" }, 403);
        const only = url.searchParams.get("org");
        for (const org of only ? [only] : ORGS) {
          if (!ORGS.includes(org)) continue;
          const { blobs } = await store.list({ prefix: org + "/" });
          await Promise.all(blobs.map((x) => store.delete(x.key)));
        }
        return json({ ok: true });
      }
      const id = url.searchParams.get("id"), org = url.searchParams.get("org");
      if (!ID_RE.test(String(id)) || !ORGS.includes(org)) return json({ error: "Paramètres invalides" }, 400);
      await store.delete(`${org}/${id}`);
      return json({ ok: true });
    }

    return json({ error: "Méthode non autorisée" }, 405);
  };
}

export default makeHandler(() => getStore({ name: "comptage", consistency: "strong" }));
export const config = { path: "/api/results" };
