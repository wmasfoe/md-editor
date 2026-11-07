import { detectSystemLocale, t as translate, useTranslation } from "@md-editor/i18n";
import React, { useEffect, useRef, useState } from "react";
import {
  createPluginInstallUrl,
  createPluginPreviewUrl,
  downloadPlugin,
  getPluginCatalog,
  parsePluginInstallUrl,
} from "@md-editor/plugin-host/github";

type Catalog = Awaited<ReturnType<typeof getPluginCatalog>>;
type Download = Awaited<ReturnType<typeof downloadPlugin>>;

export function PluginPreviewPage() {
  const { t } = useTranslation();
  const locale = detectSystemLocale();
  const [source, setSource] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState("");
  const [download, setDownload] = useState<Download | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const frame = useRef<HTMLIFrameElement>(null);
  const requestId = useRef(0);
  const port = useRef<MessagePort | null>(null);
  const entry = catalog?.plugins.find((plugin) => plugin.id === selected);

  async function lookup(input: string, pluginId?: string) {
    const request = ++requestId.current;
    setError("");
    setRunning(false);
    setDownload(null);
    setCatalog(null);
    setSelected("");
    try {
      const result = await getPluginCatalog(input);
      if (request !== requestId.current) return;
      setCatalog(result);
      if (pluginId && result.plugins.some((plugin) => plugin.id === pluginId)) {
        setSelected(pluginId);
        const item = await downloadPlugin(result, pluginId);
        if (request === requestId.current) setDownload(item);
      }
    } catch (cause) {
      if (request === requestId.current) setError(String(cause));
    }
  }
  useEffect(() => {
    const url = new URL(location.href);
    const value = url.searchParams.get("install");
    if (!value) return;
    try {
      const parsed = parsePluginInstallUrl(value);
      if (!parsed) throw new Error(translate("pluginPreview.invalidUrl"));
      setSource(value);
      void lookup(value, parsed.pluginId);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  useEffect(() => {
    port.current?.postMessage({ type: "theme", theme });
  }, [theme]);
  useEffect(
    () => () => {
      port.current?.close();
    },
    [],
  );
  async function select(pluginId: string) {
    if (!catalog) return;
    const request = ++requestId.current;
    setRunning(false);
    setSelected(pluginId);
    setDownload(null);
    setError("");
    try {
      const item = await downloadPlugin(catalog, pluginId);
      if (request === requestId.current) setDownload(item);
    } catch (cause) {
      if (request === requestId.current) setError(String(cause));
    }
  }
  function connect() {
    if (!download || !frame.current?.contentWindow) return;
    port.current?.close();
    const channel = new MessageChannel();
    port.current = channel.port1;
    // The opaque-origin frame receives one private port; no host methods are exposed.
    frame.current.contentWindow.postMessage({ type: "inkpoint-plugin-preview" }, "*", [
      channel.port2,
    ]);
    channel.port1.postMessage({ type: "initialize", package: download.package, theme, locale });
  }
  async function copyLink() {
    if (!download) return;
    const install = createPluginInstallUrl(download.source);
    await navigator.clipboard.writeText(install);
  }
  async function copyPreviewLink() {
    if (download) await navigator.clipboard.writeText(createPluginPreviewUrl(download.source));
  }
  return (
    <main style={{ maxWidth: 1200, margin: "auto", padding: 24, overflow: "auto", height: "100%" }}>
      <h1>{t("pluginPreview.title")}</h1>
      <p>{t("pluginPreview.intro")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void lookup(source);
        }}
      >
        <label>
          {t("pluginPreview.source")}{" "}
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="owner/repository"
          />
        </label>{" "}
        <button type="submit">{t("pluginPreview.search")}</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {catalog && (
        <section>
          <h2>
            {catalog.owner}/{catalog.repo} · {catalog.tag}
          </h2>
          <ul>
            {catalog.plugins.map((plugin) => (
              <li key={plugin.id}>
                <button onClick={() => void select(plugin.id)}>
                  {plugin.name} · {plugin.version}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {entry && (
        <section>
          <h2>{entry.name}</h2>
          <p>{entry.description}</p>
          <p>
            {t("pluginPreview.version")} {entry.version} · {t("pluginPreview.api")}{" "}
            {entry.apiVersion}
          </p>
          <button disabled={!download} onClick={() => setRunning(true)}>
            {t("pluginPreview.start")}
          </button>
        </section>
      )}
      {download && (
        <section>
          <h3>{t("pluginPreview.examples")}</h3>
          <ul>
            {download.package.examples.map((example) => (
              <li key={example.id}>
                {example.name}
                {example.instructions && ` — ${example.instructions}`}
              </li>
            ))}
          </ul>
          <button onClick={() => void copyLink()}>{t("pluginPreview.copyInstall")}</button>{" "}
          <button onClick={() => void copyPreviewLink()}>{t("pluginPreview.copyPreview")}</button>{" "}
          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {t("pluginPreview.theme")}
          </button>
          {running && (
            <iframe
              ref={frame}
              title={t("pluginPreview.trial")}
              sandbox="allow-scripts"
              src={"/playground/plugin-guest.html"}
              onLoad={connect}
              style={{
                display: "block",
                width: "100%",
                height: 650,
                marginTop: 16,
                border: "1px solid #aaa",
              }}
            />
          )}
        </section>
      )}
    </main>
  );
}
