// Popup controller — live readout + research controls.
// Talks to the background via the typed message protocol only.

import type { Message } from "../shared/messages";
import type { Config, IntensityResult, TabSignals } from "../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function send(message: Message): Promise<Message | undefined> {
  return (await browser.runtime.sendMessage(message)) as Message | undefined;
}

// --- rendering ---------------------------------------------------------------
function renderReadout(signals: TabSignals | null, result: IntensityResult | null): void {
  const pct = result ? Math.round(result.intensity * 100) : 0;
  document.querySelector<HTMLElement>(".gauge")?.style.setProperty("--pct", String(pct));
  $("intensity-pct").textContent = `${pct}%`;
  $("band").textContent = result?.band ?? "idle";
  $("page-domain").textContent = signals?.pageDomain || "—";

  $("c-orgs").textContent = String(result?.counts.organizations ?? 0);
  $("c-domains").textContent = String(result?.counts.domains ?? 0);
  $("c-requests").textContent = String(result?.counts.trackerRequests ?? 0);
  $("c-cookies").textContent = String(result?.counts.cookieDomains ?? 0);
  $("c-third").textContent = String(result?.counts.thirdPartyRequests ?? 0);
  $("c-fp").textContent = `${Math.round((result?.components.fingerprinting ?? 0) * 100)}%`;

  $("watcher").textContent = result?.dominantOrganization ?? "—";

  renderDisclosures(signals);

  const list = $("org-list");
  const orgs = signals ? Object.entries(signals.organizations) : [];
  list.replaceChildren();
  if (orgs.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "none yet";
    list.appendChild(li);
  } else {
    for (const [org, cat] of orgs.sort((a, b) => a[0].localeCompare(b[0]))) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = org; // textContent => no HTML injection
      const category = document.createElement("span");
      category.className = "cat";
      category.textContent = cat;
      li.append(name, category);
      list.appendChild(li);
    }
  }
}

/**
 * The list of fields filled in on this page. Labels and lengths only — the
 * extension never sees, stores or displays what was typed.
 */
function renderDisclosures(signals: TabSignals | null): void {
  const list = $("disclosure-list");
  const fields = Object.values(signals?.disclosures ?? {}).sort((a, b) => a.t - b.t);
  list.replaceChildren();

  if (fields.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "nothing yet";
    list.appendChild(li);
    return;
  }

  for (const field of fields) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "field";
    name.textContent = field.label; // textContent => no HTML injection
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = field.kind;
    const chars = document.createElement("span");
    chars.className = "chars";
    chars.textContent = `${field.chars} ch`;
    li.append(name, kind, chars);
    list.appendChild(li);
  }
}

function renderConfig(config: Config): void {
  ($("eyeEnabled") as HTMLInputElement).checked = config.eyeEnabled;
  ($("corner") as HTMLSelectElement).value = config.corner;
  ($("size") as HTMLInputElement).value = String(config.size);
  $("size-val").textContent = String(config.size);
  ($("skin") as HTMLSelectElement).value = config.skin;
  ($("inspection") as HTMLInputElement).checked = config.inspection;
  ($("logging") as HTMLInputElement).checked = config.logging;

  const overrideOn = $("overrideOn") as HTMLInputElement;
  const override = $("override") as HTMLInputElement;
  overrideOn.checked = config.intensityOverride !== null;
  override.disabled = config.intensityOverride === null;
  const pct = Math.round((config.intensityOverride ?? 0) * 100);
  override.value = String(pct);
  $("override-val").textContent = `${pct}%`;
}

// --- data flow ---------------------------------------------------------------
async function refresh(): Promise<void> {
  const snap = await send({ type: "get-snapshot" });
  if (snap?.type !== "snapshot") return;
  renderReadout(snap.signals, snap.result);
  renderConfig(snap.config);
}

async function patchConfig(patch: Partial<Config>): Promise<void> {
  await send({ type: "set-config", config: patch });
  await refresh();
}

// --- wiring ------------------------------------------------------------------
function wire(): void {
  $("eyeEnabled").addEventListener("change", (e) =>
    void patchConfig({ eyeEnabled: (e.target as HTMLInputElement).checked }),
  );
  $("corner").addEventListener("change", (e) =>
    void patchConfig({ corner: (e.target as HTMLSelectElement).value as Config["corner"] }),
  );
  $("size").addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    $("size-val").textContent = String(v);
  });
  $("size").addEventListener("change", (e) =>
    void patchConfig({ size: Number((e.target as HTMLInputElement).value) }),
  );
  $("skin").addEventListener("change", (e) =>
    void patchConfig({ skin: (e.target as HTMLSelectElement).value as Config["skin"] }),
  );
  $("inspection").addEventListener("change", (e) =>
    void patchConfig({ inspection: (e.target as HTMLInputElement).checked }),
  );
  $("logging").addEventListener("change", (e) =>
    void patchConfig({ logging: (e.target as HTMLInputElement).checked }),
  );

  const override = $("override") as HTMLInputElement;
  $("overrideOn").addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    void patchConfig({ intensityOverride: on ? Number(override.value) / 100 : null });
  });
  override.addEventListener("input", () => {
    $("override-val").textContent = `${override.value}%`;
  });
  override.addEventListener("change", () =>
    void patchConfig({ intensityOverride: Number(override.value) / 100 }),
  );

  $("export").addEventListener("click", async () => {
    const res = await send({ type: "export-log" });
    if (res?.type !== "export-log-result") return;
    const blob = new Blob([res.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracker-eye-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}

wire();
void refresh();
setInterval(() => void refresh(), 1000); // live update while popup is open
