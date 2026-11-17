// In-process access to the real engine modules for the model-based runs (bundled by test/model/build.mjs).
export { Engine } from "../../src/core/engine";
export { Store } from "../../src/core/db";
export { Ingestor, SpoolReader, nextStatus, DEDUPE_WINDOW_MS } from "../../src/core/ingest";
export { widgetData, setBuildName, dismissRisks, hideQuiet, isQuietSession } from "../../src/core/glance";
export { pageData } from "../../src/core/page";
export { plan, gate, verifyKey } from "../../src/core/license";
